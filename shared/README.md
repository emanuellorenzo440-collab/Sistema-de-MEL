# Shared

Carpeta para contratos y esquemas compartidos entre frontend y backend.

Aqui deben vivir documentos o tipos que ambos lados necesiten entender, por ejemplo contratos API, enums de roles, estados de reportes, alcances de analitica y modelos compartidos.

## Contratos actuales

- `contracts/api.md`: endpoints y respuestas base de la API.
- `contracts/reporting.js`: estados de reportes, alcances analiticos y reglas reutilizables.

## Regla clave

Toda regla importante que afecte a frontend y backend a la vez debe pasar por esta carpeta antes de crecer en cada lado por separado.
