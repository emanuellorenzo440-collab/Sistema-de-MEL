# Handoff

## Estado actual

Sistema de MEL tiene una base organizada para crecer como producto completo:

- Frontend funcional en frontend/.
- Backend base en backend/.
- Esquema de base de datos en database/.
- Contratos compartidos en shared/.
- Documentacion de arquitectura, producto, negocio, UX y responsividad en docs/.
- Graficas del frontend con selector de visualizacion por indicador y por periodo.

## Como ejecutar frontend

Con npm:

```bash
npm start
```

Sin npm:

```bash
python3 -m http.server 4173 --directory frontend
```

Abrir:

```text
http://localhost:4173
```

## Como ejecutar backend

```bash
node backend/src/server.js
```

Endpoints iniciales:

- http://localhost:8080/health
- http://localhost:8080/api/v1

## Como validar sintaxis

```bash
node --check frontend/src/main.js
node --check frontend/src/features/monitoring-app.js
node --check backend/src/server.js
```

## Siguientes pasos recomendados

1. Convertir reglas de permisos en funciones reales del backend.
2. Crear endpoints CRUD para programas, indicadores y reportes.
3. Conectar frontend con API en vez de depender solo de localStorage.
4. Definir migraciones reales para PostgreSQL.
5. Agregar autenticacion y roles.
6. Revisar la experiencia movil pantalla por pantalla.
7. Crear pruebas basicas de importacion CSV y validacion de reportes.
8. Llevar la misma regla de analitica aprobada al backend y futuros dashboards conectados a API.

## Riesgos conocidos

- El frontend todavia usa localStorage como persistencia temporal.
- La API es una base inicial, no una API completa.
- El esquema SQL todavia no tiene migrador automatizado.
- Falta consolidar esta misma regla de analitica en backend cuando el frontend deje de depender de localStorage.

## Regla para continuar

Cada nueva funcionalidad debe actualizar documentacion, logica de negocio, UX si aplica y handoff si cambia como usar o correr el proyecto.

Los pedidos del usuario deben traducirse desde experiencia deseada hacia una solucion tecnica completa. Si aparece una alternativa mejor para producto, negocio o mantenibilidad, debe proponerse antes de consolidar la implementacion.

