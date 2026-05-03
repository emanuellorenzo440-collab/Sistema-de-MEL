# Arquitectura

Sistema de MEL queda organizado como una aplicacion por capas. Hoy el frontend funciona de forma local, pero la estructura ya separa responsabilidades para crecer hacia una plataforma con API, base de datos, autenticacion y reporteria avanzada.

## Capas

### Frontend

Ubicacion: `frontend/`

Responsabilidades:

- Interfaz de usuario.
- Captura de reportes y formularios.
- Visualizacion de indicadores y graficas.
- Validaciones basicas de experiencia.
- Consumo futuro de la API.

Archivos clave:

- `frontend/index.html`
- `frontend/styles.css`
- `frontend/src/main.js`
- `frontend/src/features/monitoring-app.js`
- `frontend/src/core/`
- `frontend/src/data/`
- `frontend/src/shared/`

### Backend

Ubicacion: `backend/`

Responsabilidades:

- Autenticacion y roles.
- API REST versionada.
- Validacion de reglas de negocio.
- Lectura/escritura en base de datos.
- Procesamiento de importaciones.
- Auditoria de cambios.

Base inicial:

- `backend/src/server.js` expone `GET /health` y `GET /api/v1`.

### Database

Ubicacion: `database/`

Responsabilidades:

- Persistir usuarios, programas, indicadores, reportes, formularios, importaciones, concept papers y acciones.
- Mantener integridad referencial.
- Soportar auditoria y trazabilidad.

Archivo clave:

- `database/schema.sql`

Motor recomendado: PostgreSQL. Durante prototipos se puede adaptar a SQLite.

### Shared

Ubicacion: `shared/`

Responsabilidades:

- Contratos API.
- Esquemas compartidos.
- Estados y enums comunes.

Archivo clave:

- `shared/contracts/api.md`

## Flujo de datos objetivo

`frontend -> backend API -> database`

El frontend nunca debe escribir directo en la base de datos. El backend debe validar permisos, formato, estados y reglas antes de persistir.

## Modulos de dominio sugeridos

Cuando la app crezca, separar por dominio:

- `programs`
- `indicators`
- `reports`
- `forms`
- `submissions`
- `concept-papers`
- `supervision`
- `actions`
- `users`
- `audit`

## Reglas para crecer

1. Cada feature grande debe vivir en su propia carpeta.
2. Las reglas de negocio criticas pertenecen al backend, no al frontend.
3. Los datos largos o catalogos deben ir en `data` o en base de datos, no mezclados con vistas.
4. Los contratos compartidos deben actualizarse antes de cambiar frontend y backend.
5. Toda escritura importante debe generar auditoria.
6. El estado local del navegador es solo temporal; la fuente final de verdad debe ser la base de datos.

## Proximo salto tecnico

Cuando el proyecto requiera autenticacion real y despliegue, la ruta recomendada es:

- Frontend: Vite + modulos por feature.
- Backend: Node.js con Express/Fastify o NestJS.
- Database: PostgreSQL con migraciones.
- Validacion: esquemas compartidos entre API y frontend.
- Archivos: almacenamiento externo para evidencias y concept papers.
