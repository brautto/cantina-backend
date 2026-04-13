// src/routes/reservas.js
const express = require('express');
const router = express.Router();

const { pool } = require('../db');
const { asignarMesasBacktracking } = require('../services/asignadorMesas');
const { verificarCupoDinamicoNoche } = require('../services/cupoNoche');
const { reasignarTurno } = require('../jobs/reasignacionTurno');

const MONTO_SENIA_POR_PERSONA=10000

function calcularTurno(horaStr) {
  const [h, m] = horaStr.split(':').map(Number);
  const minutos = (h || 0) * 60 + (m || 0);

  if (minutos < 15 * 60) return 'maniana';
  if (minutos < 22 * 60) return 'noche_1';
  return 'noche_2';
}

async function obtenerMesasDisponiblesParaTurno(client, fecha, turno) {
  const result = await client.query(
    `
    SELECT m.id, m.numero, m.min_capacidad, m.max_capacidad
    FROM mesa m
    WHERE m.id NOT IN (
      SELECT r.mesa_id
      FROM reserva r
      WHERE r.fecha = $1
        AND r.turno = $2
        AND r.mesa_id IS NOT NULL
        AND r.estado IN ('confirmada', 'en_turno')
    )
    `,
    [fecha, turno]
  );

  return result.rows;
}

async function obtenerReservasPendientesTurno(client, fecha, turno) {
  const result = await client.query(
    `
    SELECT id, cantidad_personas
    FROM reserva
    WHERE fecha = $1
      AND turno = $2
      AND estado = 'pendiente'
    ORDER BY id ASC
    `,
    [fecha, turno]
  );

  return result.rows;
}

async function obtenerOCrearPersona(client, nombre, telefono) {
  const existente = await client.query(
    `SELECT * FROM persona WHERE telefono = $1`,
    [telefono]
  );

  if (existente.rows.length > 0) return existente.rows[0];

  const creada = await client.query(
    `
    INSERT INTO persona (nombre, telefono)
    VALUES ($1, $2)
    RETURNING *
    `,
    [nombre, telefono]
  );

  return creada.rows[0];
}

//POST /reservas

