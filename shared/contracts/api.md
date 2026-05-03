# Contrato API v1

Base propuesta para conectar frontend, backend y base de datos.

## Recursos

- `GET /api/v1/programs`
- `GET /api/v1/indicators?programId=...`
- `POST /api/v1/reports`
- `PATCH /api/v1/reports/:id/status`
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
