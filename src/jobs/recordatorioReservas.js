const { pool } = require('../db');
const { enviarMensajeTexto } = require('../bot/whatsapp');

async function enviarRecordatorios() {
  const client = await pool.connect();
  try {
    const ahora = new Date();
    const en3horas = new Date(ahora.getTime() + 3 * 60 * 60 * 1000);

    // Buscar reservas de hoy que empiecen en ~3 horas y no tengan recordatorio enviado
    const horaDesde = `${String(en3horas.getHours()).padStart(2, '0')}:00:00`;
    const horaHasta = `${String(en3horas.getHours()).padStart(2, '0')}:59:59`;
    const fechaHoy = ahora.toISOString().split('T')[0];

    const { rows: reservas } = await client.query(
      `SELECT r.id, r.hora, r.turno, r.cantidad_personas, r.fecha,
              p.nombre, p.telefono
       FROM reserva r
       JOIN persona p ON p.id = r.persona_id
       WHERE r.fecha = $1
         AND r.hora BETWEEN $2 AND $3
         AND r.estado IN ('pendiente', 'confirmada')
         AND r.recordatorio_enviado = false`,
      [fechaHoy, horaDesde, horaHasta]
    );

    console.log(`[RECORDATORIO] ${reservas.length} recordatorio(s) a enviar`);

    for (const reserva of reservas) {
      try {
        const horaDisplay = String(reserva.hora).slice(0, 5);
        const fechaDisplay = reserva.fecha.toISOString
          ? reserva.fecha.toISOString().split('T')[0].split('-').reverse().join('/')
          : String(reserva.fecha).split('T')[0].split('-').reverse().join('/');

        // Agregar 549 para enviar (el teléfono en BD está sin el 9)
        const telefonoWA = reserva.telefono.startsWith('54')
          ? '549' + reserva.telefono.slice(2)
          : reserva.telefono;

        await enviarMensajeTexto(
          telefonoWA,
          `¡Hola ${reserva.nombre}! 👋\n\n` +
          `Te recordamos que tenés una reserva en *Cantina Centro Basko* hoy a las *${horaDisplay}hs*. 🍽️\n\n` +
          `📅 Fecha: ${fechaDisplay}\n` +
          `👥 Personas: ${reserva.cantidad_personas}\n\n` +
          `⏰ Recordá que tenemos una tolerancia de 15-20 minutos. Pasado ese tiempo la mesa puede quedar sujeta a disponibilidad.\n\n` +
          `¡Esperamos verte pronto!`
        );

        await client.query(
          `UPDATE reserva SET recordatorio_enviado = true WHERE id = $1`,
          [reserva.id]
        );

        console.log(`[RECORDATORIO] Enviado a ${reserva.nombre} (${reserva.telefono})`);

      } catch (err) {
        console.error(`[RECORDATORIO] Error al enviar a ${reserva.nombre}:`, err.message);
      }
    }

  } catch (err) {
    console.error('[RECORDATORIO] Error general:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { enviarRecordatorios };