const express = require('express');
const router = express.Router();

// Almacén en memoria de conversaciones en modo humano
// { conversationId: timestamp }
const conversacionesEnModoHumano = {};
const TIMEOUT_MODO_HUMANO = 30 * 60 * 1000; // 30 minutos

function activarModoHumano(conversationId) {
  conversacionesEnModoHumano[conversationId] = Date.now();
  console.log(`[MODO HUMANO] Activado para conversación ${conversationId}`);
}

function desactivarModoHumano(conversationId) {
  delete conversacionesEnModoHumano[conversationId];
  console.log(`[MODO HUMANO] Desactivado para conversación ${conversationId}`);
}

function estaEnModoHumano(conversationId) {
  if (!conversacionesEnModoHumano[conversationId]) return false;
  const elapsed = Date.now() - conversacionesEnModoHumano[conversationId];
  if (elapsed > TIMEOUT_MODO_HUMANO) {
    delete conversacionesEnModoHumano[conversationId];
    return false;
  }
  return true;
}

router.post('/', async (req, res) => {
  res.sendStatus(200);

  try {
    const { event, message_type, conversation, sender } = req.body;

    // Agente humano responde → activar modo humano
    if (event === 'message_created' && message_type === 'outgoing' && sender?.type === 'user') {
      const conversationId = conversation?.id;
      if (conversationId) {
        activarModoHumano(conversationId);
      }
      return;
    }

    // Conversación resuelta o bot retoma → desactivar modo humano
    if (event === 'conversation_status_changed') {
      const status = conversation?.status;
      const conversationId = conversation?.id;
      if (conversationId && (status === 'resolved' || status === 'bot')) {
        desactivarModoHumano(conversationId);
      }
      return;
    }

  } catch (err) {
    console.error('[CHATWOOT EVENTS]', err.message);
  }
});

module.exports = { router, estaEnModoHumano };