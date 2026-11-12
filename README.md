# BDGE · Consultas SQL con un tutor de IA generativa

Actividad docente de la asignatura **Bases de Datos a Gran Escala** (Máster en Big Data, Universidad de
Murcia / USC, curso 2026-27). Es una página web estática, publicable en GitHub Pages, en la que el
alumnado resuelve consultas SQL sobre Stack Overflow en español y usa un modelo de IA generativa como
tutor que le señala el error **sin darle la solución**.

Está construida sobre la [práctica SQL en el navegador](https://dsevilla.github.io/bdge/practice-web/sql/)
de la asignatura: mismo motor (DuckDB-Wasm) y mismo banco de ejercicios, con un cuaderno de tres columnas
por ejercicio y un comprobador que cierra el ejercicio en cuanto la consulta es correcta.

- Página de la actividad: <https://dsevilla.github.io/bdge-ia-sql/>
- Bancos de datos: <https://github.com/dsevilla/bd2-data>

## Cómo funciona (alumno)

Cada ejercicio tiene un cuaderno de intentos. Cada intento es una fila con tres columnas:

| Columna | Qué se escribe |
|---|---|
| **1 · Mi respuesta (sin IA)** | La consulta SQL, escrita primero por el alumno, y el botón **Comprobar**. |
| **2 · Lo que le pregunto a la IA** | El prompt: lo redacta la página (**Preparar pregunta**) con el enunciado, el esquema real de las tablas, la consulta del alumno y el diagnóstico del comprobador. Es editable. |
| **3 · Lo que me sugiere la IA** | La respuesta del modelo, pegada a mano o recibida del endpoint conectado. |

1. Escribe la consulta sin ayuda y pulsa **Comprobar**.
2. Si es correcta, el ejercicio se cierra: no se admiten más intentos y se desbloquea la solución de
   referencia para compararla.
3. Si falla, la columna 3 ofrece **Volver a preguntar con el diagnóstico**: añade al prompt lo que ha
   dicho el comprobador y lo que respondió antes la IA, y vuelve a preguntar.
4. **+ Añadir otra respuesta** abre una fila nueva que hereda la consulta anterior, para corregirla. Cada
   fila conserva su prompt y su respuesta de la IA, así que el registro final muestra todo el proceso.

Trabajo guardado en `localStorage` del navegador. Los botones **Exportar registro (JSON)** y
**Exportar informe (Markdown)** generan el fichero que se entrega en el aula virtual.

## Dos modos de usar la IA

**Copiar y pegar (por defecto, sin claves).** La página redacta el prompt; el alumno pulsa *Abrir en
ChatGPT* (o copia el prompt en la IA que use) y pega la respuesta en la columna 3. Funciona con cualquier
chat público y no cuesta nada de integrar.

**Modelo conectado (compatible OpenAI).** En *Alumno y conexión con la IA* se indica endpoint, modelo y
clave; la respuesta aparece directamente en la columna 3. Sirve cualquier API compatible:
OpenAI (`https://api.openai.com/v1`), el servicio LLM de la UMU (`https://nienna-llm.inf.um.es/v1`) o un
modelo local con Ollama / LM Studio / vLLM (`http://localhost:11434/v1`).

> La clave se guarda **solo en el navegador del alumno** (en memoria de la pestaña; en `localStorage` si
> marca «recordar»). No se envía a ningún sitio salvo al endpoint configurado. Para un despliegue con una
> clave compartida del profesorado, pon delante un proxy que inyecte la credencial: nunca publiques una
> clave en el repositorio.
>
> El endpoint debe permitir CORS desde el origen de la página (`Access-Control-Allow-Origin`), porque la
> llamada se hace desde el navegador. OpenAI y la mayoría de servidores locales lo permiten; algunos
> portales institucionales no, y entonces hay que usar el modo copiar/pegar o un proxy.

## Despliegue

Es un sitio estático sin compilación: `index.html`, `styles.css`, `app.js`, `engine.js` y `pages/`.

```bash
# servidor local (módulos ES: no abrir index.html como file://)
python3 -m http.server 8765
# http://127.0.0.1:8765/
```

En GitHub: *Settings → Pages → Deploy from a branch → `main` / `/ (root)`*.

## Estructura

```
index.html              Estructura de la página: instrucciones, ajustes, base de datos, ejercicios
styles.css              Hoja de estilos (tokens de color de la práctica de BDGE + cuaderno)
engine.js               Motor DuckDB-Wasm: creación de la base, cursores, validación de sentencias
app.js                  Actividad: cuaderno de intentos, comprobador, prompts, modos de IA, exportación
pages/banco.js          Banco de 41 ejercicios de BDGE (enunciado + solución de referencia)
pages/itinerario.js     Los 10 ejercicios obligatorios, con objetivo de aprendizaje y pista
pages/index.js          Une banco + itinerario: ITINERARY (obligatorios) y EXTRA (resto)
```

Para cambiar el itinerario, edita `pages/itinerario.js`: cada entrada es un `id` del banco más su
`objetivo` y su `pista`. Los ejercicios que no estén ahí aparecen en el desplegable *Banco de ejercicios
completo*.

## Cómo comprueba

El resultado de la consulta del alumno se compara con el de la solución de referencia del banco:
número de columnas, número de filas y valor y tipo de cada celda (los nombres de columna no importan).
Si las filas coinciden pero el orden no, el veredicto avisa en vez de darlo por bueno. El diagnóstico que
se envía a la IA es exactamente ese mensaje, de modo que la IA no adivina: parte de lo que el comprobador
ha detectado.

## Privacidad

Las consultas, los Parquet y los prompts se procesan en el navegador. Solo sale de él lo que el alumno
envía expresamente: el prompt a ChatGPT al pulsar *Abrir en ChatGPT*, o la petición al endpoint que haya
configurado.

## Créditos

- Ejercicios y datos: asignatura BDGE (Diego Sevilla Ruiz), repositorio
  [dsevilla/bdge](https://github.com/dsevilla/bdge) y datos [dsevilla/bd2-data](https://github.com/dsevilla/bd2-data).
- Motor SQL en el navegador: [DuckDB-Wasm](https://duckdb.org/docs/api/wasm/overview) y
  [CodeMirror 5](https://codemirror.net/5/).
