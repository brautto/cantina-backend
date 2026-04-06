// src/services/cupoNoche.js
/**
 * Verifica cupo dinámico nocturno entre turnos 'noche_1' y 'noche_2'.
 *
 * Idea:
 *  - N = cantidad total de mesas (COUNT(mesa))
 *  - Z = ceil(1.5 * N) = ceil(3N/2)  -> presupuesto total de reservas aceptadas para TODA la noche
 *  - X = cantidad de reservas ya aceptadas en noche_1 para esa fecha
 *  - Y = cantidad de reservas ya aceptadas en noche_2 para esa fecha
 *
 * Aceptamos una nueva reserva si:
 *  - Si turno = noche_1: (X + 1) + Y <= Z  y  X + 1 <= N
 *  - Si turno = noche_2: X + (Y + 1) <= Z  y  Y + 1 <= N
 *
 * Esto hace que los cupos se redistribuyan dinámicamente:
 * si un turno crece, el otro pierde margen, sin fijar cupos rígidos.
 */
async function verificarCupoDinamicoNoche(client, fecha, turno) {
    const { rows: nRows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM mesa`
    );
    const N = nRows[0]?.n ?? 0;
  
    const Z = Math.ceil((3 * N) / 2);
  
    const { rows: xyRows } = await client.query(
      `
      SELECT turno, COUNT(*)::int AS cant
      FROM reserva
      WHERE fecha = $1
        AND turno IN ('noche_1', 'noche_2')
        AND estado <> 'cancelada'
      GROUP BY turno
      `,
      [fecha]
    );
  
    let X = 0; // noche_1
    let Y = 0; // noche_2
    for (const r of xyRows) {
      if (r.turno === 'noche_1') X = r.cant;
      if (r.turno === 'noche_2') Y = r.cant;
    }
  
    const entraPorTotal =
      (turno === 'noche_1' && (X + 1) + Y <= Z) ||
      (turno === 'noche_2' && X + (Y + 1) <= Z);
  
    const entraPorTopeTurno =
      (turno === 'noche_1' && X + 1 <= N) ||
      (turno === 'noche_2' && Y + 1 <= N);
  
    return {
      ok: entraPorTotal && entraPorTopeTurno,
      debug: { N, Z, X_noche1: X, Y_noche2: Y, totalActual: X + Y, turno }
    };
  }
  
  module.exports = { verificarCupoDinamicoNoche };