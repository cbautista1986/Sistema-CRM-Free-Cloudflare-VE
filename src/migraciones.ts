// Cambios de la base de datos. Regla de oro: para cambiar algo, AGREGA una migración nueva al final;
// nunca edites las anteriores. Se aplican solas, una sola vez, en orden (no hace falta consola).
type Migracion = { id: string; sql: string[]; antes?: (db: D1Database) => Promise<void> };

// El catálogo viejo estaba vacío y guardaba el dinero como decimales. Si por algún motivo tuviera datos, NO se recrea.
async function protegerCatalogoViejo(db: D1Database) {
  const existe = await db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'catalogo'`).first();
  if (!existe) return;
  const fila = await db.prepare(`SELECT COUNT(*) AS n FROM catalogo`).first<{ n: number }>();
  if (fila && fila.n > 0) throw new Error("El catálogo viejo tiene datos: no se recrea automáticamente.");
}

export const MIGRACIONES: Migracion[] = [
  {
    id: "0001_base",
    sql: [
      `CREATE TABLE IF NOT EXISTS perfil_emisor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        instalado INTEGER NOT NULL DEFAULT 0,
        especialidad TEXT NOT NULL DEFAULT 'SERVICIOS_EQUIPOS',
        nombre_razon_social TEXT NOT NULL,
        rif TEXT NOT NULL,
        direccion_fiscal TEXT NOT NULL,
        telefono TEXT, email TEXT, logo_base64 TEXT,
        tasa_bcv REAL NOT NULL DEFAULT 0,
        datos_pago_movil TEXT, datos_zelle TEXT, datos_binance TEXT, datos_paypal TEXT, datos_transferencia TEXT,
        prox_presupuesto INTEGER NOT NULL DEFAULT 1,
        prox_factura INTEGER NOT NULL DEFAULT 1,
        prox_nota_credito INTEGER NOT NULL DEFAULT 1)`,
      `CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        rol TEXT NOT NULL DEFAULT 'ADMIN',
        creado_en TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS sesiones (
        token_hash TEXT PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        expira_en INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS intentos_login (
        clave TEXT PRIMARY KEY,
        fallos INTEGER NOT NULL DEFAULT 0,
        bloqueado_hasta INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER, accion TEXT NOT NULL, detalle TEXT, ip TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')))`,
    ],
  },
  {
    id: "0002_fecha_tasa_bcv",
    sql: [`ALTER TABLE perfil_emisor ADD COLUMN tasa_bcv_fecha TEXT`],
  },
  {
    id: "0003_clientes_catalogo",
    antes: protegerCatalogoViejo,
    sql: [
      `CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rif_cedula TEXT NOT NULL UNIQUE,
        nombre_apellido TEXT NOT NULL,
        direccion TEXT, whatsapp TEXT, email TEXT,
        creado_en TEXT DEFAULT (datetime('now')))`,
      `DROP TABLE IF EXISTS catalogo`,
      // Dinero en centavos de USD (enteros). precio_centavos NULL = "se define al facturar" (solo servicios).
      `CREATE TABLE catalogo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'SERVICIO' CHECK (tipo IN ('SERVICIO', 'PRODUCTO')),
        costo_centavos INTEGER CHECK (costo_centavos IS NULL OR costo_centavos >= 0),
        precio_centavos INTEGER CHECK (precio_centavos IS NULL OR precio_centavos >= 0),
        alicuota_iva INTEGER NOT NULL DEFAULT 16 CHECK (alicuota_iva IN (0, 8, 16)),
        activo INTEGER NOT NULL DEFAULT 1)`,
      `CREATE UNIQUE INDEX idx_catalogo_codigo ON catalogo(codigo) WHERE codigo IS NOT NULL`,
    ],
  },
];

export async function migrar(db: D1Database) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS _migraciones (id TEXT PRIMARY KEY, aplicada_en TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
  const { results } = await db.prepare(`SELECT id FROM _migraciones`).all<{ id: string }>();
  const hechas = new Set(results.map((r) => r.id));
  for (const m of MIGRACIONES) {
    if (hechas.has(m.id)) continue;
    await m.antes?.(db);
    // batch = todo o nada: si algo falla, la migración no queda a medias
    await db.batch([...m.sql.map((s) => db.prepare(s)), db.prepare(`INSERT INTO _migraciones (id) VALUES (?)`).bind(m.id)]);
  }
}
