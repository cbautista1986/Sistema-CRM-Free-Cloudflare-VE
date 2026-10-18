# Sistema de Facturación Service-First — Fase 1

Cloudflare Workers + Hono + D1. Todo funciona en el plan gratis de Cloudflare.

**Incluye:** instalador de una sola vez, login seguro (contraseña con PBKDF2, sesión con cookie protegida,
bloqueo tras 5 intentos), inicio estilo Pixel con tasa BCV, ajustes del negocio y datos de cobro.

## Dónde editar cada cosa
- `public/` → lo que ve el usuario (`index.html`, `estilos.css`, `app.js`). Sin compilar: edita y sube.
- `src/index.ts` → la API (`/api/...`). `src/seguridad.ts` → contraseñas y sesiones.
- `src/migraciones.ts` → cambios de la base de datos. **Agrega una migración nueva al final; nunca edites las anteriores.**
  Se aplican solas la primera vez que alguien entra.

## Subirlo a Cloudflare sin consola
1. Descomprime el .zip. En tu repositorio de GitHub: Add file → Upload files, y arrastra **el contenido** de la carpeta
   (`src`, `public`, `wrangler.toml`, `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `.gitignore`).
   **No subas el .zip**: GitHub no lo abre y Cloudflare necesita ver `wrangler.toml` en la raíz del repositorio.
2. Cloudflare → Workers y Pages → «Import a repository» → elige el repositorio. El nombre del Worker debe ser igual a
   la línea `name` de `wrangler.toml` (aquí: `sistema-crm-free-cloudflare-ve`); si usas otro nombre, cambia esa línea.
3. Abre la dirección `.workers.dev` que te da Cloudflare: aparece el instalador.

## Probar en tu PC (opcional)
`npm install` y luego `npm run dev` (abre http://127.0.0.1:8787). No pegues nada en la consola mientras corre el servidor.
