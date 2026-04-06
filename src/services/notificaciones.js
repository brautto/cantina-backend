// src/services/notificaciones.js

/**
 * Servicio de notificaciones (placeholder).
 * Hoy: log.
 * Mañana: WhatsApp / UI / Email, etc.
 *
 * Idea:
 * - Guardamos alertas en DB (alerta_sistema)
 * - Este servicio puede, además, "emitir" una notificación al canal que elijas.
 */

async function notificarAlerta({ canal, titulo, mensaje, meta }) {
    // canal: 'log' | 'whatsapp' | 'ui' | 'email' ...
    // meta: objeto con datos extra
  
    // Por ahora dejamos solo log (MVP)
    console.error('🔔 NOTIFICACIÓN', {
      canal,
      titulo,
      mensaje,
      meta,
    });
  
    // Preparado para el futuro:
    // if (canal === 'whatsapp') { ... }
    // if (canal === 'ui') { ... }  // en UI se leerá de alerta_sistema
  }
  
  module.exports = { notificarAlerta };