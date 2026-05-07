# Logica de Negocio

## Principio central

La fuente final de verdad debe ser la base de datos. El frontend puede guardar informacion temporal, pero el backend debe validar y persistir todo lo importante.

## Flujo objetivo

1. Un usuario entra con un rol.
2. El sistema muestra permisos y acciones segun ese rol.
3. El usuario captura o importa datos.
4. El backend valida formato, rol, programa, indicador y periodo.
5. El sistema crea reportes en estado Pendiente coordinacion.
6. Coordinador de programa revisa y, si procede, envia el reporte a Program Manager.
7. Program Manager revisa y, si procede, envia el reporte a Supervision M&E.
8. Supervision M&E valida calidad, consistencia y evidencia; solo entonces aprueba.
9. Los indicadores se actualizan solo con datos aprobados por Supervision M&E.
10. Las graficas muestran avances por programa, indicador y periodo usando la base aprobada por defecto.
11. Cada cambio importante se registra en auditoria.

## Entidades principales

- User: persona con acceso al sistema.
- Program: programa o proyecto monitoreado.
- Indicator: meta medible asociada a un programa.
- Report: dato capturado contra un indicador.
- ReportStatusHistory: historial de decisiones sobre un reporte.
- MonitoringForm: plantilla para recolectar informacion.
- FormSubmission: archivo o formulario importado.
- ConceptPaper: documento base del programa.
- ActionItem: seguimiento o correccion requerida.
- Notification: alerta interna dirigida a un rol o usuario.
- EmailOutbox: correo preparado para envio por proveedor externo.
- AuditLog: registro de cambios.

## Reglas iniciales

- Un reporte siempre pertenece a un programa y a un indicador.
- Un indicador siempre pertenece a un programa.
- Un reporte nuevo inicia como Pendiente coordinacion.
- Un reporte nuevo debe generar alerta interna y correo en cola para el coordinador de programa.
- Cuando Coordinador de programa aprueba, el sistema debe generar alerta y correo para Program Manager.
- Cuando Program Manager aprueba, el sistema debe generar alerta y correo para Supervision M&E.
- Solo la aprobacion final de Supervision M&E habilita el reporte para indicadores y analitica ejecutiva.
- Solo los roles definidos en cada etapa pueden mover el reporte a la siguiente.
- Una devolucion debe crear o asociar un plan de accion.
- El sistema debe distinguir carga automatica CSV de archivos de soporte.
- La importacion automatica debe mapear campos a indicadores.
- La evidencia debe poder existir como texto, enlace o archivo en una fase futura.
- Toda decision sobre un reporte debe guardar actor, rol, observacion y fecha.

## Estados sugeridos

Reportes:

- Pendiente coordinacion
- Pendiente Program Manager
- Pendiente Supervision M&E
- Aprobado
- Necesita correccion
- Rechazado

Planes de accion:

- Abierto
- En progreso
- Cerrado
- Vencido

Procesamiento de importaciones:

- automatico
- soporte
- error

## Permisos por rol

Facilitador:

- Crear reportes.
- Descargar formularios.
- Subir formularios completados.
- Ver sus reportes y estado.

Coordinador de programa:

- Ver avance de su programa.
- Crear reportes.
- Revisar formularios y acciones de su programa.

Program Manager:

- Validar reportes.
- Crear indicadores y formularios.
- Gestionar planes de accion.

Supervision M&E:

- Validar calidad de datos.
- Aprobar o devolver reportes.
- Revisar consistencia de indicadores.

Director Nacional:

- Ver dashboard ejecutivo.
- Consultar avance, riesgos y alertas.
- Revisar datos aprobados.

## Reglas de visualizacion

- Las graficas deben alimentarse de reportes registrados en el sistema.
- Las graficas deben responder a los filtros activos de programa, provincia y periodo.
- El usuario puede elegir el tipo de visualizacion sin cambiar los datos base.
- El usuario puede cambiar la base del analisis entre todos los reportes visibles y solo reportes aprobados.
- La vista recomendada para lectura ejecutiva debe usar solo reportes aprobados.
- Los indicadores mostrados en graficas deben agregarse a partir de reportes, no de valores decorativos.

## Reglas de analitica

- El sistema debe generar estadistica automatica basada en la informacion entrante de reportes.
- El sistema debe poder sugerir posibles mejoras de programa a partir de indicadores, tendencia y estados de reportes.
- El bot analista no reemplaza decisiones humanas; prioriza alertas, patrones y oportunidades.
- Las recomendaciones deben cambiar cuando cambian filtros o nuevos reportes.
- La API debe poder entregar la misma lectura ejecutiva que el frontend, para no duplicar logica critica.

## Reglas de integracion

- Si la API esta disponible, el frontend debe leer reportes y analitica desde backend.
- Si la API no esta disponible, el frontend puede caer temporalmente a modo local sin romper la experiencia.
- El historial de estados debe permitir explicar por que un dato entro o salio de la lectura ejecutiva.
- actorId es obligatorio para cambios de estado cuando el backend recibe una decision de revision.
- Las alertas deben filtrar por empresa, programa, rol destinatario y estado para soportar multiples organizaciones.
- El correo se maneja como outbox auditable: primero se registra, luego un proveedor externo lo envia o reporta error.

## Reglas pendientes por definir

- Politica de edicion de reportes despues de aprobacion.
- Versionado de formularios.
- Flujo de carga y almacenamiento de archivos.
- Reglas de cierre mensual o trimestral.
