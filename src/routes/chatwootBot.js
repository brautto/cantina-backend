const express = require('express');
const router = express.Router();
const { manejarMensajeEntrante } = require('../bot/whatsapp');
const { estaEnModoHumano } = require('./chatwootEvents');

router.post('/', async (req, res) => {
  res.sendStatus(200);

  try {
    const { event, message_type, content, conversation, sender } = req.body;

    if (event !== 'message_created') return;
    if (message_type !== 'incoming') return;
    if (!content) return;

    const conversationId = conversation?.id;

    // Si está en modo humano, el bot no responde
    if (conversationId && estaEnModoHumano(conversationId)) {
      console.log(`[BOT] Silenciado — conversación ${conversationId} en modo humano`);
      return;
    }

    const telefono = sender?.phone_number?.replace(/\D/g, '');
    if (!telefono) return;

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