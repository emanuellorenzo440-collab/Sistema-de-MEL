# Handoff

## Estado actual

Sistema de MEL tiene una base organizada para crecer como producto completo:

- Frontend funcional en frontend/.
- Backend con reglas reales de reportes, revision y analitica en backend/.
- Esquema de base de datos en database/.
- Contratos compartidos en shared/.
- Documentacion de arquitectura, producto, negocio, UX y responsividad en docs/.
- Graficas del frontend con selector de visualizacion por indicador y por periodo.
- Analitica ejecutiva definida por defecto sobre reportes aprobados.
- El frontend ya puede sincronizar reportes y decisiones de revision con la API cuando esta disponible.
- El frontend ya puede cargar, crear, editar y eliminar programas e indicadores usando la API cuando esta disponible.
- Cuando entra un reporte nuevo, el backend inicia una cadena de aprobacion: Coordinador de programa, luego Program Manager, luego Supervision M&E.
- Cada etapa genera su alerta interna y su correo en outbox para el siguiente aprobador.
- El frontend muestra una bandeja de alertas internas para Coordinador de programa, Program Manager y Supervision M&E.
- La vista de graficas ya consume el endpoint `analytics/overview` para pintar metricas, comparativas, tendencia y recomendaciones.

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
- http://localhost:8080/api/v1/programs
- http://localhost:8080/api/v1/indicators
- http://localhost:8080/api/v1/reports
- http://localhost:8080/api/v1/notifications
- http://localhost:8080/api/v1/email-outbox
- http://localhost:8080/api/v1/analytics/overview

## Como conectar frontend y backend

- Si el frontend corre en local, usa por defecto `http://127.0.0.1:8080/api/v1`.
- Si el frontend corre en otro entorno, puede recibir `?apiBase=...` en la URL.
- Cuando la API esta disponible, la interfaz arranca con programas, indicadores, reportes y alertas remotas, empuja nuevos reportes, importaciones y revisiones al backend y pinta la lectura analitica desde el overview remoto.

## Como validar sintaxis

```bash
node --check frontend/src/main.js
node --check frontend/src/features/monitoring-app.js
node --check frontend/src/services/mel-api.js
node --check frontend/src/services/mel-runtime-bridge.js
node --check backend/src/data/mock-store.js
node --check backend/src/domain/reporting-rules.js
node --check backend/src/services/analytics-service.js
node --check backend/src/server.js
```

## Siguientes pasos recomendados

1. Persistir programas, indicadores, reportes, notificaciones, outbox de correo, historial de revision y acciones en una base de datos real.
2. Agregar autenticacion y roles con identidad real de usuario.
3. Crear pruebas de integracion para importacion CSV, aprobacion y analitica aprobada.
4. Revisar la experiencia movil pantalla por pantalla.
5. Definir politica de reapertura o edicion de reportes ya aprobados.
6. Unificar tambien el dashboard inicial con datos calculados desde API para evitar lecturas paralelas.

## Riesgos conocidos

- La persistencia del backend actual es en memoria.
- El CRUD de programas e indicadores ya existe en API, pero todavia no persiste despues de reiniciar el proceso backend.
- Los correos quedan en outbox; falta conectar un proveedor real como SMTP, SendGrid, Microsoft Graph o Gmail API.
- El frontend aun conserva fallback local para la cadena de aprobacion cuando no hay API, pero la fuente final de verdad debe ser el backend.
- El esquema SQL todavia no tiene migrador automatizado.
- Falta una capa de autenticacion real para reemplazar actorId manual.
- El dashboard principal todavia conserva logica local en algunas tarjetas, aunque la vista analitica ya sale de la API.

## Regla para continuar

Cada nueva funcionalidad debe actualizar documentacion, logica de negocio, UX si aplica y handoff si cambia como usar o correr el proyecto.

Los pedidos del usuario deben traducirse desde experiencia deseada hacia una solucion tecnica completa. Si aparece una alternativa mejor para producto, negocio o mantenibilidad, debe proponerse antes de consolidar la implementacion.