router.post('/', async (req, res) => {
  const { nombre, telefono, fecha, hora, cantidad_personas } = req.body;

  // Validación mínima para evitar 500 por body mal formado
  if (!nombre || !telefono || !fecha || !hora || !cantidad_personas) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  // Normalizar teléfono: solo dígitos
  const telefonoNorm = String(telefono).replace(/\D/g, '');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── ANTI-TROLLEO ──────────────────────────────────────────────
    // Máximo 2 reservas activas por día por teléfono
    const LIMITE_POR_DIA = 2;

    const { rows: countRows } = await client.query(
      `
      SELECT COUNT(*)::int AS cant
      FROM reserva r
      JOIN persona p ON p.id = r.persona_id
      WHERE p.telefono = $1
        AND r.fecha = $2
        AND r.estado <> 'cancelada'
      `,
      [telefonoNorm, fecha]
    );

    if (countRows[0].cant >= LIMITE_POR_DIA) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Límite alcanzado: máximo ${LIMITE_POR_DIA} reservas por día por teléfono`
      });
    }
    // ─────────────────────────────────────────────────────────────

    const turno = calcularTurno(hora);

    // ── DÍA CERRADO ───────────────────────────────────────────────────────────────
    const tipoCierre = turno === 'maniana' ? 'maniana' : 'noche';

    const { rows: diasCerrados } = await client.query(
      `SELECT id FROM dia_cerrado
      WHERE fecha = $1
        AND (cierre = $2 OR cierre = 'todo')`,
      [fecha, tipoCierre]
    );

    if (diasCerrados.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'El restaurante no abre ese día o turno'
      });
    }
    // ─────────────────────────────────────────────────────────────────────────────

    

    // ── CUPO DINÁMICO NOCHE ───────────────────────────────────────
    // Aplica SOLO para noche_1 y noche_2. Es un freno preventivo antes del oráculo.
    const DEBUG_CUPOS = process.env.DEBUG_CUPOS === 'true';

    if (turno === 'noche_1' || turno === 'noche_2') {
      const cupo = await verificarCupoDinamicoNoche(client, fecha, turno);

      if (!cupo.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `No hay disponibilidad para ${turno} (cupo noche alcanzado)`,
          ...(DEBUG_CUPOS ? { debug: cupo.debug } : {})
        });
      }
    }
    // ─────────────────────────────────────────────────────────────

    // 1) Traer mesas disponibles (filtradas)
    const mesasDisponibles = await obtenerMesasDisponiblesParaTurno(client, fecha, turno);

    // 2) Traer reservas pendientes del turno
    const reservasPendientes = await obtenerReservasPendientesTurno(client, fecha, turno);

    // 3) Feasibility check: pendientes + nueva
    const reservaVirtual = { id: -1, cantidad_personas };
    const reservasASimular = [...reservasPendientes, reservaVirtual];

    const t0 = Date.now();
    const asignacionSimulada = asignarMesasBacktracking(mesasDisponibles, reservasASimular);
    const ms = Date.now() - t0;
    console.log(`[ORACULO-POST] turno=${turno} reservas=${reservasASimular.length} mesas=${mesasDisponibles.length} ms=${ms}`);
    
    if (!asignacionSimulada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay disponibilidad para ese turno/fecha' });
    }

    // 4) Crear/reusar persona (con teléfono normalizado)
    const persona = await obtenerOCrearPersona(client, nombre, telefonoNorm);


    const montoSenia = cantidad_personas >= 8 ? cantidad_personas * MONTO_SENIA_POR_PERSONA : null;
    // Nuevo: definir estado inicial dinámico
    const estadoInicial = req.body.estado_inicial === 'pendiente_senia'
    ? 'pendiente_senia'
    : 'pendiente';


    // 5) Insertar reserva real
    const insertReserva = await client.query(
      `
      INSERT INTO reserva (
        persona_id,
        mesa_id,
        fecha,
        hora,
        cantidad_personas,
        estado,
        turno,
        monto_senia
      )
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [persona.id, fecha, hora, cantidad_personas, estadoInicial, turno, montoSenia]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Reserva confirmada',
      reserva: insertReserva.rows[0],
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
  
    if (err.code === 'ORACLE_TIMEOUT') {
      return res.status(503).json({
        error: 'Sistema ocupado para calcular disponibilidad. Reintentá en unos segundos.',
        code: 'ORACLE_TIMEOUT',
      });
    }
  
    console.error(err);
    return res.status(500).json({ error: 'Error al crear la reserva' });
  } finally {
    client.release();
  }
});

// ── POST /manual ──────────────────────────────────────────────────────────────

