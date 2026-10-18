// Cambios de la base de datos. Regla de oro: para cambiar algo, AGREGA una migración nueva al final;
// nunca edites las anteriores. Se aplican solas, una sola vez, en orden (no hace falta consola).
export const MIGRACIONES: { id: string; sql: string[] }[] = [
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
];

export async function migrar(db: D1Database) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS _migraciones (id TEXT PRIMARY KEY, aplicada_en TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
  const { results } = await db.prepare(`SELECT id FROM _migraciones`).all<{ id: string }>();
  const hechas = new Set(results.map((r) => r.id));
  for (const m of MIGRACIONES) {
    if (hechas.has(m.id)) continue;
    // batch = todo o nada: si algo falla, la migración no queda a medias
    await db.batch([...m.sql.map((s) => db.prepare(s)), db.prepare(`INSERT INTO _migraciones (id) VALUES (?)`).bind(m.id)]);
  }
}
