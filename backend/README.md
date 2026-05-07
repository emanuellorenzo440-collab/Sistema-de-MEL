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
- `POST /api/v1/programs`
- `PUT /api/v1/programs/:id`
- `DELETE /api/v1/programs/:id`
- `GET /api/v1/indicators?program=...&programId=...`
- `POST /api/v1/indicators`
- `PUT /api/v1/indicators/:id`
- `DELETE /api/v1/indicators/:id`
- `GET /api/v1/reports?program=...&programId=...&province=...&period=...&scope=approved|all`
- `POST /api/v1/reports`
- `POST /api/v1/reports/bulk`
- `GET /api/v1/notifications?recipientRole=...&status=...&programId=...`
- `PATCH /api/v1/notifications/:id/read`
- `GET /api/v1/email-outbox?status=...&programId=...`
- `PATCH /api/v1/reports/:id/status`
- `GET /api/v1/reports/:id/status-history`
- `GET /api/v1/analytics/config`
- `GET /api/v1/analytics/overview`

## Regla clave

La lectura ejecutiva usa por defecto `scope=approved`. La vista operativa puede pedir `scope=all`, pero no debe reemplazar la lectura validada para direccion.

Cuando un facilitador crea un reporte, el backend inicia la cadena `Coordinador de programa -> Program Manager -> Supervision M&E`. Cada paso genera la alerta interna y el correo en `email_outbox` para el siguiente aprobador. Solo la aprobacion final de `Supervision M&E` habilita el reporte para la lectura ejecutiva.
