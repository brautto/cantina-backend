const express = require('express');
const router = express.Router();
const { manejarMensajeEntrante } = require('../bot/whatsapp');

router.post('/', async (req, res) => {
  // Responder 200 inmediatamente a Chatwoot
  res.sendStatus(200);

  try {
    const { event, message_type, content, conversation, meta } = req.body;

    // Solo procesar mensajes entrantes del cliente
    if (event !== 'message_created') return;
    if (message_type !== 'incoming') return;
    if (!content) return;

    const telefono = meta?.sender?.phone_number?.replace(/\D/g, '') || 
                     conversation?.meta?.sender?.phone_number?.replace(/\D/g, '');
    
    if (!telefono) return;

    // Construir mensaje en formato compatible con el bot
    const message = {
      from: telefono,
      type: 'text',
      text: { body: content }
    };

    await manejarMensajeEntrante(message);

  } catch (err) {
    console.error('[CHATWOOT BOT]', err.message);
  }
});

module.exports = router;