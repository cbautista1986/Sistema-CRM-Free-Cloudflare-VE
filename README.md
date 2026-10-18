# Sistema de Facturación Service-First

Cloudflare Workers + Hono + D1. Todo funciona en el plan gratis de Cloudflare.

**Fase 1:** instalador de una sola vez, login seguro, inicio con tasa BCV, ajustes y datos de cobro.
**Fase 2:** clientes (con búsqueda y botón de WhatsApp) y catálogo de servicios y productos (precio, costo privado, IVA).

## Dónde editar cada cosa (un módulo = un archivo de pantallas + uno de API)
| Módulo | Pantallas (`public/`) | API (`src/rutas/`) |
|---|---|---|
| Entrada, inicio, ajustes | `app.js` | `src/index.ts` |
| Clientes | `clientes.js` | `clientes.ts` |
| Catálogo | `catalogo.js` | `catalogo.ts` |

- `public/comun.js` y `src/comun.ts` → piezas compartidas. `public/estilos.css` → colores y estilos.
- `src/seguridad.ts` → contraseñas y sesiones.
- `src/migraciones.ts` → cambios de la base de datos. **Agrega una migración nueva al final; nunca edites las anteriores.**
  Se aplican solas la primera vez que alguien entra. El dinero siempre va en centavos enteros.

## Actualizar el sistema sin borrar nada
En GitHub: Add file → Upload files y arrastra los archivos nuevos. GitHub reemplaza los que tienen el mismo nombre y
agrega los nuevos; **no borra** los que no subes. Cloudflare vuelve a desplegar solo en un par de minutos.

## Probar en tu PC (opcional)
`npm install` y luego `npm run dev` (http://127.0.0.1:8787). No pegues nada en la consola mientras corre el servidor.
