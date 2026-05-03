# Database

Base de datos propuesta para Sistema de MEL. El esquema inicial esta en `schema.sql` y esta pensado para PostgreSQL cuando el sistema tenga backend real.

## Entidades principales

- Usuarios y roles.
- Programas.
- Indicadores.
- Reportes.
- Historial de estados de reportes.
- Formularios de monitoreo.
- Subidas/importaciones.
- Concept papers.
- Planes de accion.
- Auditoria.

## Regla clave

El frontend no debe escribir directamente en la base de datos. El flujo correcto sera:

`frontend -> backend API -> database`

## Regla analitica

La analitica ejecutiva debe construirse por defecto sobre reportes aprobados. Para sostener eso en una base real, el esquema ya separa el estado actual del reporte de su historial de revision.
