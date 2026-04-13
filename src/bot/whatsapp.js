const axios = require("axios");

// ─── Sesiones en memoria ────────────────────────────────────────────────────
// { "5492262XXXXXX": { paso: "menu", datos: {} } }
const sesiones = {};

// ─── Constantes ─────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const CARTA_RESTAURANTE_URL = "https://drive.google.com/file/d/1KebJTGplqlkmPLVdQXtUE0Ng-rBzX9sW/view?usp=drive_link";
const CARTA_DELIVERY_URL    = "https://drive.google.com/file/d/16SKQvvIxHg5O4go4YX1U1cr8EdEOG0Gb/view?usp=drive_link";
const LINK_MAPS = "https://maps.app.goo.gl/jU6JN69EJ97mU34D6";
const ALIAS_MP = "cintiaale03";
const { enviarNotificacionSenia } = require('../services/mailer');

function calcularTurno(horaStr) {
  const [h, m] = horaStr.split(":").map(Number);
  const minutos = (h || 0) * 60 + (m || 0);
  if (minutos < 15 * 60) return "maniana";
  if (minutos < 22 * 60) return "noche_1";
  return "noche_2";
}

function calcularTurnoLabel(turno) {
  if (turno === "maniana")  return "Mediodía (12:00 - 15:00)";
  if (turno === "noche_1")  return "Primer turno noche (20:00 - 22:00)";
  if (turno === "noche_2")  return "Segundo turno noche (22:00 - 23:30)";
  return turno; // fallback por si llega algo inesperado
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function obtenerTextoMensaje(message) {
  if (!message) return null;
  if (message.type === "text" && message.text?.body) {
    return message.text.body.trim();
  }
  if (message.type === "interactive") {
    if (message.interactive?.button_reply?.id) return message.interactive.button_reply.id.trim();
    if (message.interactive?.list_reply?.id)   return message.interactive.list_reply.id.trim();
  }
  return null;
}

function normalizarTelefono(from) {
  if (from.startsWith("549")) return "54" + from.slice(3);
  return from;
}

async function enviarMensajeTexto(to, body) {
  const toNormalizado = normalizarTelefono(to);
  const url = `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: toNormalizado,
      type: "text",
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

function obtenerOSesionCrear(telefono) {
  if (!sesiones[telefono]) {
    sesiones[telefono] = { paso: "menu", datos: {} };
  }
  return sesiones[telefono];
}

function resetearSesion(sesion) {
  sesion.paso = "menu";
  sesion.datos = {};
}

function formatearFecha(fechaStr) {
  // Maneja tanto "2026-03-19" como "2026-03-19T03:00:00.000Z"
  const solo = fechaStr.split("T")[0]; // queda "2026-03-19"
  const [anio, mes, dia] = solo.split("-");
  return `${dia}/${mes}/${anio}`;
}

// ─── Pie de navegación reutilizable ──────────────────────────────────────────

const NAV_FAQ =
  `\n\n───────────────\n` +
  `Para seguir consultando las preguntas frecuentes usá los números del menú (1 al 6).\n` +
  `Para volver al menú principal escribí *7*.`;

const NAV_MENU =
  `\n\n───────────────\n` +
  `Escribí *1* para volver al menú principal.`;

// ─── Mensajes estáticos ───────────────────────────────────────────────────────

const MSG_MENU_PRINCIPAL =
  `¡Bienvenido/a a *Cantina Centro Basko*! 🍽️\n` +
  `Estamos ubicados en Av. 58 3202, Necochea, Buenos Aires.\n\n` +
  `¿En qué te podemos ayudar? Respondé con el número de la opción:\n\n` +
  `1️⃣  Reservas\n` +
  `2️⃣  Delivery 🚚\n` +
  `3️⃣  Ver la carta 🍽️\n` +
  `4️⃣  Métodos de pago 💳\n` +
  `5️⃣  Preguntas frecuentes ❓`;

const MSG_MENU_RESERVAS =
  `*Reservas* 📅\n\n` +
  `Elegí una opción:\n\n` +
  `1. Realizar una reserva\n` +
  `2. Cancelar una reserva\n` +
  `3. Modificar una reserva\n` +
  `4. Volver al menú principal`;

const MSG_MENU_DELIVERY =
  `*Delivery* 🚚\n\n` +
  `El servicio de delivery estará disponible próximamente.\n\n` +
  `Escribí *1* para volver al menú principal.`;

const MSG_MENU_CARTA =
  `*Ver la carta* 🍽️\n\n` +
  `Elegí una opción:\n\n` +
  `1. Carta del restaurante\n` +
  `2. Carta de delivery\n` +
  `3. Volver al menú principal`;

const MSG_MENU_PAGOS =
  `*Métodos de pago* 💳\n\n` +
  `Aceptamos:\n` +
  `• Efectivo\n` +
  `• Tarjeta de débito\n` +
  `• Tarjeta de crédito\n` +
  `• Transferencia bancaria\n\n` +
  `Escribí *1* para volver al menú principal.`;

const MSG_MENU_FAQ =
  `*Preguntas frecuentes* ❓\n\n` +
  `Elegí una opción:\n\n` +
  `1. 📍 Ubicación\n` +
  `2. 🍴 Tipo de cocina\n` +
  `3. 🕐 Días y horarios\n` +
  `4. 🥗 Opciones alimentarias\n` +
  `5. 👶 Menú infantil\n` +
  `6. 🐾 Mascotas\n` +
  `7. Volver al menú principal`;

// ─── Manejador principal ─────────────────────────────────────────────────────

async function manejarMensajeEntrante(message) {
  const from = message.from;
  const textoOriginal = obtenerTextoMensaje(message);

  const sesion = obtenerOSesionCrear(from);

  // Caso especial: imagen enviada mientras se espera comprobante de seña
  if (message.type === "image" && sesion.paso === "reserva_esperando_senia") {
    await procesarReservaConSenia(from, sesion);
    return;
  }

  if (!from || !textoOriginal) return;

  const texto = textoOriginal.toLowerCase().trim();

  // ── Reinicio global (desde cualquier paso) ───────────────────────────────
  if (["menu", "hola", "buenas", "inicio", "0"].includes(texto)) {
    resetearSesion(sesion);
    await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
    return;
  }

  // ── "1" vuelve al menú principal desde pasos terminales ─────────────────
  // (delivery, pagos, y cualquier paso donde se le dijo "escribí 1 para volver")
  const PASOS_TERMINALES = ["menu_delivery", "menu_pagos"];
  if (texto === "1" && PASOS_TERMINALES.includes(sesion.paso)) {
    resetearSesion(sesion);
    await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
    return;
  }

  // ── Menú principal ───────────────────────────────────────────────────────
  if (sesion.paso === "menu") {
    switch (texto) {
      case "1":
        sesion.paso = "menu_reservas";
        await enviarMensajeTexto(from, MSG_MENU_RESERVAS);
        return;
      case "2":
        sesion.paso = "menu_delivery";
        await enviarMensajeTexto(from, MSG_MENU_DELIVERY);
        return;
      case "3":
        sesion.paso = "menu_carta";
        await enviarMensajeTexto(from, MSG_MENU_CARTA);
        return;
      case "4":
        sesion.paso = "menu_pagos";
        await enviarMensajeTexto(from, MSG_MENU_PAGOS);
        return;
      case "5":
        sesion.paso = "menu_faq";
        await enviarMensajeTexto(from, MSG_MENU_FAQ);
        return;
      default:
        // Si el mensaje parece una despedida o agradecimiento, no respondemos nada
        // Si parece que quiere hacer algo, le mostramos el menú
        const PALABRAS_SILENCIO = ["gracias", "gracia", "ok", "okey", "dale", "buenisimo", "genial",
          "perfecto", "joya", "excelente", "re bien", "copado", "graciass", "👍", "🙏", "😊", "❤️"];
        const esSilencio = PALABRAS_SILENCIO.some(p => texto.includes(p));
        if (!esSilencio) {
          await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
        }
        return;
    }
  }

  // ── Submenú: Delivery ────────────────────────────────────────────────────
  if (sesion.paso === "menu_delivery") {
    if (texto === "1") {
      resetearSesion(sesion);
      await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
    } else {
      await enviarMensajeTexto(from, MSG_MENU_DELIVERY);
    }
    return;
  }

  // ── Submenú: Pagos ───────────────────────────────────────────────────────
  if (sesion.paso === "menu_pagos") {
    if (texto === "1") {
      resetearSesion(sesion);
      await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
    } else {
      await enviarMensajeTexto(from, MSG_MENU_PAGOS);
    }
    return;
  }

  // ── Submenú: Reservas ────────────────────────────────────────────────────
  if (sesion.paso === "menu_reservas") {
    switch (texto) {
      case "1":
        sesion.paso = "reserva_nombre";
        sesion.datos = {};
        await enviarMensajeTexto(from, "Perfecto. ¿Cuál es tu nombre y apellido?");
        return;
      case "2":
        sesion.paso = "cancelar_fecha";
        sesion.datos = {};
        await enviarMensajeTexto(
          from,
          "¿Para qué fecha querés cancelar la reserva?\n\nEscribila en formato *DD/MM/AAAA*\nEjemplo: *20/03/2026*"
        );
        return;
      case "3":
        sesion.paso = "modificar_fecha";
        sesion.datos = {};
        await enviarMensajeTexto(
          from,
          "¿Para qué fecha querés modificar la reserva?\n\nEscribila en formato *DD/MM/AAAA*\nEjemplo: *20/03/2026*"
        );
        return;
      case "4":
        resetearSesion(sesion);
        await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
        return;
      default:
        await enviarMensajeTexto(from, `Opción inválida.\n\n${MSG_MENU_RESERVAS}`);
        return;
    }
  }

  // ── Submenú: Carta ───────────────────────────────────────────────────────
  if (sesion.paso === "menu_carta") {
    const NAV_CARTA =
      `\n\n───────────────\n` +
      `*1.* Carta del restaurante  |  *2.* Carta de delivery  |  *3.* Volver al menú principal`;

    switch (texto) {
      case "1":
        await enviarMensajeTexto(
          from,
          `Aquí está nuestra carta del restaurante 🍽️\n\n${CARTA_RESTAURANTE_URL}` + NAV_CARTA
        );
        return;
      case "2":
        await enviarMensajeTexto(
          from,
          `Aquí está nuestra carta de delivery 🚚\n\n${CARTA_DELIVERY_URL}` + NAV_CARTA
        );
        return;
      case "3":
        resetearSesion(sesion);
        await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
        return;
      default:
        await enviarMensajeTexto(from, `Opción inválida.\n\n${MSG_MENU_CARTA}`);
        return;
    }
  }

  // ── Submenú: FAQ ─────────────────────────────────────────────────────────
  if (sesion.paso === "menu_faq") {
    switch (texto) {
      case "1":
        await enviarMensajeTexto(
          from,
          `📍 *Ubicación*\n\nAv. 58 3202, Necochea, Buenos Aires.\n\n` +
          `Google Maps: ${LINK_MAPS}` +
          NAV_FAQ
        );
        return;
      case "2":
        await enviarMensajeTexto(
          from,
          `🍴 *Tipo de cocina*\n\nEspecialidad en pescados y mariscos, con opciones de pastas y carnes.` +
          NAV_FAQ
        );
        return;
      case "3":
        await enviarMensajeTexto(
          from,
          `🕐 *Días y horarios*\n\n` +
          `• Mediodía: 12:00 a 15:00\n` +
          `• Primer turno nocturno: 20:00 a 22:00\n` +
          `• Segundo turno nocturno: 22:00 a 23:30\n\n` +
          `Si se le permite realizar la reserva es porque hay disponibilidad!` +
          NAV_FAQ
        );
        return;
      case "4":
        await enviarMensajeTexto(
          from,
          `🥗 *Opciones alimentarias*\n\n` +
          `Contamos con opciones:\n• Vegetarianas 🥬\n• Veganas 🌱\n• Sin gluten 🚫+🌾\n\n` +
          `Consultanos al momento de reservar si tenés algún requerimiento especial.` +
          NAV_FAQ
        );
        return;
      case "5":
        await enviarMensajeTexto(
          from,
          `👶 *Menú infantil*\n\nOfrecemos menú especial para niños:\n• Pastas 🍝\n• Milanesas de carne 🫓\n• Carne vacuna 🥩` +
          NAV_FAQ
        );
        return;
      case "6":
        await enviarMensajeTexto(
          from,
          `🐾 *Mascotas*\n\nLamentablemente no se aceptan mascotas en el local.` +
          NAV_FAQ
        );
        return;
      case "7":
        resetearSesion(sesion);
        await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
        return;
      default:
        await enviarMensajeTexto(from, `Opción inválida.\n\n${MSG_MENU_FAQ}`);
        return;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FLUJO: REALIZAR RESERVA
  // ════════════════════════════════════════════════════════════════════════════

  if (sesion.paso === "reserva_nombre") {
    if (textoOriginal.length < 3) {
      await enviarMensajeTexto(from, "Por favor ingresá tu nombre y apellido completo.");
      return;
    }
    sesion.datos.nombre = textoOriginal;
    sesion.paso = "reserva_fecha";
    await enviarMensajeTexto(
      from,
      "¿Para qué fecha querés la reserva?\n\nEscribila en formato *DD/MM/AAAA*\nEjemplo: *20/03/2026*"
    );
    return;
  }

  if (sesion.paso === "reserva_fecha") {
    const regexFecha = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = textoOriginal.match(regexFecha);

    if (!match) {
      await enviarMensajeTexto(from, "Formato inválido. Escribí la fecha así: *20/03/2026*");
      return;
    }

    const [, dia, mes, anio] = match;
    const fechaISO = `${anio}-${mes.padStart(2,"0")}-${dia.padStart(2,"0")}`;
    const fechaObj = new Date(`${fechaISO}T12:00:00`);

    if (isNaN(fechaObj.getTime())) {
      await enviarMensajeTexto(from, "La fecha ingresada no es válida. Intentá de nuevo: *DD/MM/AAAA*");
      return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    if (fechaObj < hoy) {
      await enviarMensajeTexto(from, "La fecha ingresada ya pasó. Escribí una fecha futura.");
      return;
    }

    // ── VERIFICAR DÍA CERRADO ───────────────────────────────────────────────
    try {
      const response = await axios.get(`${BACKEND_URL}/dias-cerrados/verificar`, {
        params: { fecha: fechaISO }
      });

      const cierres = response.data.cierres || [];

      if (cierres.includes("todo")) {
        await enviarMensajeTexto(
          from,
          `Lo sentimos, el restaurante permanecerá cerrado el *${textoOriginal}* 😔.\n\n` +
          `Por favor elegí otra fecha.`
        );
        return;
      }

      sesion.datos.cierresDia = cierres;

    } catch (err) {
      console.error("[BOT verificar día cerrado]", err.message);
      // Si falla la consulta dejamos pasar, el backend lo rechazará igual
    }
    // ───────────────────────────────────────────────────────────────────────

    sesion.datos.fecha = fechaISO;
    sesion.paso = "reserva_hora";

    await enviarMensajeTexto(
      from,
      `¿A qué hora querés la reserva? ⏰\n\n` +
      `Escribila en formato *HH:MM*. Ejemplo: *21:00*\n\n` +
      `Nuestros horarios:\n` +
      `• Mediodía: 12:00 a 15:00\n` +
      `• Noche: 20:00 a 23:30`
    );
    return;
  }

  if (sesion.paso === "reserva_hora") {
    const regexHora = /^(\d{1,2})[:.](\d{2})$/;
    const match = textoOriginal.match(regexHora);

    if (!match) {
      await enviarMensajeTexto(from, "Formato inválido. Escribí la hora así: *21:00*");
      return;
    }

    const [, hStr, mStr] = match;
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    if (h > 23 || m > 59) {
      await enviarMensajeTexto(from, "Hora inválida. Ejemplo válido: *21:00*");
      return;
    }

    const horaFormateada = `${String(h).padStart(2, "0")}:${mStr}`;
    const turno = calcularTurno(horaFormateada);
    const turnoLabel = calcularTurnoLabel(turno);

    // ── VERIFICAR TURNO CERRADO ─────────────────────────────────────────────────
    const cierresDia = sesion.datos.cierresDia || [];

    if (turno === "maniana" && cierresDia.includes("maniana")) {
      if (cierresDia.includes("noche")) {
        await enviarMensajeTexto(
          from,
          `Lo sentimos, el restaurante permanecerá cerrado el *${formatearFecha(sesion.datos.fecha)}* 😔.\n\n` +
          `Por favor ingresá otra fecha.`
        );
        sesion.paso = "reserva_fecha";
      } else {
        await enviarMensajeTexto(
          from,
          `Lo sentimos, el restaurante permanecerá cerrado en turno mediodía el *${formatearFecha(sesion.datos.fecha)}* 😔.\n\n` +
          `Podés reservar para la noche (20:00 - 23:30) o elegir otra fecha.`
        );
      }
      return;
    }

    if ((turno === "noche_1" || turno === "noche_2") && cierresDia.includes("noche")) {
      if (cierresDia.includes("maniana")) {
        await enviarMensajeTexto(
          from,
          `Lo sentimos, el restaurante permanecerá cerrado el *${formatearFecha(sesion.datos.fecha)}* 😔.\n\n` +
          `Por favor ingresá otra fecha.`
        );
        sesion.paso = "reserva_fecha";
      } else {
        await enviarMensajeTexto(
          from,
          `Lo sentimos, el restaurante permanecerá cerrado en turno noche el *${formatearFecha(sesion.datos.fecha)}* 😔.\n\n` +
          `Podés reservar para el mediodía (12:00 - 15:00) o en caso de querer turno noche, elegir otra fecha.`
        );
      }
      return;
    }
    // ───────────────────────────────────────────────────────────────────────────
          
    sesion.datos.hora       = horaFormateada;
    sesion.datos.turno      = turno;
    sesion.datos.turnoLabel = turnoLabel;
    sesion.paso             = "reserva_personas";

    await enviarMensajeTexto(from, "¿Para cuántas personas sería la reserva? Tenemos mesas disponibles para grupos de 1 a 12 personas.");
    return;
  }

  if (sesion.paso === "reserva_personas") {
    const cantidad = parseInt(texto, 10);

    if (isNaN(cantidad) || cantidad <= 0) {
      await enviarMensajeTexto(from, "Indicame un número válido de personas.");
      return;
    }

    if (cantidad > 12) {
      await enviarMensajeTexto(
        from,
        `Para grupos de más de 12 personas, la reserva se coordina directamente por llamada telefónica. 📞\n\n` +
        `Comunicate con nosotros al:\n*+54 9 2262 518504*\n\n` +
        `¡Estaremos encantados de atenderte!`
      );
      resetearSesion(sesion);
      return;
    }

    sesion.datos.cantidad_personas = cantidad;
    sesion.datos.telefono          = from;
    sesion.paso                    = "reserva_confirmar";

    const fechaDisplay = formatearFecha(sesion.datos.fecha);

    await enviarMensajeTexto(
      from,
      `Confirmá los datos de tu reserva:\n\n` +
      `👤 Nombre: ${sesion.datos.nombre}\n` +
      `📅 Fecha: ${fechaDisplay}\n` +
      `🕐 Turno: ${sesion.datos.turnoLabel}\n` +
      `👥 Personas: ${sesion.datos.cantidad_personas}\n\n` +
      `Respondé:\n*1.* Confirmar ✅\n*2.* Cancelar ❌`
    );
    return;
  }

  if (sesion.paso === "reserva_confirmar") {
    if (texto === "2") {
      resetearSesion(sesion);
      await enviarMensajeTexto(
        from,
        "Reserva cancelada. Escribí *1* para volver al menú principal cuando quieras."
      );
      return;
    }

    if (texto !== "1") {
      await enviarMensajeTexto(from, "Respondé *1* para confirmar o *2* para cancelar.");
      return;
    }

    // ── Reserva con seña (8+ personas) ──────────────────────────────────────
    if (sesion.datos.cantidad_personas >= 8) {
      const monto       = sesion.datos.cantidad_personas * 10000;
      const montoFormat = monto.toLocaleString("es-AR");

      sesion.paso = "reserva_esperando_senia";

      await enviarMensajeTexto(
        from,
        `Para reservas de 8 o más personas se requiere una *seña de $${montoFormat}*.\n\n` +
        `Podés abonarla por transferencia bancaria:\n\n` +
        `🏦 *Alias:* ${ALIAS_MP}\n` +
        `💰 *Monto:* $${montoFormat}\n\n` +
        `Una vez realizado el pago, *envianos el comprobante como imagen* y recepción lo verificará.\n` +
        `Tu reserva quedará confirmada una vez aprobada la seña. ✅`
      );
      return;
    }

    // ── Reserva sin seña: conectar al backend ────────────────────────────────
    await procesarReservaEnBackend(from, sesion);
    return;
  }

  // ── Esperar comprobante de seña ──────────────────────────────────────────
  if (sesion.paso === "reserva_esperando_senia") {
    if (message.type === "image") {
      await procesarReservaConSenia(from, sesion);
      return;
    }

    await enviarMensajeTexto(
      from,
      "Por favor envianos el *comprobante de pago como imagen* 📷\n\n" +
      "Una vez que recepción lo verifique, te confirmamos la reserva."
    );
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FLUJO: CANCELAR RESERVA
  // ════════════════════════════════════════════════════════════════════════════

  if (sesion.paso === "cancelar_fecha") {
    const regexFecha = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = textoOriginal.match(regexFecha);

    if (!match) {
      await enviarMensajeTexto(from, "Formato inválido. Escribí la fecha así: *20/03/2026*");
      return;
    }

    const [, dia, mes, anio] = match;
    const fechaISO = `${anio}-${mes.padStart(2,"0")}-${dia.padStart(2,"0")}`;
    sesion.datos.fechaBusqueda = fechaISO;
    sesion.paso = "cancelar_buscar";

    // Disparar búsqueda inmediatamente con la fecha ingresada
    const telefonoNorm = from.replace(/\D/g, "");
    try {
      const response = await axios.get(`${BACKEND_URL}/reservas/por-telefono`, {
        params: { telefono: telefonoNorm, fecha: fechaISO },
      });

      const reservas = (response.data.reservas || []).filter(r => {
        const soloFecha = r.fecha.split("T")[0];
        return soloFecha === fechaISO;
      });

      if (reservas.length === 0) {
        await enviarMensajeTexto(from, `No encontré reservas activas para el *${textoOriginal}*.\n\nEscribí *1* para volver al menú principal.`);
        resetearSesion(sesion);
        return;
      }

      sesion.datos.reservasEncontradas = reservas;
      sesion.paso = "cancelar_elegir";

      if (reservas.length === 1) {
        const r = reservas[0];
        sesion.datos.reservaACancelar = r;
        sesion.paso = "cancelar_confirmar";
        await enviarMensajeTexto(
          from,
          `¿Confirmás que querés cancelar esta reserva?\n\n` +
          `📅 Fecha: ${formatearFecha(r.fecha)}\n` +
          `🕐 Horario: ${calcularTurnoLabel(r.turno)}\n` +
          `👥 Personas: ${r.cantidad_personas}\n\n` +
          `*1.* Sí, cancelar ❌\n*2.* No, volver`
        );
        return;
      }

      let msg = `Encontré estas reservas para el *${textoOriginal}*:\n\n`;
      reservas.forEach((r, i) => {
        msg += `*${i + 1}.* 📅 ${formatearFecha(r.fecha)} | 🕐 ${calcularTurnoLabel(r.turno)} | 👥 ${r.cantidad_personas} personas (${r.estado})\n`;
      });
      msg += `\n¿Cuál querés cancelar? Respondé con el número.`;
      if (reservas.length > 1) msg += `\nO escribí *0* para no cancelar ninguna.`;
      await enviarMensajeTexto(from, msg);
    } catch (err) {
      console.error("[BOT cancelar_fecha]", err.message);
      await enviarMensajeTexto(from, "Hubo un problema al buscar tus reservas. Intentá de nuevo más tarde.");
      resetearSesion(sesion);
    }
    return;
  }

    if (sesion.paso === "cancelar_buscar") {
    const telefonoNorm = from.replace(/\D/g, "");
    const hoy = new Date().toISOString().split("T")[0];

    try {
      const response = await axios.get(`${BACKEND_URL}/reservas/por-telefono`, {
        params: { telefono: telefonoNorm, fecha: hoy },
      });

      const reservas = response.data.reservas || [];

      if (reservas.length === 0) {
        await enviarMensajeTexto(
          from,
          "No encontré reservas activas para tu número de hoy en adelante.\n\n" +
          "Escribí *1* para volver al menú principal."
        );
        resetearSesion(sesion);
        return;
      }

      sesion.datos.reservasEncontradas = reservas;
      sesion.paso = "cancelar_elegir";

      let msg = `Encontré ${reservas.length === 1 ? "esta reserva" : "estas reservas"} a tu nombre:\n\n`;

      reservas.forEach((r, i) => {
        const fechaDisplay = formatearFecha(r.fecha);
        msg += `*${i + 1}.* 📅 ${fechaDisplay} | 🕐 ${calcularTurnoLabel(r.turno)} | 👥 ${r.cantidad_personas} personas (${r.estado})\n`;
      });

      msg += `\n¿Cuál querés cancelar? Respondé con el número.`;
      if (reservas.length > 1) msg += `\nO escribí *0* para no cancelar ninguna.`;

      await enviarMensajeTexto(from, msg);
    } catch (err) {
      console.error("[BOT cancelar_buscar]", err.message);
      await enviarMensajeTexto(from, "Hubo un problema al buscar tus reservas. Intentá de nuevo más tarde.");
      resetearSesion(sesion);
    }
    return;
  }

  if (sesion.paso === "cancelar_elegir") {
    if (texto === "0") {
      resetearSesion(sesion);
      await enviarMensajeTexto(from, "De acuerdo. Escribí *1* para volver al menú principal.");
      return;
    }

    const idx = parseInt(texto, 10) - 1;
    const reservas = sesion.datos.reservasEncontradas || [];

    if (isNaN(idx) || idx < 0 || idx >= reservas.length) {
      await enviarMensajeTexto(from, `Opción inválida. Respondé con un número del 1 al ${reservas.length}.`);
      return;
    }

    const reservaAcancelar = reservas[idx];
    sesion.datos.reservaACancelar = reservaAcancelar;
    sesion.paso = "cancelar_confirmar";

    const fechaDisplay = formatearFecha(reservaAcancelar.fecha);

    await enviarMensajeTexto(
      from,
      `¿Confirmás que querés cancelar esta reserva?\n\n` +
      `📅 Fecha: ${fechaDisplay}\n` +
      `🕐 Horario: ${calcularTurnoLabel(reservaAcancelar.turno)}\n` +
      `👥 Personas: ${reservaAcancelar.cantidad_personas}\n\n` +
      `*1.* Sí, cancelar ❌\n*2.* No, volver`
    );
    return;
  }

  if (sesion.paso === "cancelar_confirmar") {
    if (texto === "2") {
      resetearSesion(sesion);
      await enviarMensajeTexto(from, `De acuerdo, no se canceló nada.\n\n${MSG_MENU_PRINCIPAL}`);
      return;
    }

    if (texto !== "1") {
      await enviarMensajeTexto(from, "Respondé *1* para confirmar la cancelación o *2* para volver.");
      return;
    }

    const reserva = sesion.datos.reservaACancelar;

    try {
      await axios.patch(`${BACKEND_URL}/reservas/${reserva.id}/cancelar`);

      const fechaDisplay = formatearFecha(reserva.fecha);
      resetearSesion(sesion);

      await enviarMensajeTexto(
        from,
        `✅ Tu reserva del *${fechaDisplay}* (${reserva.turno}) fue cancelada correctamente.\n\n` +
        `Esperamos verte pronto. Escribí *1* para volver al menú principal.`
      );
    } catch (err) {
      console.error("[BOT cancelar_confirmar]", err.message);
      await enviarMensajeTexto(
        from,
        "Hubo un problema al cancelar la reserva. Por favor comunicate directamente con el restaurante."
      );
      resetearSesion(sesion);
    }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FLUJO: MODIFICAR RESERVA
  // ════════════════════════════════════════════════════════════════════════════

  if (sesion.paso === "modificar_fecha") {
    const regexFecha = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = textoOriginal.match(regexFecha);

    if (!match) {
      await enviarMensajeTexto(from, "Formato inválido. Escribí la fecha así: *20/03/2026*");
      return;
    }

    const [, dia, mes, anio] = match;
    const fechaISO = `${anio}-${mes.padStart(2,"0")}-${dia.padStart(2,"0")}`;
    sesion.datos.fechaBusqueda = fechaISO;
    sesion.paso = "modificar_buscar";

    const telefonoNorm = from.replace(/\D/g, "");
    try {
      const response = await axios.get(`${BACKEND_URL}/reservas/por-telefono`, {
        params: { telefono: telefonoNorm, fecha: fechaISO },
      });

      const reservas = (response.data.reservas || []).filter(r => {
        const soloFecha = r.fecha.split("T")[0];
        return soloFecha === fechaISO;
      });

      if (reservas.length === 0) {
        await enviarMensajeTexto(from, `No encontré reservas activas para el *${textoOriginal}*.\n\nEscribí *1* para volver al menú principal.`);
        resetearSesion(sesion);
        return;
      }

      sesion.datos.reservasEncontradas = reservas;

      if (reservas.length === 1) {
        sesion.datos.reservaAModificar = reservas[0];
        sesion.paso = "modificar_que";
        const fechaDisplay = formatearFecha(reservas[0].fecha);
        await enviarMensajeTexto(
          from,
          `Encontré esta reserva a tu nombre:\n\n` +
          `📅 Fecha: ${fechaDisplay}\n` +
          `🕐 Horario: ${calcularTurnoLabel(reservas[0].turno)}\n` +
          `👥 Cantidad de personas: ${reservas[0].cantidad_personas}\n\n` +
          `¿Qué querés modificar?\n\n` +
          `*1.* Fecha 📅\n` +
          `*2.* Horario 🕐\n` +
          `*3.* Cantidad de personas 👥`
        );
        return;
      }

      sesion.paso = "modificar_elegir";
      let msg = `Encontré estas reservas para el *${textoOriginal}*:\n\n`;
      reservas.forEach((r, i) => {
        msg += `*${i + 1}.* 📅 ${formatearFecha(r.fecha)} | 🕐 ${calcularTurnoLabel(r.turno)} | 👥 ${r.cantidad_personas} personas\n`;
      });
      msg += `\n¿Cuál querés modificar? Respondé con el número.`;
      await enviarMensajeTexto(from, msg);
    } catch (err) {
      console.error("[BOT modificar_fecha]", err.message);
      await enviarMensajeTexto(from, "Hubo un problema al buscar tus reservas. Intentá de nuevo más tarde.");
      resetearSesion(sesion);
    }
    return;
  }

    if (sesion.paso === "modificar_buscar") {
    const telefonoNorm = from.replace(/\D/g, "");
    const hoy = new Date().toISOString().split("T")[0];

    try {
      const response = await axios.get(`${BACKEND_URL}/reservas/por-telefono`, {
        params: { telefono: telefonoNorm, fecha: hoy },
      });

      const reservas = response.data.reservas || [];

      if (reservas.length === 0) {
        await enviarMensajeTexto(
          from,
          "No encontré reservas activas para tu número.\n\nEscribí *1* para volver al menú principal."
        );
        resetearSesion(sesion);
        return;
      }

      sesion.datos.reservasEncontradas = reservas;

      // Si hay una sola reserva, la seleccionamos automáticamente y vamos directo a qué modificar
      if (reservas.length === 1) {
        sesion.datos.reservaAModificar = reservas[0];
        sesion.paso = "modificar_que";
        const fechaDisplay = formatearFecha(reservas[0].fecha);
        await enviarMensajeTexto(
          from,
          `Encontré esta reserva a tu nombre:\n\n` +
          `📅 Fecha: ${fechaDisplay}\n` +
          `🕐 Horario: ${calcularTurnoLabel(reservas[0].turno)}\n` +
          `👥 Cantidad de personas: ${reservas[0].cantidad_personas}\n\n` +
          `¿Qué querés modificar?\n\n` +
          `*1.* Fecha 📅\n` +
          `*2.* Horario 🕐\n` +
          `*3.* Cantidad de personas 👥`
        );
        return;
      }

      sesion.paso = "modificar_elegir";

      let msg = `Encontré estas reservas a tu nombre:\n\n`;

      reservas.forEach((r, i) => {
        const fechaDisplay = formatearFecha(r.fecha);
        msg += `*${i + 1}.* 📅 ${fechaDisplay} | 🕐 ${calcularTurnoLabel(r.turno)} | 👥 ${r.cantidad_personas} personas\n`;
      });

      msg += `\n¿Cuál querés modificar? Respondé con el número.`;
      await enviarMensajeTexto(from, msg);
    } catch (err) {
      console.error("[BOT modificar_buscar]", err.message);
      await enviarMensajeTexto(from, "Hubo un problema al buscar tus reservas. Intentá de nuevo más tarde.");
      resetearSesion(sesion);
    }
    return;
  }

  if (sesion.paso === "modificar_elegir") {
    const idx = parseInt(texto, 10) - 1;
    const reservas = sesion.datos.reservasEncontradas || [];

    if (isNaN(idx) || idx < 0 || idx >= reservas.length) {
      await enviarMensajeTexto(from, `Opción inválida. Respondé con un número del 1 al ${reservas.length}.`);
      return;
    }

    sesion.datos.reservaAModificar = reservas[idx];
    sesion.paso = "modificar_que";

    await enviarMensajeTexto(
      from,
      `¿Qué querés modificar?\n\n` +
      `*1.* Fecha 📅\n` +
      `*2.* Horario 🕐\n` +
      `*3.* Cantidad de personas 👥`
    );
    return;
  }

  if (sesion.paso === "modificar_que") {
    switch (texto) {
      case "1":
        sesion.paso = "modificar_nueva_fecha";
        await enviarMensajeTexto(
          from,
          "¿Cuál es la nueva fecha?\n\nFormato: *DD/MM/AAAA*\nEjemplo: *25/03/2026*"
        );
        return;
      case "2":
        sesion.paso = "modificar_nueva_hora";
        await enviarMensajeTexto(
          from,
          `¿A qué hora querés cambiar? ⏰\n\nFormato *HH:MM*. Ejemplo: *21:00*\n\n` +
          `Nuestros horarios:\n• Mediodía: 12:00 a 15:00\n• Noche: 20:00 a 23:30`
        );
        return;
      case "3":
        sesion.paso = "modificar_nueva_cantidad";
        await enviarMensajeTexto(from, "¿Cuántas personas van a ser?");
        return;
      default:
        await enviarMensajeTexto(from, "Respondé *1*, *2* o *3*.");
        return;
    }
  }

  if (sesion.paso === "modificar_nueva_fecha") {
    const regexFecha = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = textoOriginal.match(regexFecha);

    if (!match) {
      await enviarMensajeTexto(from, "Formato inválido. Escribí la fecha así: *25/03/2026*");
      return;
    }

    const [, dia, mes, anio] = match;
    const fechaISO = `${anio}-${mes.padStart(2,"0")}-${dia.padStart(2,"0")}`;
    const fechaObj = new Date(`${fechaISO}T12:00:00`);

    if (isNaN(fechaObj.getTime())) {
      await enviarMensajeTexto(from, "La fecha no es válida. Intentá de nuevo.");
      return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    if (fechaObj < hoy) {
      await enviarMensajeTexto(from, "La fecha ya pasó. Ingresá una fecha futura.");
      return;
    }

    sesion.datos.nuevaFecha = fechaISO;
    sesion.paso = "modificar_confirmar";
    await confirmarModificacion(from, sesion);
    return;
  }

  if (sesion.paso === "modificar_nueva_hora") {
    const regexHora = /^(\d{1,2})[:.](\d{2})$/;
    const match = textoOriginal.match(regexHora);

    if (!match) {
      await enviarMensajeTexto(from, "Formato inválido. Escribí la hora así: *21:00*");
      return;
    }

    const [, hStr, mStr] = match;
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    if (h > 23 || m > 59) {
      await enviarMensajeTexto(from, "Hora inválida. Ejemplo válido: *21:00*");
      return;
    }

    const horaFormateada = `${String(h).padStart(2, "0")}:${mStr}`;
    const turno = calcularTurno(horaFormateada);

    sesion.datos.nuevoTurno      = turno;
    sesion.datos.nuevoTurnoLabel = calcularTurnoLabel(turno);
    sesion.datos.nuevaHora       = horaFormateada;
    sesion.paso = "modificar_confirmar";
    await confirmarModificacion(from, sesion);
    return;
  }

  if (sesion.paso === "modificar_nueva_cantidad") {
    const cantidad = parseInt(texto, 10);

    if (isNaN(cantidad) || cantidad <= 0) {
      await enviarMensajeTexto(from, "Indicame un número válido de personas.");
      return;
    }

    sesion.datos.nuevaCantidad = cantidad;
    sesion.paso = "modificar_confirmar";
    await confirmarModificacion(from, sesion);
    return;
  }

  if (sesion.paso === "modificar_confirmar") {
    if (texto === "2") {
      resetearSesion(sesion);
      await enviarMensajeTexto(from, "Modificación cancelada.\n\nSi querés seguir navegando, escribí *1* para volver al menú de reservas.");
      return;
    }

    if (texto !== "1") {
      await enviarMensajeTexto(from, "Respondé *1* para confirmar o *2* para cancelar.");
      return;
    }

    await ejecutarModificacion(from, sesion);
    return;
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  resetearSesion(sesion);
  await enviarMensajeTexto(from, MSG_MENU_PRINCIPAL);
}

// ─── Funciones auxiliares de reserva ─────────────────────────────────────────

async function procesarReservaEnBackend(from, sesion) {
  const { nombre, fecha, hora, cantidad_personas, turnoLabel } = sesion.datos;
  const telefonoNorm = from.replace(/\D/g, "");

  try {
    await axios.post(`${BACKEND_URL}/reservas`, {
      nombre,
      telefono: telefonoNorm,
      fecha,
      hora,
      cantidad_personas,
    });

    const fechaDisplay = formatearFecha(fecha);
    resetearSesion(sesion);

    await enviarMensajeTexto(
      from,
      `✅ *Tu reserva quedó registrada correctamente.*\n\n` +
      `📅 Fecha: ${fechaDisplay}\n` +
      `🕐 Turno: ${turnoLabel || hora}\n` +
      `👥 Personas: ${cantidad_personas}\n\n` +
      `⏰ *Recordá que tenemos una tolerancia de 15-20 minutos.* Pasado ese tiempo, la mesa puede quedar sujeta a disponibilidad.\n\n` +
      `¡Esperamos verte pronto! 🍽️\n\n` +
      `───────────────\n` +
      `Si necesitás algo más escribí *1*, o podés cerrar el chat tranquilo. 😊`
    );
  } catch (err) {
    const status = err.response?.status;
    const msg    = err.response?.data?.error || "";

    console.error("[BOT procesarReservaEnBackend]", status, msg);

    if (status === 400 && msg.includes("disponibilidad")) {
      await enviarMensajeTexto(
        from,
        "Lo sentimos, no hay disponibilidad para ese turno y fecha. 😔\n\n" +
        "¿Querés intentar con otro turno o fecha? Escribí *1* para volver al menú principal."
      );
    } else if (status === 400 && msg.includes("Límite")) {
      await enviarMensajeTexto(
        from,
        "Ya tenés el máximo de reservas permitidas para ese día.\n\n" +
        "Escribí *1* para volver al menú principal."
      );
    } else if (status === 400 && msg.includes("no abre ese día")) {
        await enviarMensajeTexto(
          from,
          "Lo sentimos, el restaurante no está abierto para ese día o turno. 😔\n\n" +
          "Por favor elija otra fecha o turno. Escribí *1* para volver al menú principal."
        );
    } else {
      await enviarMensajeTexto(
        from,
        "Hubo un problema al registrar tu reserva. Por favor intentá de nuevo más tarde o comunicate con el restaurante."
      );
    }

    resetearSesion(sesion);
  }
}

async function procesarReservaConSenia(from, sesion) {
  const { nombre, fecha, hora, cantidad_personas } = sesion.datos;
  const telefonoNorm = from.replace(/\D/g, "");

  try {
    await axios.post(`${BACKEND_URL}/reservas`, {
      nombre,
      telefono: telefonoNorm,
      fecha,
      hora,
      cantidad_personas,
      estado_inicial: "pendiente_senia",
    });

    // Notificar por email a recepción
    try {
      await enviarNotificacionSenia({
        nombre,
        fecha,
        cantidad_personas,
        monto: cantidad_personas * (process.env.MONTO_SENIA_POR_PERSONA || 10000),
        telefono: telefonoNorm,
      });
    } catch (mailErr) {
      console.error("[mailer] Error al enviar notificación:", mailErr.message);
    }

    const fechaDisplay = formatearFecha(fecha);
    resetearSesion(sesion);

    await enviarMensajeTexto(
      from,
      `📨 *Comprobante recibido. ¡Gracias!*\n\n` +
      `Tu reserva para el *${fechaDisplay}* (${cantidad_personas} personas) está *pendiente de verificación*.\n\n` +
      `Recepción revisará el pago y te confirmamos a la brevedad. ✅`
    );
  } catch (err) {
    const status = err.response?.status;
    const msg    = err.response?.data?.error || "";

    console.error("[BOT procesarReservaConSenia]", status, msg);

    if (status === 400 && msg.includes("Límite")) {
      await enviarMensajeTexto(
        from,
        "No se pudo registrar tu reserva porque ya tenés el máximo de reservas permitidas para ese día. 😔\n\n" +
        "Si necesitás ayuda comunicate con el restaurante al *+54 9 2262 518504*."
      );
    } else if (status === 400 && msg.includes("disponibilidad")) {
      await enviarMensajeTexto(
        from,
        "Lo sentimos, no hay disponibilidad para ese turno y fecha. 😔\n\n" +
        "Comunicate con el restaurante al *+54 9 2262 518504*."
      );
    } else {
      await enviarMensajeTexto(
        from,
        "Hubo un problema al registrar tu reserva. Por favor comunicate directamente con el restaurante al *+54 9 2262 518504*."
      );
    }

    resetearSesion(sesion);
  }
}

async function confirmarModificacion(from, sesion) {
  const reserva = sesion.datos.reservaAModificar;
  const fechaDisplay = formatearFecha(reserva.fecha);

  let cambioTexto = "";

  if (sesion.datos.nuevaFecha) {
    const nuevaFechaDisplay = formatearFecha(sesion.datos.nuevaFecha);
    cambioTexto = `📅 Nueva fecha: *${nuevaFechaDisplay}*`;
  } else if (sesion.datos.nuevoTurno) {
    cambioTexto = `🕐 Nuevo horario: *${calcularTurnoLabel(sesion.datos.nuevoTurno)}*`;
  } else if (sesion.datos.nuevaCantidad) {
    cambioTexto = `👥 Nueva cantidad: *${sesion.datos.nuevaCantidad} personas*`;
  }

  await enviarMensajeTexto(
    from,
    `Confirmá el cambio:\n\n` +
    `📅 Fecha actual: ${fechaDisplay}\n` +
    `🕐 Horario actual: ${calcularTurnoLabel(reserva.turno)}\n` +
    `👥 Personas actuales: ${reserva.cantidad_personas}\n\n` +
    `${cambioTexto}\n\n` +
    `*1.* Confirmar ✅\n*2.* Cancelar ❌`
  );
}

async function ejecutarModificacion(from, sesion) {
  const reserva = sesion.datos.reservaAModificar;

  const nuevaFecha    = sesion.datos.nuevaFecha    || reserva.fecha;
  const nuevoTurno    = sesion.datos.nuevoTurno    || reserva.turno;
  const nuevaHora     = sesion.datos.nuevaHora     || reserva.hora;
  const nuevaCantidad = sesion.datos.nuevaCantidad || reserva.cantidad_personas;
  const nuevoLabel    = sesion.datos.nuevoTurnoLabel || calcularTurnoLabel(nuevoTurno);

  try {
    await axios.patch(`${BACKEND_URL}/reservas/${reserva.id}/cancelar`);

    await axios.post(`${BACKEND_URL}/reservas`, {
      nombre:            reserva.nombre,
      telefono:          from.replace(/\D/g, ""),
      fecha:             nuevaFecha,
      hora:              nuevaHora,
      cantidad_personas: nuevaCantidad,
    });

    const fechaDisplay = formatearFecha(nuevaFecha);
    resetearSesion(sesion);

    await enviarMensajeTexto(
      from,
      `✅ *Reserva modificada correctamente.*\n\n` +
      `📅 Fecha: ${fechaDisplay}\n` +
      `🕐 Turno: ${nuevoLabel}\n` +
      `👥 Personas: ${nuevaCantidad}\n\n` +
      `⏰ Recordá la tolerancia de 15-20 minutos.\n\n` +
      `Si necesitás algo más, escribí *1* para volver al menú de reservas.`
    );
  } catch (err) {
    const status = err.response?.status;
    const msg    = err.response?.data?.error || "";

    console.error("[BOT ejecutarModificacion]", status, msg);

    if (status === 400 && msg.includes("disponibilidad")) {
      await enviarMensajeTexto(
        from,
        "Lo sentimos, no hay disponibilidad para el nuevo turno/fecha. 😔\n\n" +
        "Tu reserva original *no fue modificada*. Escribí *1* para intentar con otra opción."
      );
    } else if (status === 400 && msg.includes("Límite")) {
      await enviarMensajeTexto(
        from,
        "No se pudo modificar la reserva porque ya tenés el máximo de reservas permitidas para ese día. 😔\n\n" +
        "Tu reserva original *no fue modificada*. Escribí *1* para volver al menú de reservas."
      );
    } else {
      await enviarMensajeTexto(
        from,
        "Hubo un problema al modificar la reserva. Por favor comunicate con el restaurante."
      );
    }

    resetearSesion(sesion);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  manejarMensajeEntrante,
  enviarMensajeTexto,
};