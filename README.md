# Sistema de Facturación Service-First

Cloudflare Workers + Hono + D1. Todo funciona en el plan gratis de Cloudflare.

- **Fase 1:** instalador de una sola vez, login seguro, inicio con tasa BCV, ajustes y datos de cobro.
- **Fase 2:** clientes (WhatsApp ordenado solo) e inventario de productos y servicios.
- **Fase 3:** presupuestos y facturas (IVA, tasa BCV, correlativos, PDF, anulación), modo práctica y respaldo.

## Dónde editar cada cosa (un módulo = pantallas en `public/` + API en `src/rutas/`)
| Módulo | Pantallas | API |
|---|---|---|
| Entrada, inicio, ajustes | `app.js` | `src/index.ts` |
| Clientes | `clientes.js` | `clientes.ts` |
| Inventario (productos y servicios) | `catalogo.js` | `catalogo.ts` |
| Factura (presupuestos y facturas) | `factura.js`, `pdf.js` | `documentos.ts` |
| Modo práctica y respaldo | `app.js` (Ajustes) | `sistema.ts` |

- `public/dinero.js` → **toda** la matemática del dinero; la usan el servidor y el navegador (una sola fuente de verdad).
- `public/comun.js` y `src/comun.ts` → piezas compartidas. `public/estilos.css` → colores y estilos.
- `public/vendor/` → librería de PDF (pdf-lib, MIT) incluida a propósito, sin depender de internet. Ver `LEEME.txt`.
- `src/seguridad.ts` → contraseñas y sesiones.

## Reglas que NO se deben romper (es contabilidad de personas)
1. El dinero va en **centavos enteros**, nunca decimales. No hagas cuentas de dinero fuera de `dinero.js`.
2. Una factura emitida **no se edita ni se borra**: solo se anula, con motivo. La base de datos lo impide con triggers (modo REAL).
3. Los correlativos se suman **dentro de la misma transacción** que emite el documento; un número anulado no se reutiliza.
4. Las reglas fiscales son **datos**, no código: tabla `parametros_fiscales` (IVA permitido, leyendas del PDF, días de validez,
   tope de renglones...) con fecha de vigencia. Si la ley cambia, se agrega una migración con filas nuevas
   (`vigente_desde` = fecha del cambio). Cada documento guarda las reglas que usó, así el historial no se altera.
5. Cambios en la base de datos: **migración nueva al final** de `src/migraciones.ts`; nunca edites una ya desplegada.

## Modo práctica → modo real
El sistema arranca en **modo práctica**: los documentos llevan marca de agua, no valen y tienen numeración aparte.
Cuando todo esté probado y revisado con tu contador: Ajustes → «Salir en vivo». Se borran los documentos de práctica,
eliges con qué número empiezan la factura, el control interno y el presupuesto, y no se puede volver atrás.

## N.º de control
El N.º de control **fiscal** lo asigna una imprenta digital autorizada: por ahora queda vacío y el PDF lo avisa.
El «control interno» es solo un correlativo propio. Cuando se conecte la imprenta, ese dato se guarda en `control_fiscal`.

## Respaldo
Ajustes → «Exportar respaldo» descarga todos los datos (sin contraseñas). Guárdalo fuera del sistema.

## Actualizar sin borrar nada
En GitHub: Add file → Upload files y arrastra el contenido del proyecto (las carpetas `src` y `public` y los archivos de la raíz).
GitHub reemplaza lo que tiene el mismo nombre y agrega lo nuevo; no borra nada. Cloudflare vuelve a desplegar solo.

## Probar en tu PC (opcional)
`npm install` y luego `npm run dev` (http://127.0.0.1:8787). No pegues nada en la consola mientras corre el servidor.
