# Contrato API v1

Base propuesta para conectar frontend, backend y base de datos.

## Recursos

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
- `GET /api/v1/notifications?recipientRole=...&status=...&programId=...&companyId=...`
- `PATCH /api/v1/notifications/:id/read`
- `GET /api/v1/email-outbox?status=...&programId=...&companyId=...`
- `PATCH /api/v1/reports/:id/status`
- `GET /api/v1/reports/:id/status-history`
- `GET /api/v1/analytics/config`
- `GET /api/v1/analytics/overview?program=...&programId=...&province=...&period=...&scope=approved|all`
- `GET /api/v1/forms?programId=...`
- `POST /api/v1/form-submissions`
- `GET /api/v1/concept-papers?programId=...`
- `GET /api/v1/concept-papers/:id/file`
- `GET /api/v1/program-manuals?program=...&year=...&companyId=...`
- `POST /api/v1/program-manuals`
- `GET /api/v1/program-manuals/:id/file`
- `GET /api/v1/actions`
- `POST /api/v1/actions`

## Convenciones

- Todas las respuestas devuelven JSON.
- Los identificadores son strings estables.
- Fechas en formato ISO 8601.
- Los errores usan `{ "error": "mensaje", "details": {} }`.
- El backend valida permisos segun rol antes de modificar datos.
- Los archivos cargados en reportes, Concept Papers y manuales permiten hasta 200 MB por archivo.
- La analitica ejecutiva debe usar por defecto `scope=approved`.
- La vista operativa puede usar `scope=all`, pero debe marcar que incluye datos no aprobados.
- El backend habilita CORS para desarrollo local entre frontend y API.

## Payload sugerido para crear un reporte

## Payload sugerido para crear un programa

`POST /api/v1/programs`

```json
{
  "name": "Programa ejemplo",
  "lead": "Coordinacion del programa",
  "coordinatorEmail": "coordinacion@empresa.org",
  "programManagerEmail": "pm@empresa.org",
  "melSupervisorEmail": "supervision-me@empresa.org",
  "provinces": ["Centros de programa"],
  "beneficiaries": 250,
  "budget": "US$ 10,000",
  "focus": "Descripcion operativa del programa",
  "primaryPopulation": "Participantes y familias"
}
```

## Payload sugerido para crear un indicador

`POST /api/v1/indicators`

```json
{
  "program": "Programa ejemplo",
  "programId": "prog-programa-ejemplo",
  "name": "Participantes completan el ciclo",
  "target": 200,
  "unit": "personas",
  "owner": "Equipo M&E",
  "due": "2026-12",
  "type": "Logro"
}
```

## Payload sugerido para cargar un manual de programa

`POST /api/v1/program-manuals`

```json
{
  "companyId": "org-default",
  "program": "CFI",
  "title": "Manual operativo CFI",
  "fileName": "manual-cfi.pdf",
  "dataUrl": "data:application/pdf;base64,...",
  "mimeType": "application/pdf",
  "year": "2026",
  "version": "1.0",
  "notes": "Manual vigente del programa",
  "actorRole": "Supervision M&E"
}
```

El backend valida que el archivo sea PDF y que la carga venga de un rol administrativo autorizado.

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
  "status": "Pendiente coordinacion"
}
```

## Payload sugerido para validar reportes

## Respuesta sugerida para alertas internas

`GET /api/v1/notifications`

```json
{
  "data": [
    {
      "id": "notif-1714743453000",
      "companyId": "org-default",
      "programId": "prog-girls-empowerment",
      "reportId": "rep-1714743453000",
      "recipientRole": "Coordinador de programa",
      "type": "report_review_requested",
      "priority": "high",
      "title": "Reporte pendiente: Girls Empowerment",
      "status": "unread"
    }
  ]
}
```

## Respuesta sugerida para correos en cola

`GET /api/v1/email-outbox`

```json
{
  "data": [
    {
      "id": "email-1714743453000",
      "toRole": "Coordinador de programa",
      "toEmail": "coordinacion@empresa.org",
      "subject": "Nuevo reporte pendiente de aprobacion - Girls Empowerment",
      "status": "queued"
    }
  ]
}
```

`PATCH /api/v1/reports/:id/status`

```json
{
  "status": "Pendiente Program Manager",
  "actorId": "usr-coordinacion",
  "actorRole": "Coordinador de programa",
  "note": "Revision operativa completada y enviada al siguiente nivel."
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
