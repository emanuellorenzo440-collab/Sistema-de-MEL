# Worklog

## 2026-05-03

Pedido del usuario:

- Todo lo que el usuario diga expresa como quiere que se sienta el proyecto como experiencia.
- Codex queda a cargo de la logica de negocio completa.
- Codex queda a cargo de frontend, UI, UX y experiencia completa.
- El proyecto debe poder usarse en celular con modo responsivo.
- Todo debe documentarse.
- Debe existir un handoff.
- Codex puede proponer alternativas mejores cuando mejoren experiencia, logica o arquitectura.
- La meta es hacer un software excelente aunque tome tiempo.

Acciones realizadas:

- Se agrego documentacion de producto.
- Se agrego documentacion de logica de negocio.
- Se agrego guia UX/UI.
- Se agrego estrategia responsiva.
- Se agrego proceso de documentacion.
- Se agrego registro de decisiones.
- Se agrego handoff del proyecto.
- Se formalizo el criterio de excelencia sobre velocidad.
- Se agrego selector de tipo de grafico para indicadores y periodos.
- Las graficas ahora responden a los reportes y a los filtros activos.
- Se agrego index raiz para redirigir GitHub Pages al frontend.
- Se agrego estadistica automatica basada en reportes.
- Se agrego bot analista con recomendaciones de mejora para programas.
- Se agregaron comparativa por programa y tendencia temporal.
- Se agrego selector de base analitica para elegir entre todos los reportes visibles y solo reportes aprobados.
- La vista recomendada de analitica queda predeterminada en reportes aprobados.
- Las metricas, graficas y recomendaciones del bot ahora se recalculan segun la base analitica seleccionada.
- Se formalizo la misma regla en backend, contratos compartidos y base de datos.
- Se agrego historial de estados para aprobacion, correccion y rechazo de reportes.
- La API ahora expone endpoints para crear reportes, importarlos en lote, revisar estados y consultar analitica.
- Se agrego cliente de API para que el frontend pueda conectarse al backend cuando este disponible.
- Se habilito CORS para desarrollo local entre frontend y backend.
- Se agrego un puente de ejecucion en frontend para sincronizar reportes, importaciones y revisiones con la API sin romper la interfaz actual.
- La interfaz ahora puede arrancar con reportes remotos, empujar nuevos reportes al backend y reflejar estados aprobados desde la API.
- La vista de graficas ahora se alimenta directamente del endpoint `analytics/overview` para que metricas, comparativas, tendencia y recomendaciones salgan de la misma fuente ejecutiva del backend.

## 2026-05-05

Pedido del usuario:

- Continuar convirtiendo el prototipo en software operativo real.
- Registrar automaticamente los cambios en Git para que sean visibles en VS Code y GitHub.
- Mantener compatibilidad entre macOS y Windows.

Acciones realizadas:

- Se agrego CRUD REST para programas: listar, crear, actualizar y eliminar con bloqueo cuando existen datos asociados.
- Se agrego CRUD REST para indicadores: listar, crear, actualizar y eliminar con bloqueo cuando existen reportes asociados.
- El frontend ahora carga programas e indicadores desde la API cuando esta disponible, manteniendo localStorage como respaldo.
- La matriz de indicadores incluye formulario de alta/edicion y acciones de editar/eliminar por indicador.
- La vista de programas incluye formulario de alta/edicion y acciones de editar/eliminar por programa.
- Se documento el contrato API de programas e indicadores.

Pedido del usuario:

- Cuando un facilitador suba un reporte, su coordinador de programa y Supervision M&E deben recibir correo y alerta dentro del sistema para aprobar.
- El sistema debe prepararse para crecer y trabajar en diferentes empresas.

Acciones realizadas:

- Se agrego generacion automatica de alertas internas al crear reportes.
- Se agregaron destinatarios por rol para Coordinador de programa y Supervision M&E.
- Se agrego una outbox de correos para registrar mensajes pendientes de envio sin depender aun de un proveedor externo.
- Se agregaron endpoints para consultar alertas, marcar alertas como leidas y auditar correos en cola.
- El frontend ahora muestra bandeja de alertas internas en resumen y supervision.
- El esquema SQL incorpora `company_id`, `notifications` y `email_outbox` como base multiempresa.

## 2026-05-07

Pedido del usuario:

- Cambiar la aprobacion de reportes a una cadena real: Coordinador de programa, luego Program Manager, luego Supervision M&E.
- Solo despues de la aprobacion final el reporte debe alimentar graficas, indicadores y datos operativos del diseno de M&E.

Acciones realizadas:

- Se reemplazo el estado unico `Pendiente` por tres estados: `Pendiente coordinacion`, `Pendiente Program Manager` y `Pendiente Supervision M&E`.
- Se actualizo la validacion del backend para que cada rol solo pueda aprobar la etapa que le corresponde.
- Las alertas y correos en outbox ahora se generan por etapa y pasan al siguiente aprobador en la cadena.
- El frontend filtra la cola de revision segun el rol activo y renombra la accion principal segun el siguiente paso.
- La recomputacion de indicadores en frontend y runtime bridge ahora usa solo reportes aprobados por Supervision M&E.
- Se agrego correo de Program Manager en la configuracion del programa y en el esquema SQL.

Pedido del usuario:

- Permitir subir en Reportes los formularios ya creados en Formularios.
- Leer esos formularios y completar automaticamente la captura de actividades y metricas.
- Usar esa informacion para alimentar luego la cadena de aprobacion, indicadores y graficas.

Acciones realizadas:

- Se agrego un asistente de formularios dentro de la vista Reportes.
- El asistente lee CSV descargados desde Formularios y genera borradores de reporte.
- Cada borrador puede cargar automaticamente programa, indicador, periodo, responsable, evidencia y observaciones dentro de la captura manual.
- Tambien se pueden enviar varios borradores a revision en lote sin reescribir la informacion.
- La importacion desde Formularios y la nueva carga desde Reportes ahora usan la misma logica de cola de revision.
