const express = require('express');
const router = express.Router();
const { manejarMensajeEntrante } = require('../bot/whatsapp');

router.post('/', async (req, res) => {
  res.sendStatus(200);

  try {
    const { event, message_type, content, conversation, sender } = req.body;

    if (event !== 'message_created') return;
    if (message_type !== 'incoming') return;
    if (!content) return;

    const telefono = sender?.phone_number?.replace(/\D/g, '');
    if (!telefono) return;

    const conversationId = conversation?.id;

    const message = {
      from: telefono,
      type: 'text',
      text: { body: content },
      chatwoot_conversation_id: conversationId
    };

    await manejarMensajeEntrante(message);

  } catch (err) {
    console.error('[CHATWOOT BOT]', err.message);
  }
});

module.exports = router;