router.post('/manual', async (req, res) => {
  const { nombre, telefono, fecha, hora, cantidad_personas, mesa_numero, turno, ignorar_minimo } = req.body;

  if (!nombre || !telefono || !fecha || !hora || !cantidad_personas || !mesa_numero || !turno) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const telefonoNorm = String(telefono).replace(/\D/g, '');
  const cantidadNum  = parseInt(cantidad_personas, 10);
  const mesaNumeroNorm = String(mesa_numero).trim();

  if (isNaN(cantidadNum) || cantidadNum <= 0) {
    return res.status(400).json({ error: 'cantidad_personas inválida' });
  }

  const turnosValidos = ['maniana', 'noche_1', 'noche_2'];

  if (!turnosValidos.includes(turno)) {
    return res.status(400).json({ error: 'turno inválido' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── ANTI-TROLLEO ──────────────────────────────────────────────
    const LIMITE_POR_DIA = 2;

    const { rows: countRows } = await client.query(
      `
      SELECT COUNT(*)::int AS cant
      FROM reserva r
      JOIN persona p ON p.id = r.persona_id
      WHERE p.telefono = $1
        AND r.fecha = $2
        AND r.estado <> 'cancelada'
      `,
      [telefonoNorm, fecha]
    );

    if (countRows[0].cant >= LIMITE_POR_DIA) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Límite alcanzado: máximo ${LIMITE_POR_DIA} reservas por día por teléfono`
      });
    }
    // ─────────────────────────────────────────────────────────────

    // ── CUPO DINÁMICO NOCHE ───────────────────────────────────────
    const DEBUG_CUPOS = process.env.DEBUG_CUPOS === 'true';

    if (turno === 'noche_1' || turno === 'noche_2') {
      const cupo = await verificarCupoDinamicoNoche(client, fecha, turno);

      if (!cupo.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `No hay disponibilidad para ${turno} (cupo noche alcanzado)`,
          ...(DEBUG_CUPOS ? { debug: cupo.debug } : {})
        });
      }
    }
    // ─────────────────────────────────────────────────────────────

    // 1) Verificar que la mesa exista
    const mesaResult = await client.query(
      `SELECT id, numero, min_capacidad, max_capacidad FROM mesa WHERE numero = $1`,
      [mesaNumeroNorm]
    );

    if (mesaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mesa no encontrada' });
    }

    const mesa = mesaResult.rows[0];
    const mesaIdNum = mesa.id;

    // 2) Verificar compatibilidad de capacidad
    if (cantidadNum > mesa.max_capacidad || (!ignorar_minimo && cantidadNum < mesa.min_capacidad)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `La mesa ${mesa.numero} no es compatible para ${cantidadNum} personas`
      });
    }

    // 3) Verificar que la mesa no esté ocupada (confirmada o en_turno)
    const ocupadaResult = await client.query(
      `
      SELECT id FROM reserva
      WHERE fecha = $1 AND turno = $2 AND mesa_id = $3
        AND estado IN ('confirmada', 'en_turno')
      `,
      [fecha, turno, mesaIdNum]
    );

    if (ocupadaResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `La mesa ${mesa.numero} ya está ocupada para ese turno`
      });
    }

    // 4) Advertencia si hay una reserva pendiente para esta mesa en el mismo turno
    const pendienteResult = await client.query(
      `
      SELECT id FROM reserva
      WHERE fecha = $1 AND turno = $2 AND mesa_id = $3 AND estado = 'pendiente'
      `,
      [fecha, turno, mesaIdNum]
    );
    const advertencia = pendienteResult.rows.length > 0
      ? 'Hay una reserva pendiente para esta mesa en el mismo turno'
      : undefined;

    // 5) Crear o reutilizar persona
    const persona = await obtenerOCrearPersona(client, nombre, telefonoNorm);

    // 6) Insertar reserva manual ya confirmada
    const insertReserva = await client.query(
      `
      INSERT INTO reserva (
        persona_id, mesa_id, fecha, hora, cantidad_personas, estado, turno
      )
      VALUES ($1, $2, $3, $4, $5, 'confirmada', $6)
      RETURNING *
      `,
      [persona.id, mesaIdNum, fecha, hora, cantidadNum, turno]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      mensaje: 'Reserva manual creada correctamente',
      reserva: insertReserva.rows[0],
      ...(advertencia ? { advertencia } : {})
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[POST /reservas/manual]', err);
    return res.status(500).json({ error: 'Error al crear la reserva manual' });
  } finally {
    client.release();
  }
});

// ── GET / ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { fecha, turno } = req.query;

  if (!fecha || !turno) {
    return res.status(400).json({
      error: 'Debés enviar fecha y turno'
    });
  }

  const turnosValidos = ['maniana', 'noche_1', 'noche_2'];

  if (!turnosValidos.includes(turno)) {
    return res.status(400).json({
      error: 'Turno inválido'
    });
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        r.id,
        r.fecha,
        r.hora,
        r.turno,
        r.cantidad_personas,
        r.estado,
        r.mesa_id,
        r.monto_senia,
        m.numero AS mesa_numero,
        p.nombre,
        p.telefono
      FROM reserva r
      JOIN persona p ON p.id = r.persona_id
      LEFT JOIN mesa m ON m.id = r.mesa_id
      WHERE r.fecha = $1
        AND r.turno = $2
      ORDER BY r.hora ASC, r.id ASC
      `,
      [fecha, turno]
    );

    return res.status(200).json({
      ok: true,
      reservas: result.rows
    });

  } catch (err) {
    console.error('[GET /reservas]', err);
    return res.status(500).json({
      error: 'Error al obtener reservas'
    });
  } finally {
    client.release();
  }
});

// ── GET /por-telefono ─────────────────────────────────────────────────────────

router.get('/por-telefono', async (req, res) => {
  const { telefono, fecha } = req.query;

  if (!telefono || !fecha) {
    return res.status(400).json({
      error: 'Debés enviar telefono y fecha'
    });
  }

  const telefonoNorm = String(telefono).replace(/\D/g, '');

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      SELECT
        r.id,
        r.fecha,
        r.hora,
        r.turno,
        r.cantidad_personas,
        r.estado,
        p.nombre,
        p.telefono
      FROM reserva r
      JOIN persona p ON p.id = r.persona_id
      WHERE p.telefono = $1
        AND r.fecha = $2
        AND r.estado <> 'cancelada'
      ORDER BY r.hora ASC, r.id ASC
      `,
      [telefonoNorm, fecha]
    );

    return res.status(200).json({
      ok: true,
      reservas: result.rows
    });

  } catch (err) {
    console.error('[GET /reservas/por-telefono]', err);
    return res.status(500).json({
      error: 'Error al buscar reservas por teléfono'
    });
  } finally {
    client.release();
  }
});

// ── POST /reasignar ──────────────────────────────────────────────────────────

router.post('/reasignar', async (req, res) => {
  const { fecha, turno } = req.body;

  if (!fecha || !turno) {
    return res.status(400).json({
      error: 'Debés enviar fecha y turno'
    });
  }

  const turnosValidos = ['maniana', 'noche_1', 'noche_2'];

  if (!turnosValidos.includes(turno)) {
    return res.status(400).json({
      error: 'Turno inválido'
    });
  }

  try {
    const resultado = await reasignarTurno({ fecha, turno });

    if (!resultado.ok) {
      return res.status(400).json(resultado);
    }

    return res.status(200).json(resultado);

  } catch (err) {
    console.error('[POST /reservas/reasignar]', err);
    return res.status(500).json({
      error: 'Error al reasignar reservas'
    });
  }
});

// ── PATCH /:id/cancelar ───────────────────────────────────────────────────────

router.patch('/:id/cancelar', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'ID de reserva inválido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT id, estado, mesa_id FROM reserva WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const reserva = result.rows[0];

    if (!['pendiente', 'confirmada'].includes(reserva.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Solo se pueden cancelar reservas en estado pendiente o confirmada'
      });
    }

    const updateResult = await client.query(
      `
      UPDATE reserva
      SET estado  = 'cancelada',
          mesa_id = NULL
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      ok: true,
      mensaje: 'Reserva cancelada correctamente',
      reserva: updateResult.rows[0]
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[PATCH /reservas/:id/cancelar]', err);
    return res.status(500).json({ error: 'Error al cancelar la reserva' });
  } finally {
    client.release();
  }
});

