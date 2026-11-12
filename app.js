import { createDatabase, openCursor, validateStatement, quoteString } from "./engine.js";
import { ITINERARY, EXTRA } from "./pages/index.js";
"use strict";

/*
 * Actividad «consultas SQL con un tutor de IA generativa» (BDGE).
 *
 * Cada ejercicio tiene un cuaderno de intentos. Cada intento es una fila con
 * tres columnas: mi consulta, el prompt que envío a la IA y la respuesta que
 * me devuelve. El comprobador compara el resultado de la consulta del alumno
 * con la solución de referencia del banco de ejercicios. Si acierta, el
 * ejercicio se cierra; si falla, la fila ofrece volver a preguntar a la IA con
 * el diagnóstico del comprobador y se abre una fila nueva para reintentar.
 */

const DATA_TABLES = ["Posts", "Users", "Tags", "Comments", "Votes"];
const DATA_BASE = "https://raw.githubusercontent.com/dsevilla/bd2-data/main/es.stackoverflow/parquet/";
const DATA_FILES = {
  Posts: ["Posts1.parquet", "Posts2.parquet", "Posts3.parquet"],
  Users: ["Users.parquet"],
  Tags: ["Tags.parquet"],
  Comments: ["Comments.parquet"],
  Votes: ["Votes.parquet"]
};
const RESULT_PAGE_SIZE = 100;
const CHECK_ROW_LIMIT = 1000;
const STATE_CHANGE_NOTE = "No se puede comprobar: la consulta cambia el estado de la base.";
const STORE_KEY = "bdge-ia-sql/v1";
const API_KEY_STORE = "bdge-ia-sql/api-key";
const API_SETTINGS_STORE = "bdge-ia-sql/api-settings";
const MAX_PROMPT_FOR_URL = 3800;

const SYSTEM_TUTOR = "Eres un tutor de SQL de la asignatura «Bases de Datos a Gran Escala» del Máster en Big Data "
  + "(Universidad de Murcia). El alumno trabaja con DuckDB sobre una base de datos de Stack Overflow en español. "
  + "Nunca escribas la consulta solución completa ni el ejercicio resuelto: señala el error, el concepto que hay que "
  + "repasar y una pregunta que le haga pensar. Responde en español, en 120 palabras como máximo, sin rodeos.";

const TUTOR_HEADER = "Actúa como tutor de SQL de la asignatura «Bases de Datos a Gran Escala» "
  + "(Máster en Big Data, Universidad de Murcia). Practico con una base de datos de Stack Overflow "
  + "en español en DuckDB.";

// ── Referencias del documento ────────────────────────────────────────────────
const statusEl = document.getElementById("db-status");
const messageEl = document.getElementById("connection-result");
const schemaPreviewEl = document.getElementById("schema-preview");
const exerciseListEl = document.getElementById("exercise-list");
const extraListEl = document.getElementById("exercise-list-extra");
const extraBankEl = document.getElementById("extra-bank");
const sandboxEl = document.getElementById("sandbox");
const loadRealButton = document.getElementById("load-real");
const loadDemoButton = document.getElementById("load-demo");
const localFileInput = document.getElementById("local-file");
const progressBadgeEl = document.getElementById("progress-badge");
const editorModeNoteEl = document.getElementById("editor-mode-note");
const studentInput = document.getElementById("student-name");
const modeSelect = document.getElementById("ai-mode");
const apiSettingsEl = document.getElementById("api-settings");
const endpointInput = document.getElementById("api-endpoint");
const modelInput = document.getElementById("api-model");
const keyInput = document.getElementById("api-key");
const rememberInput = document.getElementById("api-remember");
const modeNoteEl = document.getElementById("ai-mode-note");
const settingsStatusEl = document.getElementById("settings-status");
const testApiButton = document.getElementById("test-api");
const exportJsonButton = document.getElementById("export-json");
const exportMdButton = document.getElementById("export-md");
const resetButton = document.getElementById("reset-all");
const reflectionInputs = [
  document.getElementById("reflection-1"),
  document.getElementById("reflection-2"),
  document.getElementById("reflection-3")
];

// ── Estado del motor ─────────────────────────────────────────────────────────
let engineReady = false;
let queryRunning = false;
let loading = false;
let database = null;
let schemaText = "";
let datasetLabel = "";
const editorInstances = new Map();

// ── Estado persistente del alumno ────────────────────────────────────────────
let store = loadStore();
let saveTimer = null;

function emptyAttempt(sql) {
  return {
    sql: sql || "",
    prompt: "",
    ai: "",
    verdict: null,
    startedAt: null,
    checkedAt: null,
    checks: 0,
    refines: 0
  };
}

function defaultStore() {
  return { v: 1, student: "", mode: "copy", exercises: {}, reflection: { q1: "", q2: "", q3: "" } };
}

function loadStore() {
  const base = defaultStore();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return base;
    return Object.assign(base, parsed, { exercises: parsed.exercises || {} });
  } catch (error) {
    return base;
  }
}

function saveStore() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(function () {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (error) {
      settingsStatusEl.textContent = "No se pudo guardar el trabajo en este navegador: " + error.message;
    }
  }, 350);
}

function exerciseState(exerciseId) {
  if (!store.exercises[exerciseId]) {
    store.exercises[exerciseId] = { done: false, solutionRevealed: false, rows: [emptyAttempt()] };
  }
  const state = store.exercises[exerciseId];
  if (!Array.isArray(state.rows) || !state.rows.length) state.rows = [emptyAttempt()];
  return state;
}

// ── Utilidades de interfaz ───────────────────────────────────────────────────
function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = "status " + kind;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const node = el("button", "button small " + (className || ""), label);
  node.type = "button";
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function hasSqlCodeMirror() {
  return typeof window.CodeMirror === "function"
    && window.CodeMirror.modes
    && typeof window.CodeMirror.modes.sql === "function";
}

function updateProgress() {
  const total = ITINERARY.length;
  const done = ITINERARY.filter(function (exercise) {
    return store.exercises[exercise.id] && store.exercises[exercise.id].done;
  }).length;
  const aiUses = Object.values(store.exercises).reduce(function (sum, state) {
    return sum + (state.rows || []).filter(function (row) { return row.ai; }).length;
  }, 0);
  progressBadgeEl.textContent = done + " de " + total + " ejercicios cerrados · "
    + aiUses + (aiUses === 1 ? " consulta a la IA" : " consultas a la IA");
  progressBadgeEl.className = "status " + (done === total && total ? "ready" : "idle");
}

// ── Base de datos ────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return value.toFixed(value < 10 ? 1 : 0) + " " + units[unit];
}

function displayValue(value) {
  if (value === null) return { text: "NULL", isNull: true };
  if (value instanceof Uint8Array) return { text: "[BLOB, " + formatBytes(value.byteLength) + "]", isNull: false };
  const text = String(value);
  const maxLength = 4000;
  return {
    text: text.length > maxLength ? text.slice(0, maxLength) + "… [texto truncado; " + text.length + " caracteres]" : text,
    isNull: false
  };
}

