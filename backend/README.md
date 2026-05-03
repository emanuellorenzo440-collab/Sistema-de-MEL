# Backend

Capa de API para Sistema de MEL. Por ahora queda como base minima sin dependencias externas; cuando el proyecto crezca puede migrar a Express, Fastify o NestJS sin cambiar los contratos principales.

## Responsabilidades

- Autenticacion y roles.
- API REST para programas, indicadores, reportes, formularios, concept papers y planes de accion.
- Validacion de datos antes de escribir en base de datos.
- Integraciones futuras: almacenamiento de archivos, correo, dashboards externos y auditoria.

## Ejecutar

```bash
node backend/src/server.js
```

Endpoints iniciales:

- `GET /health`
- `GET /api/v1`