// ── PATCH /:id/checkin ────────────────────────────────────────────────────────

router.patch('/:id/checkin', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'ID de reserva inválido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT id, estado, mesa_id FROM reserva WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const reserva = result.rows[0];

    if (reserva.estado === 'cancelada') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'No se puede hacer check-in de una reserva cancelada'
      });
    }

    if (reserva.estado === 'en_turno') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'La reserva ya está marcada como en_turno'
      });
    }

    const updateResult = await client.query(
      `UPDATE reserva
       SET estado = 'en_turno'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      ok: true,
      mensaje: 'Reserva marcada como en_turno',
      reserva: updateResult.rows[0]
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[PATCH /reservas/:id/checkin]', err);
    return res.status(500).json({
      error: 'Error al marcar la reserva como en_turno'
    });
  } finally {
    client.release();
  }
});

// ── PATCH /:id/confirmar-senia ────────────────────────────────────────────────

router.patch('/:id/confirmar-senia', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'ID de reserva inválido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT r.id, r.estado, p.telefono
       FROM reserva r
       JOIN persona p ON p.id = r.persona_id
       WHERE r.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const reserva = result.rows[0];

    if (reserva.estado !== 'pendiente_senia') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Solo se pueden confirmar reservas en estado pendiente_senia'
      });
    }

    await client.query(
      `UPDATE reserva SET estado = 'pendiente' WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    // Notificar al usuario por WhatsApp
    try {
      const { enviarMensajeTexto } = require('../bot/whatsapp');
      await enviarMensajeTexto(
        reserva.telefono,
        `✅ *¡Tu seña fue verificada!*\n\n` +
        `Tu reserva quedó confirmada correctamente.\n\n` +
        `⏰ Recordá que tenemos una tolerancia de 15-20 minutos al llegar. ¡Esperamos verte pronto! 🍽️`
      );
    } catch (waErr) {
      console.error('[confirmar-senia] Error al enviar WhatsApp:', waErr.message);
      // No falla el endpoint si el mensaje no se pudo enviar
    }

    return res.status(200).json({
      ok: true,
      mensaje: 'Seña confirmada y usuario notificado'
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[PATCH /reservas/:id/confirmar-senia]', err);
    return res.status(500).json({ error: 'Error al confirmar la seña' });
  } finally {
    client.release();
  }
});

