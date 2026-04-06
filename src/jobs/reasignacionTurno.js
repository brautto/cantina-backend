// src/jobs/reasignacionTurno.js

const { pool } = require('../db');
const { asignarMesasBacktracking } = require('../services/asignadorMesas');
const { notificarAlerta } = require('../services/notificaciones');

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

async function persistirAsignacionConfirmada(client, asignacionPorReservaId) {
  let cantidad = 0;

  for (const [reservaId, mesaId] of asignacionPorReservaId.entries()) {
    if (reservaId === -1) continue;

    await client.query(
      `
      UPDATE reserva
      SET mesa_id = $1,
          estado = 'confirmada'
      WHERE id = $2
      `,
      [mesaId, reservaId]
    );

    cantidad++;
  }

  return cantidad;
}

async function registrarAlertaSistema(client, { tipo, fecha, turno, detalle }) {
  const result = await client.query(
    `
    INSERT INTO alerta_sistema (tipo, fecha, turno, detalle)
    VALUES ($1, $2, $3, $4)
    RETURNING id, created_at
    `,
    [tipo, fecha, turno, detalle]
  );

  return result.rows[0]; // { id, created_at }
}

/**
 * Reasigna globalmente las mesas del (fecha + turno).
 * - Si hay solución: asigna mesa_id y marca estado='confirmada'.
 * - Si NO hay solución: NO toca nada (rollback), registra alerta y notifica (por ahora log).
 */
async function reasignarTurno({ fecha, turno }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const mesasDisponibles = await obtenerMesasDisponiblesParaTurno(client, fecha, turno);
    const reservasPendientes = await obtenerReservasPendientesTurno(client, fecha, turno);

    if (reservasPendientes.length === 0) {
      await client.query('COMMIT');
      return { ok: true, mensaje: 'No hay reservas pendientes para reasignar', reasignadas: 0 };
    }

    const asignacion = asignarMesasBacktracking(mesasDisponibles, reservasPendientes);

    if (!asignacion) {
      const detalle = [
        'No se encontró asignación completa para reservas pendientes.',
        `fecha=${fecha}`,
        `turno=${turno}`,
        `mesasDisponibles=${mesasDisponibles.length}`,
        `reservasPendientes=${reservasPendientes.length}`,
        `reservasPendientesIds=[${reservasPendientes.map(r => r.id).join(',')}]`,
      ].join(' | ');

      // Guardar alerta en DB
      const alerta = await registrarAlertaSistema(client, {
        tipo: 'reasignacion_sin_solucion',
        fecha,
        turno,
        detalle,
      });

      // IMPORTANTE: dejamos todo como estaba (pendiente) → rollback
      await client.query('ROLLBACK');

      // Notificación preparada (hoy log, mañana WhatsApp/UI)
      await notificarAlerta({
        canal: 'log', // futuro: 'whatsapp'
        titulo: 'Reasignación sin solución',
        mensaje: `Se registró alerta #${alerta.id} (${alerta.created_at}). Revisar manualmente.`,
        meta: { fecha, turno, alertaId: alerta.id, detalle },
      });

      return {
        ok: false,
        error: 'No se pudo reasignar automáticamente. Se registró una alerta para revisión manual.',
        alertaId: alerta.id,
      };
    }

    const reasignadas = await persistirAsignacionConfirmada(client, asignacion);

    await client.query('COMMIT');
    return { ok: true, mensaje: 'Reasignación completada', reasignadas };

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    return { ok: false, error: 'Error en la reasignación del turno' };

  } finally {
    client.release();
  }
}

module.exports = { reasignarTurno };