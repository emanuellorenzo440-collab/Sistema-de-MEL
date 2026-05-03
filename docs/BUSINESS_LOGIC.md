# Logica de Negocio

## Principio central

La fuente final de verdad debe ser la base de datos. El frontend puede guardar informacion temporal, pero el backend debe validar y persistir todo lo importante.

## Flujo objetivo

1. Un usuario entra con un rol.
2. El sistema muestra permisos y acciones segun ese rol.
3. El usuario captura o importa datos.
4. El backend valida formato, rol, programa, indicador y periodo.
5. El sistema crea reportes en estado Pendiente.
6. Supervisores validan, aprueban o devuelven reportes.
7. Los indicadores se actualizan con datos aprobados o con reglas definidas.
8. Las graficas muestran avances por programa, indicador y periodo.
9. Cada cambio importante se registra en auditoria.

## Entidades principales

- User: persona con acceso al sistema.
- Program: programa o proyecto monitoreado.
- Indicator: meta medible asociada a un programa.
- Report: dato capturado contra un indicador.
- MonitoringForm: plantilla para recolectar informacion.
- FormSubmission: archivo o formulario importado.
- ConceptPaper: documento base del programa.
- ActionItem: seguimiento o correccion requerida.
- AuditLog: registro de cambios.

## Reglas iniciales

- Un reporte siempre pertenece a un programa y a un indicador.
- Un indicador siempre pertenece a un programa.
- Un reporte nuevo inicia como Pendiente.
- Solo roles de supervision o liderazgo pueden aprobar reportes.
- Una devolucion debe crear o asociar un plan de accion.
- El sistema debe distinguir carga automatica CSV de archivos de soporte.
- La importacion automatica debe mapear campos a indicadores.
- La evidencia debe poder existir como texto, enlace o archivo en una fase futura.

## Estados sugeridos

Reportes:

- Pendiente
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
- Los indicadores mostrados en graficas deben agregarse a partir de reportes, no de valores decorativos.

## Reglas de analitica

- El sistema debe generar estadistica automatica basada en la informacion entrante de reportes.
- El sistema debe poder sugerir posibles mejoras de programa a partir de indicadores, tendencia y estados de reportes.
- El bot analista no reemplaza decisiones humanas; prioriza alertas, patrones y oportunidades.
- Las recomendaciones deben cambiar cuando cambian filtros o nuevos reportes.

## Reglas pendientes por definir

- Si los indicadores se actualizan con reportes pendientes o solo aprobados.
- Politica de edicion de reportes despues de aprobacion.
- Versionado de formularios.
- Flujo de carga y almacenamiento de archivos.
- Reglas de cierre mensual o trimestral.

