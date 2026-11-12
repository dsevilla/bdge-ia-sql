/*
 * Catálogo de ejercicios de la actividad.
 *
 * - ITINERARY: ejercicios obligatorios, en orden, con objetivo y pista propios.
 *   Se construyen a partir del banco de BDGE por `id`, así que el enunciado y
 *   la solución de referencia son exactamente los de la práctica de la
 *   asignatura.
 * - EXTRA: el resto del banco, disponible pero opcional.
 */
import { page as banco } from "./banco.js";
import { itinerary } from "./itinerario.js";

const byId = new Map(banco.exercises.map(function (exercise) { return [exercise.id, exercise]; }));

const missing = itinerary
  .map(function (item) { return item.id; })
  .filter(function (id) { return !byId.has(id); });

export const ITINERARY = itinerary.map(function (item) {
  const exercise = byId.get(item.id) || {};
  return Object.assign({}, exercise, {
    objetivo: item.objetivo,
    pista: item.pista
  });
});

export const EXTRA = banco.exercises.filter(function (exercise) {
  return !itinerary.some(function (item) { return item.id === exercise.id; });
});

export const DATA_SOURCE = {
  id: banco.id,
  title: banco.title,
  description: banco.description
};

if (missing.length) {
  console.warn("Ejercicios del itinerario no encontrados en el banco: " + missing.join(", "));
}