async function createDemoDatabase() {
  const demo = await createDatabase();
  try {
    await demo.connection.query(`
      CREATE TABLE Posts (Id INTEGER PRIMARY KEY, PostTypeId INTEGER NOT NULL,
        CreationDate TIMESTAMP, Score INTEGER, OwnerUserId INTEGER, Title VARCHAR,
        ParentId INTEGER, AnswerCount INTEGER);
      CREATE TABLE Users (Id INTEGER PRIMARY KEY, DisplayName VARCHAR, Reputation INTEGER,
        CreationDate TIMESTAMP);
      CREATE TABLE Tags (Id INTEGER PRIMARY KEY, TagName VARCHAR, Count INTEGER);
      CREATE TABLE Comments (Id INTEGER PRIMARY KEY, PostId INTEGER, UserId INTEGER, Text VARCHAR);
      CREATE TABLE Votes (Id INTEGER PRIMARY KEY, PostId INTEGER, VoteTypeId INTEGER);
      INSERT INTO Posts VALUES
        (101, 1, '2025-01-04 10:00:00', 18, 1, '¿Cómo funciona un índice B-tree?', NULL, 1),
        (102, 1, '2025-02-12 12:30:00', 32, 2, '¿Cuándo conviene usar una clave compuesta?', NULL, 1),
        (103, 2, '2025-02-13 09:15:00', 12, 3, NULL, 101, 0),
        (104, 1, '2025-03-01 08:00:00', 32, 1, '¿Qué diferencia hay entre JOIN y subconsulta?', NULL, 0),
        (105, 2, '2025-03-02 14:20:00', 4, 2, NULL, 102, 0),
        (106, 1, '2025-03-11 16:45:00', 7, 3, '¿Cómo se interpreta EXPLAIN?', NULL, 0);
      INSERT INTO Users VALUES
        (1, 'Lucía', 1250, '2024-01-01'), (2, 'Mateo', 840, '2024-02-01'), (3, 'Inés', 420, '2024-03-01');
      INSERT INTO Tags VALUES (1, 'sql', 4), (2, 'mysql', 2), (3, 'duckdb', 1);
      INSERT INTO Comments VALUES (1, 101, 1, 'Gracias'), (2, 102, NULL, 'Interesante'), (3, 104, 99, 'Resuelto');
      INSERT INTO Votes VALUES (1, 101, 2), (2, 102, 2), (3, 104, 3);
    `);
    return demo;
  } catch (error) {
    await demo.close();
    throw error;
  }
}

async function createParquetDatabase(groups) {
  const next = await createDatabase();
  try {
    for (let tableIndex = 0; tableIndex < groups.length; tableIndex += 1) {
      const [table, files] = groups[tableIndex];
      const paths = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const path = typeof file === "string" ? file : table + "-" + index + ".parquet";
        if (typeof file !== "string") await next.registerParquet(path, file);
        paths.push(quoteString(path));
      }
      setStatus("Descargando y materializando " + table + " (" + (tableIndex + 1) + "/" + groups.length + ")", "loading");
      messageEl.textContent = "DuckDB está creando la tabla local " + table
        + " a partir de " + paths.length + " fichero(s) Parquet.";
      await next.connection.query("CREATE TABLE \"" + table
        + "\" AS SELECT * FROM read_parquet([" + paths.join(", ") + "])");
    }
    return next;
  } catch (error) {
    await next.close();
    throw error;
  }
}

async function refreshSchema(db) {
  const target = db || database;
  if (!target) return;
  try {
    const reader = await target.connection.query(
      "SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols "
      + "FROM information_schema.columns WHERE table_schema = 'main' "
      + "GROUP BY table_name ORDER BY table_name"
    );
    // La base puede haberse sustituido mientras se consultaba el catálogo: en
    // ese caso el resultado que llega es de la base anterior y se descarta.
    if (target !== database) return;
    const lines = [];
    for (const row of reader.toArray()) {
      lines.push(row.table_name + "(" + row.cols + ")");
    }
    schemaText = lines.join("\n");
    schemaPreviewEl.textContent = schemaText || "Sin tablas visibles.";
  } catch (error) {
    if (target !== database) return;
    schemaText = "";
    schemaPreviewEl.textContent = "No se pudo leer el esquema: " + error.message;
  }
}

async function replaceDatabase(nextDatabase, label) {
  const previous = database;
  database = nextDatabase;
  if (previous) await previous.close();
  setStatus(label, "ready");
  datasetLabel = label;
  messageEl.textContent = "";
  // Al cambiar de base se borran los resultados en pantalla, pero el veredicto
  // de cada intento se conserva porque es parte del registro del alumno.
  refreshResultBoxes();
  await refreshSchema(nextDatabase);
  updateControls();
}

function refreshResultBoxes() {
  worksheets.forEach(function (worksheetRef) {
    const state = exerciseState(worksheetRef.exercise.id);
    const rows = worksheetRef.rowsEl.querySelectorAll(".ws-row");
    rows.forEach(function (rowEl, rowIndex) {
      const box = rowEl.querySelector(".result");
      if (!box) return;
      const attempt = state.rows[rowIndex];
      box.replaceChildren();
      if (attempt && attempt.verdict && attempt.verdict.message) {
        box.append(el("p", "result-check " + attempt.verdict.kind, attempt.verdict.message));
      } else {
        box.append(el("p", "empty", "Ejecuta la consulta para ver el resultado."));
      }
    });
  });
  const sandboxResult = document.getElementById("result-sandbox");
  if (sandboxResult) {
    sandboxResult.replaceChildren(el("p", "empty", "Ejecuta la consulta para ver el resultado."));
  }
}

async function loadDataset(label, build) {
  if (loading || queryRunning || !engineReady) return;
  loading = true;
  updateControls();
  setStatus(label, "loading");
  messageEl.textContent = "";
  let candidate = null;
  try {
    candidate = await build();
    await replaceDatabase(candidate, "DuckDB · " + label);
    candidate = null;
  } catch (error) {
    if (candidate) await candidate.close();
    setStatus("No se pudo cargar · base anterior conservada", "error");
    messageEl.textContent = error.message;
  } finally {
    loading = false;
    updateControls();
  }
}

async function loadRemoteDatabase() {
  await loadDataset("Parquet completos · dsevilla/bd2-data", function () {
    const groups = DATA_TABLES.map(function (table) {
      return [table, DATA_FILES[table].map(function (file) { return DATA_BASE + encodeURIComponent(file); })];
    });
    return createParquetDatabase(groups);
  });
  if (database && statusEl.textContent.includes("Parquet completos")) {
    messageEl.textContent = "Tablas Posts, Users, Tags, Comments y Votes materializadas en DuckDB. "
      + "Las consultas de esta sesión ya no vuelven a leer los Parquet remotos.";
  }
}

async function loadLocalFiles(files) {
  if (!files.length) return;
  try {
    await loadDataset("Parquet locales", function () {
      const groups = new Map();
      for (const file of files) {
        const match = /^(Posts|Users|Tags|Comments|Votes)(?:-\d+)?\.parquet$/i.exec(file.name);
        if (!match) throw new Error("Selecciona los Parquet de la release 26-27: Posts, Users, Tags, Comments y Votes.");
        const table = DATA_TABLES.find(function (name) { return name.toLowerCase() === match[1].toLowerCase(); });
        if (!groups.has(table)) groups.set(table, []);
        groups.get(table).push(file);
      }
      for (const table of DATA_TABLES) {
        if (!groups.has(table)) throw new Error("Falta " + table + ".parquet. Selecciona juntos los cinco Parquet.");
      }
      return createParquetDatabase(Array.from(groups.entries()));
    });
  } finally {
    localFileInput.value = "";
  }
}

