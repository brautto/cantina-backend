const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    family: 4, // ← forzar IPv4
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

async function enviarNotificacionSenia({ nombre, fecha, cantidad_personas, monto, telefono }) {
  const fechaDisplay = fecha.split("T")[0].split("-").reverse().join("/");
  const montoFormat = Number(monto).toLocaleString("es-AR");

  await transporter.sendMail({
    from: `"Bot Cantina Basko" <${process.env.GMAIL_USER}>`,
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