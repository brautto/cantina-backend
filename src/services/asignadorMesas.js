// src/services/asignadorMesas.js

/**
 * Asigna mesas a reservas usando backtracking con:
 *   - MRV dinámico: en cada nivel elige la reserva con menos candidatos disponibles.
 *   - Forward checking: al asignar, verifica que todas las reservas restantes
 *     mantengan al menos un candidato. Poda inmediata si alguna queda vacía.
 *   - Timeout configurable: aborta y devuelve null si se supera TIMEOUT_MS.
 *
 * API pública sin cambios:
 *   asignarMesasBacktracking(mesas, reservas) → Map<reservaId, mesaId> | null
 *
 * Entradas:
 *   mesas    — mesas disponibles del turno: [{ id, min_capacidad, max_capacidad }]
 *   reservas — reservas a asignar (pendientes + nueva virtual si aplica):
 *              [{ id, cantidad_personas }]
 *
 * Salida:
 *   Map reservaId → mesaId si hay asignación completa, null si no.
 */

const TIMEOUT_MS = Number(process.env.ORACULO_TIMEOUT_MS ?? 3000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Devuelve las mesas compatibles con una reserva, ordenadas por menor desperdicio.
 * Se llama una sola vez al inicio para construir el mapa base de candidatos.
 */
function buildCandidates(mesas, reserva) {
  const n = reserva.cantidad_personas;
  return mesas
    .filter(m => m.min_capacidad <= n && n <= m.max_capacidad)
    .sort((a, b) => {
      // 1) Mesas más restrictivas primero (min_capacidad más alto).
      //    Una mesa min=8 solo sirve para grupos grandes → usarla antes
      //    no le "roba" opciones a reservas pequeñas (LCV aproximado).
      if (a.min_capacidad !== b.min_capacidad) return b.min_capacidad - a.min_capacidad;
      // 2) Menor desperdicio como desempate
      const dA = a.max_capacidad - n;
      const dB = b.max_capacidad - n;
      if (dA !== dB) return dA - dB;
      // 3) Desempate estable
      return a.max_capacidad - b.max_capacidad;
    });
}

/**
 * Dado el mapa base de candidatos y el set de mesas actualmente libres,
 * devuelve cuántos candidatos tiene una reserva en el estado actual.
 * O(candidatos de esa reserva).
 */
function countAvailable(candidatosBase, reservaId, mesasLibres) {
  const lista = candidatosBase.get(reservaId) || [];
  let count = 0;
  for (const m of lista) {
    if (mesasLibres.has(m.id)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backtracking con MRV + Forward Checking + Timeout
// ---------------------------------------------------------------------------

/**
 * @param {Set<number>}        pendientes      — ids de reservas aún no asignadas
 * @param {Map<id, mesa[]>}    candidatosBase  — candidatos iniciales por reserva (orden: menor desperdicio)
 * @param {Map<id, reserva>}   reservasPorId   — lookup rápido de objeto reserva
 * @param {Set<number>}        mesasLibres     — ids de mesas disponibles en este nivel
 * @param {Map<id, id>}        asignacion      — asignación parcial en construcción
 * @param {number}             deadline        — timestamp límite (Date.now() + TIMEOUT_MS)
 * @returns {boolean}
 */
function backtrack(pendientes, candidatosBase, reservasPorId, mesasLibres, asignacion, deadline) {
  // Timeout check
  if (Date.now() > deadline) throw new Error('TIMEOUT');

  // Caso base: todas asignadas
  if (pendientes.size === 0) return true;

  // ── MRV: elegir la reserva pendiente con menos candidatos disponibles ──
  let mejorId = null;
  let mejorCount = Infinity;

  for (const id of pendientes) {
    const count = countAvailable(candidatosBase, id, mesasLibres);
    if (count === 0) return false;   // fallo anticipado: dominio ya vacío
    if (count < mejorCount) {
      mejorCount = count;
      mejorId = id;
    }
  }

  const reservaActual = reservasPorId.get(mejorId);
  const candidatos = candidatosBase.get(mejorId) || [];

  pendientes.delete(mejorId);

  for (const mesa of candidatos) {
    if (!mesasLibres.has(mesa.id)) continue;

    // ── Asignar ──
    mesasLibres.delete(mesa.id);
    asignacion.set(mejorId, mesa.id);

    // ── Forward checking: verificar que ninguna reserva restante quede sin candidatos ──
    let viable = true;
    for (const id of pendientes) {
      if (countAvailable(candidatosBase, id, mesasLibres) === 0) {
        viable = false;
        break;
      }
    }

    if (viable) {
      if (backtrack(pendientes, candidatosBase, reservasPorId, mesasLibres, asignacion, deadline)) {
        // No hace falta deshacer: encontramos la solución completa.
        // Restauramos pendientes por consistencia (aunque ya no se usa).
        pendientes.add(mejorId);
        return true;
      }
    }

    // ── Deshacer ──
    asignacion.delete(mejorId);
    mesasLibres.add(mesa.id);
  }

  // Agotamos candidatos sin éxito → backtrack
  pendientes.add(mejorId);
  return false;
}

// ---------------------------------------------------------------------------
// Función pública (API sin cambios)
// ---------------------------------------------------------------------------

function asignarMesasBacktracking(mesas, reservas) {
  const t0 = Date.now();

  if (!reservas || reservas.length === 0) {
    console.log(`[ASIGNADOR] reservas=0 mesas=${mesas?.length ?? 0} ms=0 (trivial)`);
    return new Map();
  }

  // Mapa base de candidatos (orden por menor desperdicio, calculado una vez)
  const candidatosBase = new Map();
  for (const r of reservas) {
    candidatosBase.set(r.id, buildCandidates(mesas, r));
  }

  // Lookup rápido de reserva por id
  const reservasPorId = new Map(reservas.map(r => [r.id, r]));

  const pendientes  = new Set(reservas.map(r => r.id));
  const mesasLibres = new Set(mesas.map(m => m.id));
  const asignacion  = new Map();
  const deadline    = Date.now() + TIMEOUT_MS;

  let exito = false;
  let timedOut = false;

  try {
    exito = backtrack(pendientes, candidatosBase, reservasPorId, mesasLibres, asignacion, deadline);
  } catch (e) {
    if (e.message === 'TIMEOUT') {
      timedOut = true;
    } else {
      throw e; // propagar errores inesperados
    }
  }

  const ms = Date.now() - t0;
  console.log(
    `[ASIGNADOR] reservas=${reservas.length} mesas=${mesas.length} ` +
    `exito=${exito} timedOut=${timedOut} ms=${ms}`
  );

  if (timedOut) {
    const err = new Error('El oráculo de disponibilidad superó el tiempo límite');
    err.code = 'ORACLE_TIMEOUT';
    throw err;
  }
  if (!exito)   return null;
  return asignacion;
}

module.exports = { asignarMesasBacktracking };