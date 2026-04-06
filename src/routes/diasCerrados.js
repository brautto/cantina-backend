const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ── GET / — obtener todos los días cerrados ───────────────────────────────────
router.get('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, fecha, cierre FROM dia_cerrado ORDER BY fecha ASC`
    );
    return res.status(200).json({ ok: true, dias: result.rows });
  } catch (err) {
    console.error('[GET /dias-cerrados]', err);
    return res.status(500).json({ error: 'Error al obtener días cerrados' });
  } finally {
    client.release();
  }
});

router.post('/', async (req, res) => {
  const { fecha, cierre } = req.body;

  if (!fecha || !cierre) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const cierresValidos = ['maniana', 'noche', 'todo'];
  if (!cierresValidos.includes(cierre)) {
    return res.status(400).json({ error: 'Cierre inválido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existentes } = await client.query(
      `SELECT cierre FROM dia_cerrado WHERE fecha = $1`,
      [fecha]
    );

    const cierresExistentes = existentes.map(r => r.cierre);

    // Ya está marcado como todo el día
    if (cierresExistentes.includes('todo')) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Ese día ya está marcado como cerrado todo el día'
      });
    }

    // Ya existe exactamente ese cierre
    if (cierresExistentes.includes(cierre)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Ese día y turno ya está marcado como cerrado'
      });
    }

    // Si se agrega "todo", borramos los parciales y agregamos "todo"
    if (cierre === 'todo') {
      await client.query(`DELETE FROM dia_cerrado WHERE fecha = $1`, [fecha]);
      await client.query(
        `INSERT INTO dia_cerrado (fecha, cierre) VALUES ($1, 'todo')`,
        [fecha]
      );
      await client.query('COMMIT');
      return res.status(201).json({ ok: true, mensaje: 'Día marcado como cerrado todo el día' });
    }

    // Si se agrega maniana y ya existe noche (o viceversa) → convertir a todo
    const otroTurno = cierre === 'maniana' ? 'noche' : 'maniana';
    if (cierresExistentes.includes(otroTurno)) {
      await client.query(`DELETE FROM dia_cerrado WHERE fecha = $1`, [fecha]);
      await client.query(
        `INSERT INTO dia_cerrado (fecha, cierre) VALUES ($1, 'todo')`,
        [fecha]
      );
      await client.query('COMMIT');
      return res.status(201).json({ ok: true, mensaje: 'Ambos turnos cerrados: el día quedó marcado como cerrado todo el día' });
    }

    // Caso normal: agregar el cierre parcial
    await client.query(
      `INSERT INTO dia_cerrado (fecha, cierre) VALUES ($1, $2)`,
      [fecha, cierre]
    );

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, mensaje: 'Día cerrado registrado' });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[POST /dias-cerrados]', err);
    return res.status(500).json({ error: 'Error al registrar día cerrado' });
  } finally {
    client.release();
  }
});

// ── DELETE /:id — eliminar un día cerrado ─────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `DELETE FROM dia_cerrado WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Día cerrado no encontrado' });
    }
    return res.status(200).json({ ok: true, mensaje: 'Día cerrado eliminado' });
  } catch (err) {
    console.error('[DELETE /dias-cerrados/:id]', err);
    return res.status(500).json({ error: 'Error al eliminar día cerrado' });
  } finally {
    client.release();
  }
});

// ── GET /verificar — consultar si una fecha tiene algún cierre ────────────────
router.get('/verificar', async (req, res) => {
  const { fecha } = req.query;

  if (!fecha) {
    return res.status(400).json({ error: 'Falta la fecha' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT cierre FROM dia_cerrado WHERE fecha = $1`,
      [fecha]
    );

    return res.status(200).json({
      ok: true,
      cierres: result.rows.map(r => r.cierre)
    });
  } catch (err) {
    console.error('[GET /dias-cerrados/verificar]', err);
    return res.status(500).json({ error: 'Error al verificar día' });
  } finally {
    client.release();
  }
});

module.exports = router;
