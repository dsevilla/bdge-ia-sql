# Ficha de la actividad · Curso de Inteligencia Artificial para la Docencia Universitaria

| Item | Descripción |
|---|---|
| **Asignatura** | Bases de Datos a Gran Escala (BDGE) · Máster Universitario en Big Data (Universidad de Murcia / Universidad de Santiago de Compostela) · curso 2026-27 |
| **Contenido Temático** | Bloque SQL de la asignatura (sesiones 1 y 2): consultas sobre grandes volúmenes de datos, filtrado y ordenación, agregación con `GROUP BY`/`HAVING`, reuniones (`JOIN` y `LEFT JOIN`), subconsultas y `NOT EXISTS`, rangos de fechas, CTE, funciones de ventana, JSON y lectura del plan de ejecución. Datos reales: Stack Overflow en español (tablas `Posts`, `Users`, `Tags`, `Comments` y `Votes`) consultadas con DuckDB. |
| **Objetivo de la Actividad** | Que el alumnado aprenda a **diagnosticar y corregir sus propias consultas SQL** usando un modelo de IA generativa como tutor que señala el error sin resolverlo, y que sea capaz de valorar críticamente la sugerencia recibida. Objetivos concretos: (1) escribir la consulta antes de consultar a la IA; (2) formular un prompt que describa el problema con precisión, a partir del diagnóstico del comprobador; (3) discernir entre la pista útil y la respuesta incorrecta o que resuelve el ejercicio por ellos; (4) documentar el proceso completo intento → prompt → respuesta → corrección. |
| **Herramienta de IAG Utilizada** | Modelo conversacional de propósito general de última generación, usado como **tutor socrático de SQL**. La página admite dos modos: (a) *copiar y pegar* con cualquier chat público (ChatGPT, Gemini, Claude, Copilot) —no requiere claves—; (b) *modelo conectado* mediante una API compatible con OpenAI: GPT-4o-mini / GPT-4.1, el servicio LLM corporativo de la UMU (Nienna, `https://nienna-llm.inf.um.es/v1`) o un modelo local servido con Ollama/LM Studio. En ambos casos el modelo se invoca con un *system prompt* que le prohíbe explícitamente entregar la consulta resuelta. |
| **Descripción de la Actividad** | La actividad se realiza sobre una página web (ver *Recurso diseñado*) con 10 ejercicios de SQL de dificultad creciente sobre Stack Overflow en español. Cada ejercicio abre un **cuaderno de intentos** de tres columnas: **1) Mi respuesta**, escrita por el alumno sin IA y validada con un comprobador que compara su resultado con la solución de referencia (columnas, filas y valores); **2) Lo que le pregunto a la IA**, donde la página redacta —y el alumno puede editar— un prompt que incluye el enunciado, el esquema real de las tablas, su consulta y el diagnóstico del comprobador, y le pide al modelo que explique el error, señale el concepto a repasar y devuelva una pregunta guía, sin dar la solución; **3) Lo que me sugiere la IA**, con la respuesta del modelo. Pasos: (1) resolver el ejercicio sin ayuda y pulsar *Comprobar*; (2) si falla, volver a preguntar a la IA desde la columna 3, que añade el diagnóstico al prompt; (3) pulsar *Añadir otra respuesta* para abrir una fila nueva que hereda la consulta anterior y corregirla; (4) repetir hasta que el comprobador dé la respuesta por buena —en ese momento el ejercicio se cierra y ya no admite más intentos, y se desbloquea la solución de referencia para compararla con la propia—; (5) responder a las tres preguntas de cierre y exportar el registro (JSON) y el informe (Markdown) con todos los intentos, prompts y respuestas. Duración prevista: una sesión de laboratorio de 2 h y trabajo autónomo hasta cerrar los 10 ejercicios. |
| **Uso de la IA** | **Ambas.** *Integración didáctica en el aula*: la IA es el tutor con el que el alumno dialoga para depurar sus consultas, y el objeto de aprendizaje es el propio diálogo (prompting reflexivo, verificación y descarte de sugerencias erróneas). *Productividad docente*: la misma página automatiza la parte repetitiva —enunciados y soluciones de referencia del banco de ejercicios, comprobación automática del resultado, redacción del prompt con el diagnóstico del comprobador y generación del informe de cada alumno—, de modo que el profesor dedica el tiempo de clase a los errores conceptuales y no a corregir consultas una a una. |
| **Recurso Diseñado** | Página web autocontenida, sin instalación ni servidor: **<https://dsevilla.github.io/bdge-ia-sql/>**. Código fuente: <https://github.com/dsevilla/bdge-ia-sql>. Ejecuta DuckDB-Wasm en el navegador sobre los Parquet de Stack Overflow en español; el trabajo del alumno se guarda en su navegador y se exporta como JSON y como informe Markdown para la entrega. No requiere cuenta ni clave en el modo por defecto. |
| **Metodología Implementada** | **Aprendizaje Basado en Problemas** con **andamiaje metacognitivo** (*scaffolding*): el alumnado aborda consultas reales sobre un volumen de datos real y la IA actúa como apoyo decreciente que no sustituye la resolución. La secuencia intento propio → diagnóstico automático → prompt fundamentado → pista de la IA → nuevo intento convierte la depuración de SQL en un proceso explícito y evaluable, y traslada el foco del resultado a la reflexión sobre el propio razonamiento (¿qué he supuesto mal?, ¿qué me ha dicho la IA que no era cierto?). |
| **Evaluación de la Actividad** | Evaluación formativa durante la sesión (observación de los cuadernos) y sumativa sobre el registro exportado, con rúbrica: |