function updateControls() {
  const busy = loading || queryRunning || !engineReady;
  loadRealButton.disabled = busy;
  loadDemoButton.disabled = busy;
  localFileInput.disabled = busy;
  document.querySelectorAll(".run-query, .check-query").forEach(function (node) {
    node.disabled = busy || node.dataset.locked === "true";
  });
}

// ── Ejecución y comprobación ────────────────────────────────────────────────
function firstStatementKeyword(sql) {
  const trimmed = String(sql).replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");
  const match = /^[A-Za-z]+/.exec(trimmed);
  return match ? match[0].toUpperCase() : "";
}

function isReadOnlyStatement(sql) {
  const keyword = firstStatementKeyword(sql);
  return keyword === "SELECT" || keyword === "WITH" || keyword === "EXPLAIN" || keyword === "VALUES";
}

function canCheckExercise(exercise) {
  return Boolean(exercise && exercise.solution)
    && exercise.check !== false
    && isReadOnlyStatement(exercise.solution);
}

function buildResultTable(columns, rows) {
  const wrap = el("div", "table-wrap");
  const table = el("table");
  const head = el("thead");
  const headerRow = el("tr");
  columns.forEach(function (column) {
    const th = el("th", null, column);
    th.scope = "col";
    headerRow.append(th);
  });
  head.append(headerRow);
  table.append(head);
  const body = el("tbody");
  rows.forEach(function (row) {
    const tr = el("tr");
    row.forEach(function (value) {
      const td = el("td");
      const display = displayValue(value);
      td.textContent = display.text;
      if (display.isNull) td.className = "null";
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  return wrap;
}

// Sólo se conservan 1.001 filas; se cierra el flujo antes de ejecutar la referencia.
async function readLimitedRows(sqlText) {
  const cursor = await openCursor(database, sqlText);
  try {
    const rows = [];
    while (rows.length <= CHECK_ROW_LIMIT) {
      const row = await cursor.next();
      if (row === null) break;
      rows.push(row);
    }
    const truncated = rows.length > CHECK_ROW_LIMIT;
    if (truncated) rows.pop();
    return { columns: cursor.columns, rows: rows, truncated: truncated };
  } finally {
    await cursor.close();
  }
}

// El tipo forma parte del valor: el número 1 y la cadena "1" no son la misma
// respuesta aunque se impriman igual.
function canonicalCell(value) {
  if (value === null) return "NULL";
  if (typeof value === "bigint") return "number:" + String(value);
  if (value instanceof Uint8Array) return "blob:" + Array.from(value).join(",");
  return typeof value + ":" + String(value);
}

function canonicalRow(row) {
  return row.map(canonicalCell).join("\u001f");
}

function compareResults(mine, theirs) {
  const limitNote = mine.truncated || theirs.truncated
    ? " Se han comparado las primeras " + CHECK_ROW_LIMIT.toLocaleString("es-ES") + " filas."
    : "";
  if (mine.columns.length !== theirs.columns.length) {
    return {
      kind: "bad",
      message: "No coincide: tu consulta devuelve " + mine.columns.length
        + " columnas y la solución " + theirs.columns.length
        + ". Los nombres de las columnas no importan; el número sí."
    };
  }
  if (mine.rows.length !== theirs.rows.length) {
    return {
      kind: "bad",
      message: "No coincide: tu consulta devuelve " + mine.rows.length.toLocaleString("es-ES")
        + " filas y la solución " + theirs.rows.length.toLocaleString("es-ES") + "." + limitNote
    };
  }
  const yours = mine.rows.map(canonicalRow);
  const reference = theirs.rows.map(canonicalRow);
  const firstDifference = yours.findIndex(function (row, index) { return row !== reference[index]; });
  if (firstDifference === -1) {
    return { kind: "ok", message: "Coincide con la solución de referencia." + limitNote };
  }
  const sortedYours = yours.slice().sort();
  const sortedReference = reference.slice().sort();
  const sameRows = sortedYours.every(function (row, index) { return row === sortedReference[index]; });
  if (sameRows) {
    return {
      kind: "warn",
      message: "Mismas filas, distinto orden. Si el enunciado pide un orden concreto, añade el ORDER BY que falta."
        + limitNote
    };
  }
  return {
    kind: "bad",
    message: "No coincide a partir de la fila " + (firstDifference + 1).toLocaleString("es-ES")
      + ". Compara tu resultado con el de la solución." + limitNote
  };
}

function renderCheckResult(container, mine, verdict) {
  container.replaceChildren();
  const check = el("p", "result-check " + verdict.kind, verdict.message);
  container.append(check);
  const shown = mine.rows.slice(0, RESULT_PAGE_SIZE);
  const summary = el("p", "result-summary", mine.rows.length
    ? "Tu resultado: " + (mine.rows.length > shown.length
        ? "primeras " + shown.length + " filas de " + mine.rows.length.toLocaleString("es-ES")
          + (mine.truncated ? " leídas" : "")
        : mine.rows.length.toLocaleString("es-ES") + " filas") + "."
    : "Tu consulta devuelve 0 filas.");
  container.append(summary);
  if (shown.length) container.append(buildResultTable(mine.columns, shown));
}

function showQueryError(container, error) {
  container.replaceChildren(el("p", "result-summary error", "Error SQL: " + error.message));
}

// ── Cuaderno de intentos ────────────────────────────────────────────────────
const worksheets = new Map();

function renderExercise(exercise, index, container, options) {
  const state = exerciseState(exercise.id);
  const section = el("section", "exercise" + (options && options.compact ? " compact" : ""));
  section.dataset.exercise = exercise.id;
  section.setAttribute("aria-labelledby", "ex-" + exercise.id + "-title");

  const heading = el("div", "exercise-heading");
  const number = el("span", "number", String(index + 1));
  number.setAttribute("aria-hidden", "true");
  const headingText = el("div");
  const title = el("h2", null, exercise.title);
  title.id = "ex-" + exercise.id + "-title";
  headingText.append(title);
  headingText.append(el("p", "exercise-prompt", exercise.prompt || ""));
  if (exercise.objetivo) headingText.append(el("p", "exercise-meta", "Objetivo: " + exercise.objetivo));
  const chips = el("p", "exercise-chips");
  (exercise.temas || []).forEach(function (tema) { chips.append(el("span", "chip", tema)); });
  if (exercise.dificultad) chips.append(el("span", "chip chip-level", exercise.dificultad));
  headingText.append(chips);
  if (exercise.pista) {
    const hint = el("details", "hint");
    hint.append(el("summary", null, "Pista (úsala solo si te atascas)"));
    hint.append(el("p", null, exercise.pista));
    headingText.append(hint);
  }
  const badge = el("span", "status " + (state.done ? "ready" : "idle"), state.done ? "Resuelto" : "Pendiente");
  heading.append(number, headingText, badge);

  const worksheet = el("div", "worksheet");
  const head = el("div", "ws-head");
  const columns = [
    ["1 · Mi respuesta", "sin IA", "col-sql"],
    ["2 · Lo que le pregunto a la IA", "con mi consulta y el diagnóstico", "col-prompt"],
    ["3 · Lo que me sugiere la IA", "su respuesta, tal cual", "col-ai"]
  ];
  columns.forEach(function (column) {
    const cell = el("div", "ws-head-cell " + column[2]);
    cell.append(el("strong", null, column[0]));
    cell.append(el("span", null, column[1]));
    head.append(cell);
  });
  const rowsEl = el("div", "ws-rows");
  worksheet.append(head, rowsEl);

  const footer = el("div", "ws-footer");
  const addButton = button("+ Añadir otra respuesta", "add-attempt", function () {
    addAttempt(exercise, worksheetRef);
  });
  const solutionButton = button("Ver la solución de referencia", "show-solution", function () {
    revealSolution(exercise, worksheetRef);
  });
  solutionButton.hidden = true;
  footer.append(addButton, solutionButton);

  section.append(heading, worksheet, footer);
  container.append(section);

  const worksheetRef = {
    exercise: exercise,
    section: section,
    rowsEl: rowsEl,
    addButton: addButton,
    solutionButton: solutionButton,
    badge: badge,
    solutionBox: null
  };
  worksheets.set(exercise.id, worksheetRef);

  state.rows.forEach(function (attempt, rowIndex) {
    rowsEl.append(buildAttemptRow(exercise, worksheetRef, attempt, rowIndex));
  });
  syncWorksheet(worksheetRef);
  return worksheetRef;
}

function buildAttemptRow(exercise, worksheetRef, attempt, rowIndex) {
  const state = exerciseState(exercise.id);
  const row = el("div", "ws-row");
  row.dataset.row = String(rowIndex);
  if (attempt.verdict && attempt.verdict.kind === "ok") row.classList.add("solved");

  // Columna 1: mi consulta
  const sqlCell = el("div", "ws-cell col-sql");
  const sqlLabel = el("label", "editor-label");
  sqlLabel.htmlFor = "sql-" + exercise.id + "-" + rowIndex;
  sqlLabel.append(el("span", null, "Consulta SQL del intento " + (rowIndex + 1)));
  sqlLabel.append(el("span", null, "Ctrl/Cmd + Intro ejecuta"));
  const sqlArea = el("textarea");
  sqlArea.id = "sql-" + exercise.id + "-" + rowIndex;
  sqlArea.spellcheck = false;
  sqlArea.value = attempt.sql || "";
  sqlArea.setAttribute("aria-label", "Consulta SQL del intento " + (rowIndex + 1) + " · " + exercise.title);
  const sqlActions = el("div", "editor-actions");
  const runButton = button("Ejecutar", "run-query", function () { runAttempt(exercise, worksheetRef, rowIndex, false); });
  runButton.dataset.locked = canCheckExercise(exercise) ? "false" : "true";
  const checkButton = button("Comprobar", "check-query primary", function () { runAttempt(exercise, worksheetRef, rowIndex, true); });
  checkButton.dataset.locked = canCheckExercise(exercise) ? "false" : "true";
  if (!canCheckExercise(exercise)) {
    checkButton.disabled = true;
    checkButton.title = STATE_CHANGE_NOTE;
    sqlActions.append(el("span", "check-note", STATE_CHANGE_NOTE));
  }
  sqlActions.append(runButton, checkButton);
  const resultBox = el("div", "result");
  resultBox.id = "result-" + exercise.id + "-" + rowIndex;
  resultBox.setAttribute("aria-live", "polite");
  if (attempt.verdict && attempt.verdict.message) {
    resultBox.append(el("p", "result-check " + attempt.verdict.kind, attempt.verdict.message));
  } else {
    resultBox.append(el("p", "empty", "Ejecuta la consulta para ver el resultado."));
  }
  sqlCell.append(sqlLabel, sqlArea, sqlActions, resultBox);

  // Columna 2: lo que le pregunto a la IA
  const promptCell = el("div", "ws-cell col-prompt");
  const promptLabel = el("label", "editor-label");
  promptLabel.htmlFor = "prompt-" + exercise.id + "-" + rowIndex;
  promptLabel.append(el("span", null, "Prompt para la IA"));
  const promptArea = el("textarea");
  promptArea.id = "prompt-" + exercise.id + "-" + rowIndex;
  promptArea.className = "prompt-area";
  promptArea.spellcheck = false;
  promptArea.value = attempt.prompt || "";
  promptArea.placeholder = "Pulsa «Preparar pregunta» para que la página redacte el prompt con el enunciado, "
    + "el esquema, tu consulta y el diagnóstico del comprobador. Puedes editarlo antes de enviarlo.";
  promptArea.addEventListener("input", function () {
    attempt.prompt = promptArea.value;
    if (!attempt.startedAt && promptArea.value.trim()) attempt.startedAt = new Date().toISOString();
    saveStore();
  });
  const promptActions = el("div", "editor-actions");
  promptActions.append(
    button("Preparar pregunta", "prepare", function () { preparePrompt(exercise, worksheetRef, rowIndex, false); }),
    button("Copiar prompt", "copy-prompt", function () { copyPrompt(exercise, worksheetRef, rowIndex); }),
    button("Abrir en ChatGPT", "open-chat", function () { openInChatGPT(exercise, worksheetRef, rowIndex); })
  );
  const apiButton = button("Preguntar aquí", "ask-api", function () { askModel(exercise, worksheetRef, rowIndex, false); });
  promptActions.append(apiButton);
  apiButton.hidden = store.mode !== "api";
  promptCell.append(promptLabel, promptArea, promptActions);

  // Columna 3: la respuesta de la IA
  const aiCell = el("div", "ws-cell col-ai");
  const aiLabel = el("label", "editor-label");
  aiLabel.htmlFor = "ai-" + exercise.id + "-" + rowIndex;
  aiLabel.append(el("span", null, "Respuesta de la IA"));
  const aiArea = el("textarea");
  aiArea.id = "ai-" + exercise.id + "-" + rowIndex;
  aiArea.className = "ai-area";
  aiArea.value = attempt.ai || "";
  aiArea.placeholder = "Pega aquí la respuesta que te dé la IA (o llega sola si conectas un modelo).";
  aiArea.addEventListener("input", function () {
    attempt.ai = aiArea.value;
    saveStore();
    syncWorksheet(worksheetRef);
  });
  const aiActions = el("div", "editor-actions");
  const refineButton = button("Volver a preguntar con el diagnóstico", "refine", function () {
    askModel(exercise, worksheetRef, rowIndex, true);
  });
  refineButton.hidden = true;
  aiActions.append(refineButton);
  aiCell.append(aiLabel, aiArea, aiActions);

  row.append(sqlCell, promptCell, aiCell);

  // Editor SQL con resaltado, si CodeMirror está disponible.
  if (hasSqlCodeMirror()) {
    const instance = window.CodeMirror.fromTextArea(sqlArea, {
      mode: "text/x-sql",
      theme: "material-darker",
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      extraKeys: {
        "Ctrl-Enter": function () { runAttempt(exercise, worksheetRef, rowIndex, false); },
        "Cmd-Enter": function () { runAttempt(exercise, worksheetRef, rowIndex, false); }
      }
    });
    instance.setSize(null, 150);
    instance.getInputField().setAttribute("aria-label", sqlArea.getAttribute("aria-label"));
    instance.on("change", function (editor) {
      attempt.sql = editor.getValue();
      saveStore();
    });
    editorInstances.set(sqlArea.id, instance);
    sqlLabel.addEventListener("click", function (event) {
      event.preventDefault();
      instance.focus();
    });
  } else {
    sqlArea.addEventListener("input", function () {
      attempt.sql = sqlArea.value;
      saveStore();
    });
    sqlArea.rows = 7;
  }

  row._refs = { aiArea: aiArea, aiActions: aiActions, refineButton: refineButton, resultBox: resultBox, apiButton: apiButton };
  return row;
}

function readSql(exercise, rowIndex) {
  const id = "sql-" + exercise.id + "-" + rowIndex;
  const instance = editorInstances.get(id);
  if (instance) return instance.getValue();
  const area = document.getElementById(id);
  return area ? area.value : "";
}

function setSql(exercise, rowIndex, text) {
  const id = "sql-" + exercise.id + "-" + rowIndex;
  const instance = editorInstances.get(id);
  if (instance) instance.setValue(text);
  const area = document.getElementById(id);
  if (area) area.value = text;
}

// Estado visual: qué botones se ven en función de si hay veredicto y de si el
// ejercicio está cerrado.
function syncWorksheet(worksheetRef) {
  const exercise = worksheetRef.exercise;
  const state = exerciseState(exercise.id);
  const rows = Array.from(worksheetRef.rowsEl.querySelectorAll(".ws-row"));
  worksheetRef.badge.textContent = state.done ? "Resuelto" : "Pendiente";
  worksheetRef.badge.className = "status " + (state.done ? "ready" : "idle");
  worksheetRef.addButton.hidden = state.done;
  worksheetRef.solutionButton.hidden = !state.done;
  if (state.done && worksheetRef.solutionBox) {
    worksheetRef.solutionBox.hidden = !state.solutionRevealed;
  }

  rows.forEach(function (rowEl, rowIndex) {
    const attempt = state.rows[rowIndex];
    if (!attempt) return;
    const refs = rowEl._refs;
    if (!refs) return;
    const failedCheck = attempt.verdict && attempt.verdict.kind !== "ok";
    // Tras un fallo, la columna 3 ofrece volver a preguntar con el diagnóstico.
    refs.refineButton.hidden = !failedCheck || state.done;
    refs.apiButton.hidden = store.mode !== "api";
    rowEl.classList.toggle("solved", Boolean(attempt.verdict && attempt.verdict.kind === "ok"));
    rowEl.classList.toggle("failed", Boolean(failedCheck));
    rowEl.querySelectorAll(".check-query").forEach(function (node) {
      node.dataset.locked = state.done ? "true" : (canCheckExercise(exercise) ? "false" : "true");
    });
    rowEl.querySelectorAll("textarea, .CodeMirror").forEach(function (node) {
      node.classList.toggle("locked", state.done);
    });
  });
  updateControls();
  updateProgress();
}

function addAttempt(exercise, worksheetRef) {
  const state = exerciseState(exercise.id);
  if (state.done) return;
  const previous = state.rows[state.rows.length - 1];
  const next = emptyAttempt(previous ? previous.sql : "");
  state.rows.push(next);
  saveStore();
  const rowIndex = state.rows.length - 1;
  const rowEl = buildAttemptRow(exercise, worksheetRef, next, rowIndex);
  worksheetRef.rowsEl.append(rowEl);
  syncWorksheet(worksheetRef);
  rowEl.scrollIntoView({ block: "center", behavior: "smooth" });
  const area = document.getElementById("prompt-" + exercise.id + "-" + rowIndex);
  if (area) area.focus({ preventScroll: true });
}

function revealSolution(exercise, worksheetRef) {
  const state = exerciseState(exercise.id);
  if (!state.done) return;
  state.solutionRevealed = !state.solutionRevealed;
  saveStore();
  if (!worksheetRef.solutionBox) {
    const box = el("details", "solution-box");
    box.append(el("summary", null, "Solución de referencia del banco de ejercicios"));
    const pre = el("pre", "materialization-code");
    pre.append(el("code", null, exercise.solution || ""));
    box.append(pre);
    box.append(el("p", "settings-note", "Compárala con la tuya: ¿qué hace igual y qué hace distinto? "
      + "Anótalo si tu solución es más legible o más eficiente."));
    worksheetRef.section.append(box);
    worksheetRef.solutionBox = box;
  }
  worksheetRef.solutionBox.open = state.solutionRevealed;
  worksheetRef.solutionButton.textContent = state.solutionRevealed
    ? "Ocultar la solución de referencia"
    : "Ver la solución de referencia";
}

// ── Prompts ─────────────────────────────────────────────────────────────────
function verdictForPrompt(attempt) {
  if (!attempt.verdict) return "Todavía no he comprobado esta consulta (o el comprobador aún no ha dado veredicto).";
  if (attempt.verdict.kind === "ok") return "El comprobador la ha dado por buena.";
  return attempt.verdict.message;
}

function buildPrompt(exercise, attempt, options) {
  const parts = [];
  parts.push(TUTOR_HEADER);
  parts.push("");
  parts.push("## Enunciado del ejercicio");
  parts.push(exercise.prompt || exercise.title);
  parts.push("");
  parts.push("## Esquema disponible (DuckDB)");
  parts.push(schemaText || "Posts, Users, Tags, Comments y Votes (tablas de Stack Overflow en español).");
  parts.push("");
  parts.push("## Mi consulta");
  parts.push("```sql");
  parts.push((attempt.sql || "").trim() || "(todavía no he escrito ninguna consulta)");
  parts.push("```");
  parts.push("");
  parts.push("## Qué dice el comprobador de la actividad");
  parts.push(verdictForPrompt(attempt));
  if (options && options.followUp && attempt.ai) {
    parts.push("");
    parts.push("## Lo que me dijiste antes");
    parts.push(attempt.ai.trim());
  }
  parts.push("");
  parts.push("## Lo que necesito");
  if (options && options.followUp) {
    parts.push("Sigo sin acertar. Dime qué parte de tu sugerencia estoy aplicando mal y dame una sola pista más concreta.");
  } else {
    parts.push("Dime en qué me he equivocado, qué concepto de SQL debo repasar y una pregunta que me ayude a corregirlo.");
  }
  parts.push("No me des la consulta completa ni la solución: quiero llegar yo. Máximo 120 palabras.");
  return parts.join("\n");
}

function currentAttempt(exercise, rowIndex) {
  const state = exerciseState(exercise.id);
  return state.rows[rowIndex];
}

function preparePrompt(exercise, worksheetRef, rowIndex, followUp) {
  const attempt = currentAttempt(exercise, rowIndex);
  attempt.sql = readSql(exercise, rowIndex);
  attempt.prompt = buildPrompt(exercise, attempt, { followUp: followUp });
  if (!attempt.startedAt) attempt.startedAt = new Date().toISOString();
  const area = document.getElementById("prompt-" + exercise.id + "-" + rowIndex);
  if (area) {
    area.value = attempt.prompt;
    area.classList.add("flash");
    window.setTimeout(function () { area.classList.remove("flash"); }, 900);
    area.focus();
  }
  saveStore();
  return attempt.prompt;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const helper = el("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (ignored) { ok = false; }
    helper.remove();
    return ok;
  }
}

async function copyPrompt(exercise, worksheetRef, rowIndex) {
  const attempt = currentAttempt(exercise, rowIndex);
  const text = attempt.prompt || preparePrompt(exercise, worksheetRef, rowIndex, false);
  const ok = await copyText(text);
  settingsStatusEl.textContent = ok
    ? "Prompt copiado. Pégalo en tu IA favorita y trae la respuesta a la columna 3."
    : "No se pudo copiar; selecciona el texto del cuadro del prompt y cópialo a mano.";
}

async function openInChatGPT(exercise, worksheetRef, rowIndex) {
  const attempt = currentAttempt(exercise, rowIndex);
  const text = attempt.prompt || preparePrompt(exercise, worksheetRef, rowIndex, false);
  const ok = await copyText(text);
  const url = text.length <= MAX_PROMPT_FOR_URL
    ? "https://chatgpt.com/?q=" + encodeURIComponent(text)
    : "https://chatgpt.com/";
  window.open(url, "_blank", "noopener");
  settingsStatusEl.textContent = text.length <= MAX_PROMPT_FOR_URL
    ? "Prompt enviado a ChatGPT en otra pestaña. Cuando te conteste, pega su respuesta en la columna 3."
    : "El prompt es largo para la URL: se ha copiado al portapapeles, pégalo en ChatGPT."
      + (ok ? "" : " (No se pudo copiar automáticamente.)");
}

// ── Conexión con el modelo ──────────────────────────────────────────────────
function apiSettings() {
  return {
    endpoint: (endpointInput.value || "").trim().replace(/\/+$/, ""),
    model: (modelInput.value || "").trim(),
    key: (keyInput.value || "").trim()
  };
}

function persistApiSettings() {
  try {
    window.sessionStorage.setItem(API_SETTINGS_STORE, JSON.stringify({
      endpoint: endpointInput.value, model: modelInput.value
    }));
    if (rememberInput.checked) {
      window.localStorage.setItem(API_SETTINGS_STORE, JSON.stringify({
        endpoint: endpointInput.value, model: modelInput.value
      }));
      window.localStorage.setItem(API_KEY_STORE, keyInput.value);
    } else {
      window.localStorage.removeItem(API_KEY_STORE);
      window.sessionStorage.setItem(API_KEY_STORE, keyInput.value);
    }
  } catch (error) {
    /* almacenamiento no disponible: la clave vive solo en memoria */
  }
}

function restoreApiSettings() {
  try {
    const rawSettings = window.localStorage.getItem(API_SETTINGS_STORE)
      || window.sessionStorage.getItem(API_SETTINGS_STORE);
    if (rawSettings) {
      const settings = JSON.parse(rawSettings);
      endpointInput.value = settings.endpoint || "";
      modelInput.value = settings.model || "";
    }
    const storedKey = window.localStorage.getItem(API_KEY_STORE);
    if (storedKey) {
      keyInput.value = storedKey;
      rememberInput.checked = true;
    } else {
      const sessionKey = window.sessionStorage.getItem(API_KEY_STORE);
      if (sessionKey) keyInput.value = sessionKey;
    }
  } catch (error) {
    /* sin configuración previa */
  }
}

async function callModel(prompt, onStatus) {
  const settings = apiSettings();
  if (!settings.endpoint || !settings.model || !settings.key) {
    throw new Error("Falta el endpoint, el modelo o la clave en «Alumno y conexión con la IA».");
  }
  if (onStatus) onStatus("Consultando al modelo…");
  const controller = new AbortController();
  const timer = window.setTimeout(function () { controller.abort(); }, 90000);
  try {
    const response = await fetch(settings.endpoint + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + settings.key
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_TUTOR },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error("HTTP " + response.status + " · " + detail.slice(0, 300));
    }
    const data = await response.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      && data.choices[0].message.content;
    if (!text) throw new Error("La respuesta no trae contenido: " + JSON.stringify(data).slice(0, 200));
    return String(text).trim();
  } finally {
    window.clearTimeout(timer);
  }
}

async function askModel(exercise, worksheetRef, rowIndex, followUp) {
  const attempt = currentAttempt(exercise, rowIndex);
  const prompt = followUp
    ? attempt.prompt + "\n\n" + buildPrompt(exercise, attempt, { followUp: true }).split("## Lo que necesito")[1]
    : (attempt.prompt && !followUp ? attempt.prompt : buildPrompt(exercise, attempt, { followUp: false }));
  if (followUp) {
    // El seguimiento conserva la conversación: se añade al final del prompt.
    const promptArea = document.getElementById("prompt-" + exercise.id + "-" + rowIndex);
    if (promptArea) promptArea.value = prompt;
    attempt.prompt = prompt;
    attempt.refines = (attempt.refines || 0) + 1;
    saveStore();
  }
  if (store.mode !== "api") {
    const ok = await copyText(prompt);
    window.open("https://chatgpt.com/?q=" + encodeURIComponent(prompt.slice(0, MAX_PROMPT_FOR_URL)), "_blank", "noopener");
    settingsStatusEl.textContent = ok
      ? "Pregunta copiada y abierta en ChatGPT. Pega su respuesta en la columna 3."
      : "No se pudo copiar el prompt automáticamente; cópialo del cuadro de la columna 2.";
    return;
  }
  const aiArea = document.getElementById("ai-" + exercise.id + "-" + rowIndex);
  if (aiArea) aiArea.readOnly = true;
  try {
    const answer = await callModel(prompt, function (message) {
      if (aiArea) aiArea.value = "… " + message;
    });
    if (aiArea) {
      aiArea.value = followUp && attempt.ai ? attempt.ai + "\n\n— Segunda consulta —\n\n" + answer : answer;
      aiArea.dispatchEvent(new Event("input"));
    }
    attempt.ai = aiArea ? aiArea.value : answer;
    saveStore();
    updateProgress();
  } catch (error) {
    if (aiArea) aiArea.value = attempt.ai || "";
    settingsStatusEl.textContent = "No se pudo consultar el modelo: " + error.message;
  } finally {
    if (aiArea) aiArea.readOnly = false;
  }
}

async function testApiConnection() {
  settingsStatusEl.textContent = "Probando la conexión…";
  try {
    const answer = await callModel("Responde solo con la palabra: ok");
    settingsStatusEl.textContent = "Conexión correcta. El modelo responde: " + answer.slice(0, 120);
  } catch (error) {
    settingsStatusEl.textContent = "Fallo de conexión: " + error.message;
  }
}

// ── Ejecutar / comprobar un intento ────────────────────────────────────────
async function runAttempt(exercise, worksheetRef, rowIndex, check) {
  if (queryRunning || loading) return;
  const attempt = currentAttempt(exercise, rowIndex);
  const resultBox = document.getElementById("result-" + exercise.id + "-" + rowIndex);
  if (!resultBox) return;
  if (!database) {
    showQueryError(resultBox, new Error("DuckDB aún no está listo."));
    return;
  }
  queryRunning = true;
  updateControls();
  resultBox.replaceChildren(el("p", "result-summary", check ? "Comprobando…" : "Ejecutando…"));
  try {
    const sqlText = readSql(exercise, rowIndex).trim();
    attempt.sql = sqlText;
    if (!sqlText) throw new Error("Escribe una consulta antes de ejecutarla.");
    await validateStatement(database, sqlText, check);
    if (check) {
      if (!canCheckExercise(exercise)) throw new Error(STATE_CHANGE_NOTE);
      if (!isReadOnlyStatement(sqlText)) throw new Error("Solo se comprueban consultas de lectura.");
      const mine = await readLimitedRows(sqlText);
      const theirs = await readLimitedRows(exercise.solution);
      const verdict = compareResults(mine, theirs);
      attempt.verdict = verdict;
      attempt.checks = (attempt.checks || 0) + 1;
      attempt.checkedAt = new Date().toISOString();
      renderCheckResult(resultBox, mine, verdict);
      if (verdict.kind === "ok") {
        exerciseState(exercise.id).done = true;
        resultBox.append(el("p", "closed-note", "Ejercicio cerrado. Si quieres, compara tu consulta con la solución de referencia."));
      } else {
        resultBox.append(el("p", "closed-note", "Todavía no es correcta. Ve a la columna 3 y vuelve a preguntar a la IA con el diagnóstico, "
          + "o abre una fila nueva con «Añadir otra respuesta»."));
      }
      saveStore();
      syncWorksheet(worksheetRef);
    } else {
      const cursor = await openCursor(database, sqlText);
      try {
        const rows = [];
        while (rows.length < RESULT_PAGE_SIZE) {
          const row = await cursor.next();
          if (row === null) break;
          rows.push(row);
        }
        resultBox.replaceChildren();
        resultBox.append(el("p", "result-summary", rows.length
          ? "Primeras " + rows.length + " filas del resultado."
          : "Consulta ejecutada. 0 filas."));
        if (rows.length) resultBox.append(buildResultTable(cursor.columns, rows));
      } finally {
        await cursor.close();
      }
      if (!attempt.startedAt) attempt.startedAt = new Date().toISOString();
      saveStore();
    }
  } catch (error) {
    showQueryError(resultBox, error);
    if (check) {
      attempt.verdict = { kind: "bad", message: "Error SQL: " + error.message };
      attempt.checks = (attempt.checks || 0) + 1;
      saveStore();
      syncWorksheet(worksheetRef);
    }
  } finally {
    queryRunning = false;
    updateControls();
  }
}

// ── Exportaciones ──────────────────────────────────────────────────────────
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

function slugDate() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}

function exportJson() {
  const payload = {
    actividad: "BDGE · consultas SQL con un tutor de IA generativa",
    curso: "2026-27",
    exportado: new Date().toISOString(),
    alumno: store.student || studentInput.value || "",
    base: datasetLabel || statusEl.textContent,
    cierre: {
      errorDetectadoConIA: store.reflection.q1,
      respuestaDescartada: store.reflection.q2,
      queHariaDistinto: store.reflection.q3
    },
    resumen: ITINERARY.map(function (exercise) {
      const state = store.exercises[exercise.id];
      return {
        id: exercise.id,
        titulo: exercise.title,
        resuelto: Boolean(state && state.done),
        intentos: state ? state.rows.length : 0,
        comprobaciones: state ? state.rows.reduce(function (sum, row) { return sum + (row.checks || 0); }, 0) : 0,
        consultasIA: state ? state.rows.filter(function (row) { return row.ai; }).length : 0
      };
    }),
    ejercicios: ITINERARY.map(function (exercise) {
      const state = exerciseState(exercise.id);
      return {
        id: exercise.id,
        titulo: exercise.title,
        enunciado: exercise.prompt,
        resuelto: state.done,
        intentos: state.rows.map(function (row, index) {
          return {
            intento: index + 1,
            sql: row.sql,
            prompt: row.prompt,
            respuestaIA: row.ai,
            veredicto: row.verdict,
            comprobaciones: row.checks || 0,
            replanteamientos: row.refines || 0,
            inicio: row.startedAt,
            ultimaComprobacion: row.checkedAt
          };
        })
      };
    })
  };
  download("bdge-actividad-ia-" + (store.student || "alumno").replace(/[^\w-]+/g, "_") + "-" + slugDate() + ".json",
    JSON.stringify(payload, null, 2), "application/json");
}

function verdictWord(verdict) {
  if (!verdict) return "sin comprobar";
  if (verdict.kind === "ok") return "correcto";
  if (verdict.kind === "warn") return "mismas filas, distinto orden";
  return "incorrecto";
}

function exportMarkdown() {
  const lines = [];
  lines.push("# Actividad BDGE · consultas SQL con un tutor de IA generativa");
  lines.push("");
  lines.push("- **Alumno:** " + (store.student || studentInput.value || "(sin nombre)"));
  lines.push("- **Fecha de exportación:** " + new Date().toLocaleString("es-ES"));
  lines.push("- **Base de datos:** " + (datasetLabel || statusEl.textContent));
  lines.push("");
  lines.push("| Ejercicio | Resuelto | Intentos | Comprobaciones | Consultas a la IA |");
  lines.push("|---|---|---|---|---|");
  ITINERARY.forEach(function (exercise) {
    const state = exerciseState(exercise.id);
    const checks = state.rows.reduce(function (sum, row) { return sum + (row.checks || 0); }, 0);
    const ai = state.rows.filter(function (row) { return row.ai; }).length;
    lines.push("| " + exercise.title + " | " + (state.done ? "sí" : "no") + " | " + state.rows.length
      + " | " + checks + " | " + ai + " |");
  });
  lines.push("");
  ITINERARY.forEach(function (exercise, index) {
    const state = exerciseState(exercise.id);
    lines.push("## " + (index + 1) + ". " + exercise.title + (state.done ? " ✅" : " ⏳"));
    lines.push("");
    lines.push("> " + (exercise.prompt || ""));
    lines.push("");
    state.rows.forEach(function (row, rowIndex) {
      lines.push("### Intento " + (rowIndex + 1) + " · " + verdictWord(row.verdict));
      lines.push("");
      lines.push("**Mi consulta**");
      lines.push("");
      lines.push("```sql");
      lines.push(row.sql || "");
      lines.push("```");
      lines.push("");
      if (row.verdict && row.verdict.message) {
        lines.push("**Comprobador:** " + row.verdict.message);
        lines.push("");
      }
      lines.push("**Prompt enviado a la IA**");
      lines.push("");
      lines.push("```text");
      lines.push(row.prompt || "(no se envió prompt en este intento)");
      lines.push("```");
      lines.push("");
      lines.push("**Respuesta de la IA**");
      lines.push("");
      lines.push("```text");
      lines.push(row.ai || "(sin respuesta registrada)");
      lines.push("```");
      lines.push("");
    });
  });
  lines.push("## Cierre de la actividad");
  lines.push("");
  lines.push("**1. Un error que la IA me ayudó a ver y que no había detectado yo.**");
  lines.push("");
  lines.push(store.reflection.q1 || "(sin responder)");
  lines.push("");
  lines.push("**2. Una respuesta de la IA que tuve que descartar o corregir, y por qué.**");
  lines.push("");
  lines.push(store.reflection.q2 || "(sin responder)");
  lines.push("");
  lines.push("**3. ¿Qué haría distinto la próxima vez que me atranque con una consulta?**");
  lines.push("");
  lines.push(store.reflection.q3 || "(sin responder)");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Generado por la página de la actividad (BDGE, curso 2026-27).");
  download("bdge-actividad-ia-" + (store.student || "alumno").replace(/[^\w-]+/g, "_") + "-" + slugDate() + ".md",
    lines.join("\n"), "text/markdown");
}

// ── Zona de pruebas ────────────────────────────────────────────────────────
function renderSandbox() {
  const section = el("section", "exercise sandbox");
  const heading = el("div", "exercise-heading");
  const headingText = el("div");
  const title = el("h2", null, "Zona de pruebas");
  headingText.append(title);
  headingText.append(el("p", "exercise-prompt", "Un editor suelto para explorar las tablas antes de responder: "
    + "SHOW TABLES, DESCRIBE Posts, SELECT * FROM Posts LIMIT 5… No cuenta para la actividad."));
  heading.append(headingText);

  const area = el("div", "editor-area");
  const label = el("label", "editor-label");
  label.htmlFor = "sql-sandbox";
  label.append(el("span", null, "Consulta libre"));
  label.append(el("span", null, "Ctrl/Cmd + Intro ejecuta"));
  const textarea = el("textarea");
  textarea.id = "sql-sandbox";
  textarea.spellcheck = false;
  textarea.rows = 4;
  const actions = el("div", "editor-actions");
  actions.append(button("Ejecutar", "run-query", function () { runSandbox(); }));
  const result = el("div", "result");
  result.id = "result-sandbox";
  result.setAttribute("aria-live", "polite");
  result.append(el("p", "empty", "Ejecuta la consulta para ver el resultado."));
  area.append(label, textarea, actions);
  section.append(heading, area, result);
  sandboxEl.replaceChildren(section);

  if (hasSqlCodeMirror()) {
    const instance = window.CodeMirror.fromTextArea(textarea, {
      mode: "text/x-sql",
      theme: "material-darker",
      lineNumbers: true,
      lineWrapping: true,
      extraKeys: {
        "Ctrl-Enter": function () { runSandbox(); },
        "Cmd-Enter": function () { runSandbox(); }
      }
    });
    instance.setSize(null, 120);
    editorInstances.set("sql-sandbox", instance);
    label.addEventListener("click", function (event) { event.preventDefault(); instance.focus(); });
  }
}

async function runSandbox() {
  if (queryRunning || loading) return;
  const result = document.getElementById("result-sandbox");
  if (!database) {
    showQueryError(result, new Error("DuckDB aún no está listo."));
    return;
  }
  const instance = editorInstances.get("sql-sandbox");
  const sqlText = (instance ? instance.getValue() : document.getElementById("sql-sandbox").value).trim();
  if (!sqlText) {
    showQueryError(result, new Error("Escribe una consulta antes de ejecutarla."));
    return;
  }
  queryRunning = true;
  updateControls();
  result.replaceChildren(el("p", "result-summary", "Ejecutando…"));
  try {
    await validateStatement(database, sqlText, false);
    const cursor = await openCursor(database, sqlText);
    try {
      const rows = [];
      while (rows.length < RESULT_PAGE_SIZE) {
        const row = await cursor.next();
        if (row === null) break;
        rows.push(row);
      }
      result.replaceChildren();
      result.append(el("p", "result-summary", rows.length
        ? "Primeras " + rows.length + " filas del resultado."
        : "Consulta ejecutada. 0 filas."));
      if (rows.length) result.append(buildResultTable(cursor.columns, rows));
    } finally {
      await cursor.close();
    }
  } catch (error) {
    showQueryError(result, error);
  } finally {
    queryRunning = false;
    updateControls();
  }
}

// ── Arranque ───────────────────────────────────────────────────────────────
function applyMode() {
  store.mode = modeSelect.value === "api" ? "api" : "copy";
  apiSettingsEl.hidden = store.mode !== "api";
  modeNoteEl.textContent = store.mode === "api"
    ? "El prompt se envía al modelo que configures y su respuesta aparece directamente en la columna 3. "
      + "La clave se queda en este navegador: no se envía a ningún sitio salvo al endpoint indicado."
    : "Modo copiar y pegar: la página prepara el prompt, tú lo llevas a ChatGPT (o a la IA que uses) "
      + "y pegas la respuesta en la columna 3. No hace falta ninguna clave.";
  worksheets.forEach(syncWorksheet);
  saveStore();
}

function renderAll() {
  exerciseListEl.replaceChildren();
  ITINERARY.forEach(function (exercise, index) {
    renderExercise(exercise, index, exerciseListEl, {});
  });
  extraListEl.replaceChildren(el("p", "empty", "Despliega esta sección para cargar el resto del banco de ejercicios."));
}

let extraRendered = false;
function renderExtra() {
  if (extraRendered) return;
  extraRendered = true;
  extraListEl.replaceChildren();
  EXTRA.forEach(function (exercise, index) {
    renderExercise(exercise, ITINERARY.length + index, extraListEl, { compact: true });
  });
}

studentInput.addEventListener("input", function () {
  store.student = studentInput.value;
  saveStore();
});
modeSelect.addEventListener("change", applyMode);
[apiSettingsEl, endpointInput, modelInput, keyInput].forEach(function (node) {
  node.addEventListener("input", persistApiSettings);
});
rememberInput.addEventListener("change", persistApiSettings);
testApiButton.addEventListener("click", testApiConnection);
exportJsonButton.addEventListener("click", exportJson);
exportMdButton.addEventListener("click", exportMarkdown);
resetButton.addEventListener("click", function () {
  const sure = window.confirm("Se borrarán tus intentos, tus prompts y las respuestas de la IA guardadas en este navegador. "
    + "Exporta el registro antes si lo necesitas. ¿Continuar?");
  if (!sure) return;
  store = defaultStore();
  store.student = studentInput.value;
  store.mode = modeSelect.value;
  reflectionInputs.forEach(function (input) { input.value = ""; });
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch (error) { /* nada que borrar */ }
  editorInstances.forEach(function (instance) { instance.setValue(""); });
  worksheets.clear();
  renderAll();
  updateProgress();
  settingsStatusEl.textContent = "Trabajo borrado. Puedes empezar de nuevo.";
});
extraBankEl.addEventListener("toggle", function () {
  if (extraBankEl.open) renderExtra();
});
loadRealButton.addEventListener("click", loadRemoteDatabase);
loadDemoButton.addEventListener("click", function () { loadDataset("Muestra pequeña activa", createDemoDatabase); });
localFileInput.addEventListener("change", function () {
  loadLocalFiles(Array.from(localFileInput.files || []));
});

// Ctrl/Cmd + Intro dentro de la zona de pruebas, cuando no hay CodeMirror.
document.addEventListener("keydown", function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && event.target.id === "sql-sandbox") {
    event.preventDefault();
    runSandbox();
  }
});

