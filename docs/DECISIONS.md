# Decisiones

## 2026-05-03 - Separacion por capas

Decision: organizar el proyecto en frontend, backend, database, shared y docs.

Razon: el sistema debe crecer como una plataforma completa, no como una sola pagina estatica dificil de mantener.

Impacto:

- El frontend queda aislado en frontend/.
- El backend tiene una base inicial en backend/.
- La base de datos tiene un esquema inicial en database/.
- Los contratos viven en shared/.

## 2026-05-03 - El usuario define experiencia, Codex define logica

Decision: los pedidos del usuario se tratan como intencion de experiencia y producto. Codex traduce esa intencion a logica de negocio, UX/UI, arquitectura, responsividad y documentacion.

Razon: permite que el usuario describa como debe sentirse el sistema sin tener que disenar todos los detalles tecnicos.

Impacto:

- Cada cambio debe considerar producto completo.
- La documentacion debe mantenerse al dia.
- Las decisiones tecnicas deben proteger escalabilidad futura.

## 2026-05-03 - Excelencia sobre prisa

Decision: el proyecto debe optimizarse para calidad de producto, claridad de experiencia y solidez de negocio aunque tome mas tiempo llegar a la version final.

Razon: un sistema de MEL util para usuarios reales necesita confianza, consistencia, buena experiencia movil y reglas de negocio bien pensadas; acelerar sin ese cuidado produciria deuda y frustracion.

Impacto:

- Se permiten iteraciones mas profundas si mejoran el sistema.
- Codex debe proponer mejoras cuando detecte una opcion claramente superior.
- Cada cambio debe evaluarse por impacto en usuario, negocio y continuidad tecnica.

## 2026-05-03 - Analitica ejecutiva basada en reportes aprobados

Decision: la seccion de graficas y analitica debe poder cambiar entre todos los reportes visibles y solo reportes aprobados, pero la base recomendada y predeterminada para lectura ejecutiva sera solo aprobados.

Razon: evita mezclar datos pendientes con lectura de direccion y mejora la confianza del analisis automatico y del bot analista.

Impacto:

- La analitica puede usarse tanto en operacion como en supervision ejecutiva.
- El usuario mantiene control del alcance del analisis sin perder claridad.
- Las metricas y recomendaciones reflejan mejor datos validados.

## 2026-05-03 - La API manda cuando esta disponible

Decision: el frontend debe poder trabajar en modo local para prototipo, pero cuando exista API disponible debe leer reportes, analitica y decisiones de revision desde backend.

Razon: evita duplicar logica critica y prepara el sistema para una futura persistencia real sin rehacer la experiencia.

Impacto:

- El frontend necesita un cliente compartido para la API.
- La API debe exponer filtros, revision y analitica con el mismo lenguaje del frontend.
- El modo local queda como respaldo, no como destino final.

## 2026-05-03 - Toda revision de reportes deja trazabilidad

Decision: aprobar, devolver o rechazar un reporte debe guardar actor, rol, observacion y fecha en historial.

Razon: la confianza del sistema depende de poder explicar por que un dato entro a lectura ejecutiva y quien tomo esa decision.

Impacto:

- Se agrega historial de estados en backend y base de datos.
- actorId pasa a ser obligatorio en cambios de estado.
- Las futuras auditorias y reportes de calidad de datos quedan mucho mejor soportados.
