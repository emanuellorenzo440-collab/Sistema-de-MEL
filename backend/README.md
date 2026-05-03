# Backend

Capa de API para Sistema de MEL. Por ahora queda con una base minima sin dependencias externas, pero ya formaliza la logica critica de reportes, revision, analitica ejecutiva y trazabilidad.

## Responsabilidades

- Autenticacion y roles.
- API REST para programas, indicadores, reportes, formularios, concept papers y planes de accion.
- Validacion de datos antes de escribir en base de datos.
- Trazabilidad de cambios de estado en reportes.
- Analitica ejecutiva basada por defecto en reportes aprobados.
- Integraciones futuras: almacenamiento de archivos, correo, dashboards externos y auditoria.

## Ejecutar

```bash
node backend/src/server.js
```

## Endpoints disponibles hoy

- `GET /health`
- `GET /api/v1`
- `GET /api/v1/programs`
- `GET /api/v1/reports?program=...&programId=...&province=...&period=...&scope=approved|all`
- `POST /api/v1/reports`
- `POST /api/v1/reports/bulk`
- `PATCH /api/v1/reports/:id/status`
- `GET /api/v1/reports/:id/status-history`
- `GET /api/v1/analytics/config`
- `GET /api/v1/analytics/overview`

## Regla clave

La lectura ejecutiva usa por defecto `scope=approved`. La vista operativa puede pedir `scope=all`, pero no debe reemplazar la lectura validada para direccion.
