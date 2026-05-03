# Sistema de MEL

Aplicacion web para organizar monitoreo, evaluacion, indicadores, reportes, concept papers, graficas y formularios descargables.

El proyecto queda preparado como una solucion completa con frontend, backend, base de datos y contratos compartidos.

## Estructura principal

- `frontend/`: interfaz web actual.
- `backend/`: base de API para futuras operaciones del servidor.
- `database/`: esquema inicial de base de datos.
- `shared/`: contratos entre frontend y backend.
- `docs/`: decisiones y guia de arquitectura.

## Abrir el frontend

Como la app usa modulos modernos de JavaScript, abre el proyecto con un servidor local:

```bash
npm start
```

Si no tienes npm disponible, usa:

```bash
python3 -m http.server 4173 --directory frontend
```

Luego entra a:

```text
http://localhost:4173
```

## Backend inicial

```bash
node backend/src/server.js
```

Endpoints disponibles como base:

- `GET /health`
- `GET /api/v1`

## Base de datos

El esquema inicial esta en `database/schema.sql`. La direccion recomendada para produccion es PostgreSQL, con el frontend consumiendo datos solo a traves del backend.

## Flujo de formularios

1. Entra a `Formularios`.
2. Descarga una plantilla CSV, Word o PDF.
3. Llena las columnas de recoleccion de datos.
4. Sube el CSV completado en `Subir formularios completados`.
5. Revisa las graficas automaticas en `Graficas`.

## Documentacion viva

- `docs/PRODUCT_BRIEF.md`: vision del producto y usuarios.
- `docs/BUSINESS_LOGIC.md`: logica de negocio, entidades, permisos y flujos.
- `docs/UX_UI_GUIDELINES.md`: experiencia de usuario e interfaz.
- `docs/RESPONSIVE_STRATEGY.md`: reglas para celular, tablet y escritorio.
- `docs/ARCHITECTURE.md`: arquitectura frontend, backend, database y shared.
- `docs/DOCUMENTATION_PROCESS.md`: como documentar cada cambio.
- `docs/DECISIONS.md`: decisiones importantes.
- `docs/WORKLOG.md`: historial de pedidos y cambios.
- `docs/HANDOFF.md`: estado actual y como continuar.
