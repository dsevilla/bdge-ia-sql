/*
 * Itinerario de la actividad: selección ordenada de ejercicios del banco de
 * BDGE, con un objetivo de aprendizaje y una pista por ejercicio.
 * Los ejercicios se toman del banco (pages/banco.js) por su `id`, de modo que
 * enunciado y solución de referencia siguen siendo los de la asignatura.
 */
export const itinerary = [
  {
    id: "inventario-tablas",
    objetivo: "Inspeccionar el catálogo antes de escribir consultas: saber qué tablas hay y de qué tipo.",
    pista: "El esquema se llama main. ¿Qué dos columnas de information_schema.tables te dicen el tipo y el nombre? Ordena por las dos."
  },
  {
    id: "preguntas-mas-contestadas",
    objetivo: "Filtrar por tipo de publicación, ordenar de forma estable y limitar el número de filas.",
    pista: "Las preguntas son PostTypeId = 1. Ordena por AnswerCount descendente y añade un segundo criterio de orden para desempatar."
  },
  {
    id: "publicaciones-por-tipo",
    objetivo: "Agrupar con GROUP BY, resumir con funciones de agregación y filtrar grupos con HAVING.",
    pista: "Las tres columnas salen de una sola tabla. La condición sobre el número de filas de cada grupo no va en WHERE: va en HAVING."
  },
  {
    id: "preguntas-y-autores",
    objetivo: "Relacionar dos tablas conservando las filas sin correspondencia (LEFT JOIN) y entender los NULL del resultado.",
    pista: "Necesitas Posts y Users. Si usas JOIN normal pierdes las preguntas cuyo OwnerUserId no existe en Users; para conservarlas, la tabla de la izquierda debe ser Posts."
  },
  {
    id: "preguntas-sin-respuesta",
    objetivo: "Expresar una condición de no existencia con NOT EXISTS en lugar de comparar contra NULL.",
    pista: "Una respuesta es otra fila de Posts con PostTypeId = 2 y ParentId igual al Id de la pregunta. NOT EXISTS se evalúa por fila y evita los problemas de NOT IN con NULL."
  },
  {
    id: "preguntas-de-marzo-2021",
    objetivo: "Filtrar por rango de fechas sin aplicar funciones a la columna, para que el motor pueda usar estadísticas.",
    pista: "Dos comparaciones con TIMESTAMP literal: una con >= el día 1 y otra con < el día 1 del mes siguiente. Nada de month() ni year() dentro del WHERE."
  },
  {
    id: "resumen-mensual",
    objetivo: "Encapsular una agregación en una CTE y volver a ordenar y limitar su resultado.",
    pista: "strftime(CAST(CreationDate AS TIMESTAMP), '%Y-%m') produce la etiqueta del mes; úsala igual en el SELECT y en el GROUP BY. El límite de 24 meses se aplica sobre la CTE, no dentro."
  },
  {
    id: "mejores-por-anio",
    objetivo: "Numerar filas dentro de particiones con funciones de ventana y filtrar el ranking en una consulta externa.",
    pista: "ROW_NUMBER() OVER (PARTITION BY año ORDER BY Score DESC, Id ASC) dentro de una CTE; el filtro Posicion <= 3 va fuera, porque no se puede filtrar sobre el alias de una ventana en el mismo nivel."
  },
  {
    id: "json-documento",
    objetivo: "Construir un documento JSON con json_object y extraer un campo con json_extract.",
    pista: "json_object recibe parejas clave/valor ('id', Id, 'title', Title, …) y json_extract usa la ruta '$.score'. El documento se construye dos veces: una para mostrarlo y otra para extraer la puntuación."
  },
  {
    id: "pregunta-respuesta-y-sus-autores",
    objetivo: "Unir cuatro tablas, usando Posts y Users dos veces con alias distintos, y ordenar por una columna de la tabla unida.",
    pista: "Dos Posts (q y a, unidas por q.AcceptedAnswerId = a.Id) y dos Users (autor de la pregunta y autor de la respuesta). El ORDER BY usa la puntuación de la respuesta."
  }
];
