const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function enviarNotificacionSenia({ nombre, fecha, cantidad_personas, monto, telefono }) {
  const fechaDisplay = fecha.split("T")[0].split("-").reverse().join("/");
  const montoFormat = Number(monto).toLocaleString("es-AR");

  await resend.emails.send({
    from: 'Cantina Basko <onboarding@resend.dev>',
    to: process.env.EMAIL_NOTIFICACION_SENIA,
    subject: `⚠️ Seña pendiente de verificación — ${nombre}`,
    text:
      `Se recibió un comprobante de seña.\n\n` +
      `Nombre: ${nombre}\n` +
      `Teléfono: ${telefono}\n` +
      `Fecha de reserva: ${fechaDisplay}\n` +
      `Personas: ${cantidad_personas}\n` +
      `Monto: $${montoFormat}\n\n` +
      `Por favor verificá el pago y confirmá la seña desde el panel de recepción.`,
  });
}

module.exports = { enviarNotificacionSenia };