// ── GET /mesas-con-estado ─────────────────────────────────────────────────────

router.get('/mesas-con-estado', async (req, res) => {
  const { fecha, turno } = req.query;

  if (!fecha || !turno) {
    return res.status(400).json({ error: 'Debés enviar fecha y turno' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      SELECT
        m.id,
        m.numero,
        m.min_capacidad,
        m.max_capacidad,
        r.estado AS estado_reserva,
        r.id AS reserva_id
      FROM mesa m
      LEFT JOIN reserva r ON r.mesa_id = m.id
        AND r.fecha = $1
        AND r.turno = $2
        AND r.estado IN ('confirmada', 'en_turno')
      ORDER BY m.numero ASC
      `,
      [fecha, turno]
    );

    return res.status(200).json({ ok: true, mesas: result.rows });
  } catch (err) {
    console.error('[GET /reservas/mesas-con-estado]', err);
    return res.status(500).json({ error: 'Error al obtener mesas' });
  } finally {
    client.release();
  }
});

// ── PATCH /:id/asignar-mesa ───────────────────────────────────────────────────

router.patch('/:id/asignar-mesa', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { mesa_numero } = req.body;

  if (isNaN(id) || !mesa_numero) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que la reserva existe y está confirmada
    const reservaResult = await client.query(
      `SELECT id, estado, fecha, turno, cantidad_personas FROM reserva WHERE id = $1`,
      [id]
    );

    if (reservaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const reserva = reservaResult.rows[0];

    if (reserva.estado !== 'confirmada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede reasignar mesa a reservas confirmadas' });
    }

    // Obtener la mesa destino
    const mesaResult = await client.query(
      `SELECT id, numero, min_capacidad, max_capacidad FROM mesa WHERE numero = $1`,
      [mesa_numero]
    );

    if (mesaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mesa no encontrada' });
    }

    const mesa = mesaResult.rows[0];

    // Verificar que la mesa no esté en_turno
    const enTurnoResult = await client.query(
      `SELECT id FROM reserva
       WHERE mesa_id = $1 AND fecha = $2 AND turno = $3 AND estado = 'en_turno'`,
      [mesa.id, reserva.fecha, reserva.turno]
    );

    if (enTurnoResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esa mesa ya está en turno, no se puede reasignar' });
    }

    // Si la mesa tiene una reserva confirmada, la dejamos sin mesa (pendiente)
    await client.query(
      `UPDATE reserva
       SET mesa_id = NULL, estado = 'pendiente'
       WHERE mesa_id = $1 AND fecha = $2 AND turno = $3 AND estado = 'confirmada' AND id != $4`,
      [mesa.id, reserva.fecha, reserva.turno, id]
    );

    // Asignar la nueva mesa
    await client.query(
      `UPDATE reserva SET mesa_id = $1 WHERE id = $2`,
      [mesa.id, id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      mensaje: `Mesa ${mesa.numero} asignada correctamente`
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[PATCH /reservas/:id/asignar-mesa]', err);
    return res.status(500).json({ error: 'Error al asignar mesa' });
  } finally {
    client.release();
  }
});


module.exports = router;