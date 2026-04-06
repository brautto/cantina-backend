const express = require("express");
const router = express.Router();

const { manejarMensajeEntrante } = require("../bot/whatsapp");

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

router.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Muy importante: responder 200 rápido
    res.sendStatus(200);

    if (body.object !== "whatsapp_business_account") {
      return;
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages || [];
    

    for (const message of messages) {
      console.log("FROM RAW:", message.from);
      console.log("MESSAGE TYPE:", message.type);
      console.log("BODY:", JSON.stringify(message, null, 2));
      if (message.from) {
        await manejarMensajeEntrante(message);
      }
    }
  } catch (error) {
    console.error("Error en POST /webhook:", error.response?.data || error.message);
  }
});

module.exports = router;