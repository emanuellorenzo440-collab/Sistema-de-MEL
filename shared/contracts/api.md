# Contrato API v1

Base propuesta para conectar frontend, backend y base de datos.

## Recursos

- `GET /api/v1/programs`
- `GET /api/v1/reports?program=...&programId=...&province=...&period=...&scope=approved|all`
- `POST /api/v1/reports`
- `POST /api/v1/reports/bulk`
- `PATCH /api/v1/reports/:id/status`
- `GET /api/v1/reports/:id/status-history`
- `GET /api/v1/analytics/config`
- `GET /api/v1/analytics/overview?program=...&programId=...&province=...&period=...&scope=approved|all`
- `GET /api/v1/forms?programId=...`
- `POST /api/v1/form-submissions`
- `GET /api/v1/concept-papers?programId=...`
- `GET /api/v1/actions`
- `POST /api/v1/actions`

## Convenciones

- Todas las respuestas devuelven JSON.
- Los identificadores son strings estables.
- Fechas en formato ISO 8601.
- Los errores usan `{ "error": "mensaje", "details": {} }`.
- El backend valida permisos segun rol antes de modificar datos.
- La analitica ejecutiva debe usar por defecto `scope=approved`.
- La vista operativa puede usar `scope=all`, pero debe marcar que incluye datos no aprobados.
- El backend habilita CORS para desarrollo local entre frontend y API.

## Payload sugerido para crear un reporte

`POST /api/v1/reports`

```json
{
  "id": "rep-1714743453000",
  "date": "2026-05-03",
  "period": "2026-05",
  "program": "Girls Empowerment",
  "province": "Centros de programa",
  "indicatorId": "ind-ge-1",
  "value": 24,
  "women": 24,
  "men": 0,
  "youth": 24,
  "owner": "Facilitadora local",
  "status": "Pendiente"
}
```

## Payload sugerido para validar reportes

`PATCH /api/v1/reports/:id/status`

```json
{
  "status": "Aprobado",
  "actorId": "usr-supervision",
  "actorRole": "Supervision M&E",
  "note": "Datos consistentes con evidencia adjunta"
}
```

## Respuesta sugerida para analitica

`GET /api/v1/analytics/overview`

```json
{
  "data": {
    "scope": {
      "requested": "approved",
      "applied": "approved",
      "default": "approved",
      "executiveDefault": "approved"
    },
    "summary": {
      "visibleReports": 4,
      "analyzedReports": 2,
      "excludedReports": 2,
      "totalValue": 330
    },
    "metrics": [],
    "charts": {
      "indicators": [],
      "periods": [],
      "programs": [],
      "statuses": []
    },
    "stats": [],
    "insights": []
  }
}
```