function initialize() {
  store.student = store.student || "";
  studentInput.value = store.student;
  modeSelect.value = store.mode === "api" ? "api" : "copy";
  restoreApiSettings();
  store.reflection = Object.assign({ q1: "", q2: "", q3: "" }, store.reflection || {});
  reflectionInputs.forEach(function (input, index) {
    const key = "q" + (index + 1);
    input.value = store.reflection[key] || "";
    input.addEventListener("input", function () {
      store.reflection[key] = input.value;
      saveStore();
    });
  });
  applyMode();
  renderAll();
  updateProgress();
  renderSandbox();
  editorModeNoteEl.textContent = hasSqlCodeMirror()
    ? "Resaltado SQL activo · consultas ejecutadas con DuckDB-Wasm en tu navegador."
    : "No se pudo cargar CodeMirror; los cuadros de texto siguen funcionando sin resaltado.";
  updateControls();

  createDemoDatabase().then(function (demo) {
    database = demo;
    engineReady = true;
    setStatus("DuckDB · muestra pequeña activa", "ready");
    updateControls();
    refreshSchema(demo);
    loadRemoteDatabase();
  }).catch(function (error) {
    setStatus("No se pudo iniciar DuckDB", "error");
    messageEl.textContent = error.message;
  });
}

initialize();
