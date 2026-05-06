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
