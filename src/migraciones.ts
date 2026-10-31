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

// Las tablas viejas de documentos (de Gemini) estaban vacías y guardaban dinero como decimales. Si tuvieran datos, NO se recrean.
async function protegerDocumentosViejos(db: D1Database) {
  for (const t of ["documentos", "documento_renglones", "documento_pagos"]) {
    const existe = await db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(t).first();
    if (!existe) continue;
    const fila = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
    if (fila && fila.n > 0) throw new Error(`La tabla vieja ${t} tiene datos: no se recrea automáticamente.`);
  }
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
  {
    id: "0004_documentos",
    antes: protegerDocumentosViejos,
    sql: [
      `DROP TABLE IF EXISTS documento_pagos`,
      `DROP TABLE IF EXISTS documento_renglones`,
      `DROP TABLE IF EXISTS documentos`,
      // Modo de trabajo: PRACTICA (documentos de prueba) o REAL. Se sale de práctica una sola vez.
      `CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
      `INSERT INTO ajustes (clave, valor) VALUES ('modo', 'PRACTICA')`,
      // Correlativos: se suman dentro de la misma transacción que emite el documento (sin saltos ni repetidos).
      `CREATE TABLE contadores (clave TEXT PRIMARY KEY, valor INTEGER NOT NULL DEFAULT 0)`,
      `INSERT INTO contadores (clave) VALUES ('FACTURA:PRACTICA'), ('PRESUPUESTO:PRACTICA'), ('CONTROL:PRACTICA'),
        ('FACTURA:REAL'), ('PRESUPUESTO:REAL'), ('CONTROL:REAL')`,
      // Reglas fiscales como DATOS con fecha de vigencia: si la ley cambia, se agrega una fila (no se toca el código ni el historial).
      `CREATE TABLE parametros_fiscales (clave TEXT NOT NULL, vigente_desde TEXT NOT NULL, valor TEXT NOT NULL, nota TEXT,
        PRIMARY KEY (clave, vigente_desde))`,
      `INSERT INTO parametros_fiscales (clave, vigente_desde, valor, nota) VALUES
        ('iva_alicuotas_cent', '2000-01-01', '0,800,1600', 'Alícuotas de IVA permitidas (% x 100): exento, 8% y 16%'),
        ('titulo_sin_control', '2000-01-01', 'FACTURA', 'Título del PDF mientras no exista N.º de control fiscal (decisión del dueño)'),
        ('leyenda_sin_control', '2000-01-01', 'DOCUMENTO SIN NÚMERO DE CONTROL FISCAL (pendiente de imprenta digital autorizada)', 'Aviso visible en el PDF'),
        ('leyenda_cambio', '2000-01-01', 'Montos expresados en bolívares (Bs.) con su equivalente en dólares (USD) a la tasa de cambio BCV vigente a la fecha de emisión.', 'Confirmar texto con el contador'),
        ('validez_presupuesto_dias', '2000-01-01', '15', 'Días de validez de un presupuesto'),
        ('plantilla_version', '2000-01-01', '1', 'Versión de la plantilla del PDF'),
        ('max_renglones', '2000-01-01', '30', 'Máximo de renglones por documento (cuida el límite de consultas del plan gratis de Cloudflare)')`,
      `CREATE TABLE documentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK (tipo IN ('PRESUPUESTO', 'FACTURA')),
        estado TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'EMITIDO', 'FACTURADO', 'ANULADO')),
        modo TEXT NOT NULL CHECK (modo IN ('PRACTICA', 'REAL')),
        numero INTEGER, control_interno INTEGER, control_fiscal TEXT,
        presupuesto_id INTEGER REFERENCES documentos(id),
        cliente_id INTEGER REFERENCES clientes(id),
        cliente_rif TEXT, cliente_nombre TEXT, cliente_direccion TEXT, cliente_whatsapp TEXT, cliente_email TEXT,
        nota TEXT,
        fecha_emision TEXT, emitido_en TEXT,
        tasa_e8 INTEGER, tasa_cargada_en TEXT,
        subtotal_usd INTEGER, iva_usd INTEGER, total_usd INTEGER,
        subtotal_bs INTEGER, iva_bs INTEGER, total_bs INTEGER,
        costo_total_usd INTEGER,
        parametros_json TEXT, emisor_json TEXT,
        anulado_en TEXT, anulado_por INTEGER, motivo_anulacion TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')), creado_por INTEGER)`,
      `CREATE UNIQUE INDEX idx_doc_numero ON documentos(tipo, modo, numero) WHERE numero IS NOT NULL`,
      `CREATE UNIQUE INDEX idx_doc_control ON documentos(modo, control_interno) WHERE control_interno IS NOT NULL`,
      `CREATE TABLE documento_renglones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        documento_id INTEGER NOT NULL REFERENCES documentos(id),
        orden INTEGER NOT NULL,
        catalogo_id INTEGER REFERENCES catalogo(id),
        tipo TEXT NOT NULL CHECK (tipo IN ('SERVICIO', 'PRODUCTO')),
        descripcion TEXT NOT NULL,
        cantidad_milli INTEGER NOT NULL CHECK (cantidad_milli > 0),
        precio_usd INTEGER NOT NULL CHECK (precio_usd >= 0),
        costo_usd INTEGER,
        alicuota_cent INTEGER NOT NULL,
        monto_usd INTEGER NOT NULL,
        monto_bs INTEGER)`,
      `CREATE TABLE documento_impuestos (
        documento_id INTEGER NOT NULL REFERENCES documentos(id),
        alicuota_cent INTEGER NOT NULL,
        base_usd INTEGER NOT NULL, iva_usd INTEGER NOT NULL, base_bs INTEGER NOT NULL, iva_bs INTEGER NOT NULL,
        PRIMARY KEY (documento_id, alicuota_cent))`,
      // ---- Protecciones DENTRO de la base de datos (valen aunque la aplicación tenga un error). Solo documentos REALES.
      `CREATE TRIGGER doc_no_borrar BEFORE DELETE ON documentos
        WHEN old.modo = 'REAL' AND old.estado <> 'BORRADOR'
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: no se puede borrar, solo anular.'); END`,
      `CREATE TRIGGER doc_inmutable BEFORE UPDATE ON documentos
        WHEN old.modo = 'REAL' AND old.estado <> 'BORRADOR' AND (
          old.estado = 'ANULADO'
          OR new.estado NOT IN ('EMITIDO', 'FACTURADO', 'ANULADO')
          OR (old.estado = 'FACTURADO' AND new.estado <> 'FACTURADO')
          OR new.tipo IS NOT old.tipo
  OR new.modo IS NOT old.modo
  OR new.numero IS NOT old.numero
  OR new.control_interno IS NOT old.control_interno
  OR new.presupuesto_id IS NOT old.presupuesto_id
  OR new.cliente_id IS NOT old.cliente_id
  OR new.cliente_rif IS NOT old.cliente_rif
  OR new.cliente_nombre IS NOT old.cliente_nombre
  OR new.cliente_direccion IS NOT old.cliente_direccion
  OR new.cliente_whatsapp IS NOT old.cliente_whatsapp
  OR new.cliente_email IS NOT old.cliente_email
  OR new.nota IS NOT old.nota
  OR new.fecha_emision IS NOT old.fecha_emision
  OR new.emitido_en IS NOT old.emitido_en
  OR new.tasa_e8 IS NOT old.tasa_e8
  OR new.tasa_cargada_en IS NOT old.tasa_cargada_en
  OR new.subtotal_usd IS NOT old.subtotal_usd
  OR new.iva_usd IS NOT old.iva_usd
  OR new.total_usd IS NOT old.total_usd
  OR new.subtotal_bs IS NOT old.subtotal_bs
  OR new.iva_bs IS NOT old.iva_bs
  OR new.total_bs IS NOT old.total_bs
  OR new.costo_total_usd IS NOT old.costo_total_usd
  OR new.parametros_json IS NOT old.parametros_json
  OR new.emisor_json IS NOT old.emisor_json
  OR new.creado_en IS NOT old.creado_en
  OR new.creado_por IS NOT old.creado_por)
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: no se puede modificar, solo anular.'); END`,
      `CREATE TRIGGER documento_renglones_insert_emitido BEFORE INSERT ON documento_renglones
        WHEN (SELECT estado FROM documentos WHERE id = new.documento_id) <> 'BORRADOR'
         AND (SELECT modo FROM documentos WHERE id = new.documento_id) = 'REAL'
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: sus renglones no se pueden cambiar.'); END`,
      `CREATE TRIGGER documento_renglones_update_emitido BEFORE UPDATE ON documento_renglones
        WHEN (SELECT estado FROM documentos WHERE id = old.documento_id) <> 'BORRADOR'
         AND (SELECT modo FROM documentos WHERE id = old.documento_id) = 'REAL'
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: sus renglones no se pueden cambiar.'); END`,
      `CREATE TRIGGER documento_renglones_delete_emitido BEFORE DELETE ON documento_renglones
        WHEN (SELECT estado FROM documentos WHERE id = old.documento_id) <> 'BORRADOR'
         AND (SELECT modo FROM documentos WHERE id = old.documento_id) = 'REAL'
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: sus renglones no se pueden cambiar.'); END`,
      `CREATE TRIGGER documento_impuestos_insert_emitido BEFORE INSERT ON documento_impuestos
        WHEN (SELECT estado FROM documentos WHERE id = new.documento_id) <> 'BORRADOR'
         AND (SELECT modo FROM documentos WHERE id = new.documento_id) = 'REAL'
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: sus renglones no se pueden cambiar.'); END`,
      `CREATE TRIGGER documento_impuestos_update_emitido BEFORE UPDATE ON documento_impuestos
        WHEN (SELECT estado FROM documentos WHERE id = old.documento_id) <> 'BORRADOR'
         AND (SELECT modo FROM documentos WHERE id = old.documento_id) = 'REAL'
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: sus renglones no se pueden cambiar.'); END`,
      `CREATE TRIGGER documento_impuestos_delete_emitido BEFORE DELETE ON documento_impuestos
        WHEN (SELECT estado FROM documentos WHERE id = old.documento_id) <> 'BORRADOR'
         AND (SELECT modo FROM documentos WHERE id = old.documento_id) = 'REAL'
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: sus renglones no se pueden cambiar.'); END`,
    ],
  },
  {
    id: "0005_pagos",
    sql: [
      // Condición de pago: se fija al emitir la factura (contado o crédito con días de plazo).
      `ALTER TABLE documentos ADD COLUMN condicion TEXT NOT NULL DEFAULT 'CONTADO' CHECK (condicion IN ('CONTADO', 'CREDITO'))`,
      `ALTER TABLE documentos ADD COLUMN dias_credito INTEGER`,
      `ALTER TABLE documentos ADD COLUMN vence_el TEXT`,
      `DROP TRIGGER doc_inmutable`,
      // Las facturas ya emitidas (Fase 3) reciben vencimiento = su fecha de emisión (se hace con la protección apagada, antes de recrearla).
      `UPDATE documentos SET vence_el = fecha_emision WHERE tipo = 'FACTURA' AND estado <> 'BORRADOR' AND vence_el IS NULL`,
      `CREATE TRIGGER doc_inmutable BEFORE UPDATE ON documentos
        WHEN old.modo = 'REAL' AND old.estado <> 'BORRADOR' AND (
          old.estado = 'ANULADO'
          OR new.estado NOT IN ('EMITIDO', 'FACTURADO', 'ANULADO')
          OR (old.estado = 'FACTURADO' AND new.estado <> 'FACTURADO')
          OR new.tipo IS NOT old.tipo
          OR new.modo IS NOT old.modo
          OR new.numero IS NOT old.numero
          OR new.control_interno IS NOT old.control_interno
          OR new.presupuesto_id IS NOT old.presupuesto_id
          OR new.cliente_id IS NOT old.cliente_id
          OR new.cliente_rif IS NOT old.cliente_rif
          OR new.cliente_nombre IS NOT old.cliente_nombre
          OR new.cliente_direccion IS NOT old.cliente_direccion
          OR new.cliente_whatsapp IS NOT old.cliente_whatsapp
          OR new.cliente_email IS NOT old.cliente_email
          OR new.nota IS NOT old.nota
          OR new.fecha_emision IS NOT old.fecha_emision
          OR new.emitido_en IS NOT old.emitido_en
          OR new.tasa_e8 IS NOT old.tasa_e8
          OR new.tasa_cargada_en IS NOT old.tasa_cargada_en
          OR new.subtotal_usd IS NOT old.subtotal_usd
          OR new.iva_usd IS NOT old.iva_usd
          OR new.total_usd IS NOT old.total_usd
          OR new.subtotal_bs IS NOT old.subtotal_bs
          OR new.iva_bs IS NOT old.iva_bs
          OR new.total_bs IS NOT old.total_bs
          OR new.costo_total_usd IS NOT old.costo_total_usd
          OR new.parametros_json IS NOT old.parametros_json
          OR new.emisor_json IS NOT old.emisor_json
          OR new.creado_en IS NOT old.creado_en
          OR new.creado_por IS NOT old.creado_por
          OR new.condicion IS NOT old.condicion
          OR new.dias_credito IS NOT old.dias_credito
          OR new.vence_el IS NOT old.vence_el)
        BEGIN SELECT RAISE(ABORT, 'Documento emitido: no se puede modificar, solo anular.'); END`,
      // Pagos: el saldo NO se guarda, se calcula (total - pagos vigentes), así nunca puede quedar desfasado.
      `CREATE TABLE pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        documento_id INTEGER NOT NULL REFERENCES documentos(id),
        modo TEXT NOT NULL CHECK (modo IN ('PRACTICA', 'REAL')),
        numero INTEGER,
        metodo TEXT NOT NULL CHECK (metodo IN ('PAGO_MOVIL', 'TRANSFERENCIA', 'EFECTIVO', 'ZELLE', 'BINANCE', 'PAYPAL', 'OTRO')),
        moneda TEXT NOT NULL CHECK (moneda IN ('USD', 'BS')),
        monto_recibido INTEGER NOT NULL CHECK (monto_recibido > 0),
        tasa_e8 INTEGER,
        monto_usd INTEGER NOT NULL CHECK (monto_usd > 0),
        saldo_despues_usd INTEGER NOT NULL,
        referencia TEXT, nota TEXT,
        fecha_pago TEXT NOT NULL,
        registrado_en TEXT NOT NULL, registrado_por INTEGER,
        reglas_json TEXT,
        estado TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'ANULADO')),
        anulado_en TEXT, anulado_por INTEGER, motivo_anulacion TEXT)`,
      `CREATE UNIQUE INDEX idx_pago_numero ON pagos(modo, numero) WHERE numero IS NOT NULL`,
      `CREATE INDEX idx_pago_documento ON pagos(documento_id)`,
      `CREATE TRIGGER pago_no_borrar BEFORE DELETE ON pagos WHEN old.modo = 'REAL'
        BEGIN SELECT RAISE(ABORT, 'Un pago registrado no se borra: se anula.'); END`,
      `CREATE TRIGGER pago_inmutable BEFORE UPDATE ON pagos
        WHEN old.modo = 'REAL' AND (
          old.estado = 'ANULADO'
          OR new.estado NOT IN ('VIGENTE', 'ANULADO')
          OR new.documento_id IS NOT old.documento_id
          OR new.modo IS NOT old.modo
          OR new.numero IS NOT old.numero
          OR new.metodo IS NOT old.metodo
          OR new.moneda IS NOT old.moneda
          OR new.monto_recibido IS NOT old.monto_recibido
          OR new.tasa_e8 IS NOT old.tasa_e8
          OR new.monto_usd IS NOT old.monto_usd
          OR new.saldo_despues_usd IS NOT old.saldo_despues_usd
          OR new.referencia IS NOT old.referencia
          OR new.nota IS NOT old.nota
          OR new.fecha_pago IS NOT old.fecha_pago
          OR new.registrado_en IS NOT old.registrado_en
          OR new.registrado_por IS NOT old.registrado_por
          OR new.reglas_json IS NOT old.reglas_json)
        BEGIN SELECT RAISE(ABORT, 'Pago registrado: solo se puede anular.'); END`,
      `INSERT INTO contadores (clave) VALUES ('RECIBO:PRACTICA'), ('RECIBO:REAL')`,
      `INSERT INTO parametros_fiscales (clave, vigente_desde, valor, nota) VALUES
        ('leyenda_recibo', '2000-01-01', 'Recibo de pago: comprobante interno de cobro, sin valor fiscal.', 'Texto del recibo en PDF')`,
      // Datos de cobro con campos fijos por método (antes eran texto libre en Ajustes).
      `CREATE TABLE metodos_cobro (metodo TEXT PRIMARY KEY, activo INTEGER NOT NULL DEFAULT 0, datos_json TEXT NOT NULL DEFAULT '{}')`,
      `INSERT INTO metodos_cobro (metodo) VALUES ('PAGO_MOVIL'), ('TRANSFERENCIA'), ('ZELLE'), ('BINANCE'), ('PAYPAL'), ('EFECTIVO')`,
      // Lo que ya habías escrito en Ajustes se conserva como nota del método.
      `UPDATE metodos_cobro SET activo = 1, datos_json = json_object('nota', (SELECT datos_pago_movil FROM perfil_emisor WHERE id = 1))
        WHERE metodo = 'PAGO_MOVIL' AND (SELECT COALESCE(datos_pago_movil, '') FROM perfil_emisor WHERE id = 1) <> ''`,
      // Lo que ya habías escrito en Ajustes se conserva como nota del método.
      `UPDATE metodos_cobro SET activo = 1, datos_json = json_object('nota', (SELECT datos_transferencia FROM perfil_emisor WHERE id = 1))
        WHERE metodo = 'TRANSFERENCIA' AND (SELECT COALESCE(datos_transferencia, '') FROM perfil_emisor WHERE id = 1) <> ''`,
      // Lo que ya habías escrito en Ajustes se conserva como nota del método.
      `UPDATE metodos_cobro SET activo = 1, datos_json = json_object('nota', (SELECT datos_zelle FROM perfil_emisor WHERE id = 1))
        WHERE metodo = 'ZELLE' AND (SELECT COALESCE(datos_zelle, '') FROM perfil_emisor WHERE id = 1) <> ''`,
      // Lo que ya habías escrito en Ajustes se conserva como nota del método.
      `UPDATE metodos_cobro SET activo = 1, datos_json = json_object('nota', (SELECT datos_binance FROM perfil_emisor WHERE id = 1))
        WHERE metodo = 'BINANCE' AND (SELECT COALESCE(datos_binance, '') FROM perfil_emisor WHERE id = 1) <> ''`,
      // Lo que ya habías escrito en Ajustes se conserva como nota del método.
      `UPDATE metodos_cobro SET activo = 1, datos_json = json_object('nota', (SELECT datos_paypal FROM perfil_emisor WHERE id = 1))
        WHERE metodo = 'PAYPAL' AND (SELECT COALESCE(datos_paypal, '') FROM perfil_emisor WHERE id = 1) <> ''`,
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