### Rúbrica de evaluación

| Criterio | Peso | Excelente (10) | Adecuado (7) | Insuficiente (<5) |
|---|---|---|---|---|
| **Corrección de la consulta final** | 40 % | Cierra los 10 ejercicios con consultas correctas, legibles y bien estructuradas (alias, formato, sin columnas de más). | Cierra 7-9 ejercicios; alguna consulta correcta pero enrevesada o con `SELECT *` innecesario. | Cierra menos de 7 ejercicios o llega al resultado por ensayo y error sin criterio. |
| **Calidad del prompt y del ciclo de preguntas** | 25 % | El prompt describe el problema con precisión, incorpora el diagnóstico del comprobador y el intento previo, y pide una pista concreta; las preguntas de seguimiento son específicas. | Prompts correctos pero genéricos («no me sale», «corrige esto»), con poca información del error. | Envía el enunciado tal cual o pide directamente la solución. |
| **Uso crítico de la respuesta de la IA** | 20 % | Contrasta cada sugerencia con el resultado del comprobador, detecta y descarta al menos una respuesta errónea o incompleta, y lo justifica en el cierre. | Acepta la sugerencia tras comprobarla, sin analizar los casos en que la IA se equivoca. | Copia la respuesta de la IA sin comprobarla, o deja que le dé la consulta hecha. |
| **Registro y reflexión final** | 15 % | Entrega el JSON y el informe Markdown completos, con el historial de intentos íntegro, y responde a las tres preguntas de cierre con ejemplos concretos. | Entrega el registro y responde a las preguntas de forma breve pero pertinente. | Registro incompleto o preguntas de cierre sin responder. |

**Entrega**: el fichero `bdge-actividad-ia-<nombre>.json` y el informe `.md` que genera el botón de
exportación de la propia página, subidos al aula virtual.

### Preguntas de cierre (incluidas en la entrega)

1. Un error que la IA te ayudó a ver y que no habías detectado tú.
2. Una respuesta de la IA que tuviste que descartar o corregir, y por qué.
3. ¿Qué harías distinto la próxima vez que te atranques con una consulta?

### Notas de aplicación en el aula

- La página incluye la regla explícita de que **la IA no debe dar la consulta resuelta**, y el *system
  prompt* se lo exige. Si un modelo la da igualmente, el alumno debe no copiarla: forma parte de la
  competencia evaluada en el tercer criterio de la rúbrica.
- No hace falta que el alumnado tenga cuenta en ninguna IA: en el modo copiar y pegar, la página redacta
  el prompt y cada estudiante lo lleva al chat que ya use. Si el centro dispone de un servicio corporativo
  (en la UMU, Nienna), se configura una vez en el apartado *Alumno y conexión con la IA*.
- El comprobador compara resultados, no texto: cualquier consulta equivalente es aceptada. Solo se exige
  el `ORDER BY` cuando el enunciado pide un orden concreto (si las filas coinciden pero el orden no, el
  veredicto avisa en lugar de darlo por bueno).
- Si un ejercicio se cierra por error (por ejemplo, con la muestra pequeña de datos cargada), el botón
  *Borrar mi trabajo* reinicia el cuaderno de ese navegador.
