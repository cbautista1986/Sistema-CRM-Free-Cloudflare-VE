// Módulo DOCUMENTOS (presupuestos y facturas): /api/documentos
// Ciclo de vida: BORRADOR (editable, sin número) -> EMITIDO (número asignado, ya no se modifica) -> ANULADO.
// Un presupuesto emitido pasa a FACTURADO cuando se emite la factura creada desde él.
import { Hono } from "hono";
import { aCantidadMilli, aTasaE8, calcular } from "../../public/dinero.js";
import { aCentavos, auditar, comodin, falla, fechaCaracas, idParam, leerJson, modoActual, parametrosVigentes, requiereSesion, texto, type Ctx, type Env } from "../comun";

const documentos = new Hono<Env>();
documentos.use("*", requiereSesion);

type Linea = { catalogo_id: number | null; tipo: "SERVICIO" | "PRODUCTO"; descripcion: string; cantidad_milli: number; precio_usd: number; costo_usd: number | null; alicuota_cent: number };
type Fila = Record<string, any>;

const COLUMNAS = `id, tipo, estado, modo, numero, control_interno, control_fiscal, presupuesto_id, cliente_id, cliente_rif, cliente_nombre,
  cliente_direccion, cliente_whatsapp, cliente_email, nota, fecha_emision, emitido_en, tasa_e8, tasa_cargada_en, subtotal_usd, iva_usd, total_usd,
  subtotal_bs, iva_bs, total_bs, costo_total_usd, parametros_json, emisor_json, anulado_en, motivo_anulacion, creado_en`;

async function cargar(c: Ctx, id: number) {
  const db = c.env.DB;
  const doc = await db.prepare(`SELECT ${COLUMNAS} FROM documentos WHERE id = ?`).bind(id).first<Fila>();
  if (!doc) return null;
  const [l, i] = await db.batch([
    db.prepare(`SELECT id, orden, catalogo_id, tipo, descripcion, cantidad_milli, precio_usd, costo_usd, alicuota_cent, monto_usd, monto_bs
                FROM documento_renglones WHERE documento_id = ? ORDER BY orden`).bind(id),
    db.prepare(`SELECT alicuota_cent, base_usd, iva_usd, base_bs, iva_bs FROM documento_impuestos WHERE documento_id = ? ORDER BY alicuota_cent`).bind(id),
  ]);
  return { doc, lineas: l.results as Fila[], impuestos: i.results as Fila[] };
}

async function normalizarLineas(c: Ctx, bruto: unknown, permitidas: number[], max: number): Promise<Linea[] | string> {
  if (!Array.isArray(bruto) || bruto.length === 0) return "Agrega al menos un renglón.";
  if (bruto.length > max) return `Máximo ${max} renglones por documento: divide la venta en dos documentos.`;
  type Item = { id: number; nombre: string; tipo: "SERVICIO" | "PRODUCTO"; costo_centavos: number | null; alicuota_iva: number; activo: number };
  const ids = [...new Set(bruto.map((r) => Number(((r ?? {}) as Record<string, unknown>).catalogo_id) || 0).filter(Boolean))];
  const items = new Map<number, Item>();
  if (ids.length) { // UNA sola consulta para todo el inventario usado (el plan gratis limita las consultas por petición)
    const { results } = await c.env.DB.prepare(`SELECT id, nombre, tipo, costo_centavos, alicuota_iva, activo FROM catalogo WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids).all<Item>();
    for (const it of results) items.set(it.id, it);
  }
  const salida: Linea[] = [];
  for (const [n, r] of bruto.entries()) {
    const b = (r ?? {}) as Record<string, unknown>, pos = `Renglón ${n + 1}`;
    const cant = aCantidadMilli(b.cantidad), precio = aCentavos(b.precio_usd);
    if (cant === null || Number.isNaN(cant)) return `${pos}: la cantidad no es válida (ejemplos: 1 o 1,5).`;
    if (precio === null || Number.isNaN(precio)) return `${pos}: escribe el precio en USD (ejemplo: 12,50).`;
    const catId = Number(b.catalogo_id) || 0;
    let tipo: "SERVICIO" | "PRODUCTO" = "SERVICIO", costo: number | null = null, alic: number, desc = texto(b.descripcion, 200);
    if (catId) {
      const it = items.get(catId);
      if (!it) return `${pos}: ese producto o servicio ya no existe.`;
      if (!it.activo) return `${pos}: «${it.nombre}» está desactivado en el inventario.`;
      tipo = it.tipo; costo = it.costo_centavos; alic = it.alicuota_iva * 100; desc = desc || it.nombre; // el IVA lo manda el inventario
    } else {
      if (desc.length < 2) return `${pos}: escribe la descripción del servicio.`;
      alic = Math.round(Number(b.alicuota_iva) * 100); // servicio "al momento": no se guarda en el inventario
    }
    if (!permitidas.includes(alic)) return `${pos}: el IVA no es válido.`;
    salida.push({ catalogo_id: catId || null, tipo, descripcion: desc, cantidad_milli: cant, precio_usd: precio, costo_usd: costo, alicuota_cent: alic });
  }
  return salida;
}

async function validarBorrador(c: Ctx, b: Record<string, unknown>) {
  const db = c.env.DB;
  const params = await parametrosVigentes(db, fechaCaracas());
  const permitidas = (params.iva_alicuotas_cent ?? "0,800,1600").split(",").map(Number);
  const clienteId = Number(b.cliente_id) || null;
  if (clienteId && !(await db.prepare(`SELECT 1 AS x FROM clientes WHERE id = ?`).bind(clienteId).first())) return "El cliente elegido ya no existe.";
  const lineas = await normalizarLineas(c, b.lineas, permitidas, Number(params.max_renglones ?? 30));
  if (typeof lineas === "string") return lineas;
  try { return { clienteId, nota: texto(b.nota, 500) || null, lineas, calculo: calcular(lineas, null) }; }
  catch (e) { return (e as Error).message; }
}

const insertarLineas = (c: Ctx, id: number, lineas: Linea[], montos: { monto_usd: number }[]) =>
  lineas.map((l, i) => c.env.DB.prepare(
    `INSERT INTO documento_renglones (documento_id, orden, catalogo_id, tipo, descripcion, cantidad_milli, precio_usd, costo_usd, alicuota_cent, monto_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, i + 1, l.catalogo_id, l.tipo, l.descripcion, l.cantidad_milli, l.precio_usd, l.costo_usd, l.alicuota_cent, montos[i].monto_usd));

// ---------------------------------------------------------------- consultas
documentos.get("/", async (c) => {
  const q = texto(c.req.query("q"), 60), like = `%${comodin(q)}%`, tipo = texto(c.req.query("tipo"), 12);
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.tipo, d.estado, d.modo, d.numero, d.control_interno, COALESCE(d.cliente_nombre, c.nombre_apellido) AS cliente,
            d.fecha_emision, d.total_usd, d.total_bs, d.creado_en
     FROM documentos d LEFT JOIN clientes c ON c.id = d.cliente_id
     WHERE (? = '' OR d.tipo = ?)
       AND (? = '' OR COALESCE(d.cliente_nombre, c.nombre_apellido) LIKE ? ESCAPE '\\' OR CAST(d.numero AS TEXT) LIKE ? ESCAPE '\\')
     ORDER BY COALESCE(d.emitido_en, d.creado_en) DESC, d.id DESC LIMIT 100`
  ).bind(tipo, tipo, q, like, like).all();
  return c.json({ ok: true, documentos: results });
});

// Ganancia del mes (solo facturas emitidas). Ganancia = monto del renglón - su costo (el costo es privado y opcional).
documentos.get("/resumen", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.tipo, SUM(r.monto_usd) AS ingresos, SUM((r.cantidad_milli * COALESCE(r.costo_usd, 0) + 500) / 1000) AS costos
     FROM documento_renglones r JOIN documentos d ON d.id = r.documento_id
     WHERE d.tipo = 'FACTURA' AND d.estado = 'EMITIDO' AND substr(d.fecha_emision, 1, 7) = ? GROUP BY r.tipo`
  ).bind(fechaCaracas().slice(0, 7)).all<{ tipo: string; ingresos: number; costos: number }>();
  const g = (t: string) => { const f = results.find((x) => x.tipo === t); return f ? f.ingresos - f.costos : 0; };
  return c.json({ ok: true, servicios: g("SERVICIO"), productos: g("PRODUCTO"), total: g("SERVICIO") + g("PRODUCTO") });
});

documentos.get("/:id", async (c) => {
  const r = await cargar(c, idParam(c));
  return r ? c.json({ ok: true, documento: r.doc, lineas: r.lineas, impuestos: r.impuestos }) : falla(c, 404, "Documento no encontrado.");
});

// ---------------------------------------------------------------- borradores
documentos.post("/", async (c) => {
  const b = await leerJson(c), tipo = texto(b.tipo, 12);
  if (tipo !== "FACTURA" && tipo !== "PRESUPUESTO") return falla(c, 400, "El tipo de documento no es válido.");
  const v = await validarBorrador(c, b);
  if (typeof v === "string") return falla(c, 400, v);
  const t = v.calculo, u = c.get("usuario");
  const fila = await c.env.DB.prepare(
    `INSERT INTO documentos (tipo, estado, modo, cliente_id, nota, subtotal_usd, iva_usd, total_usd, costo_total_usd, creado_por)
     VALUES (?, 'BORRADOR', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(tipo, await modoActual(c.env.DB), v.clienteId, v.nota, t.subtotal_usd, t.iva_usd, t.total_usd, t.costo_total_usd, u.id).first<{ id: number }>();
  await c.env.DB.batch(insertarLineas(c, fila!.id, v.lineas, t.renglones));
  await auditar(c, u.id, "DOC_CREAR", `${tipo} ${fila!.id}`);
  return c.json({ ok: true, id: fila!.id });
});

documentos.put("/:id", async (c) => {
  const id = idParam(c), db = c.env.DB;
  const d = await db.prepare(`SELECT estado FROM documentos WHERE id = ?`).bind(id).first<{ estado: string }>();
  if (!d) return falla(c, 404, "Documento no encontrado.");
  if (d.estado !== "BORRADOR") return falla(c, 409, "Solo se puede editar un borrador: un documento emitido no se modifica.");
  const v = await validarBorrador(c, await leerJson(c));
  if (typeof v === "string") return falla(c, 400, v);
  const t = v.calculo;
  await db.batch([
    db.prepare(`DELETE FROM documento_renglones WHERE documento_id = ?`).bind(id),
    ...insertarLineas(c, id, v.lineas, t.renglones),
    db.prepare(`UPDATE documentos SET cliente_id = ?, nota = ?, subtotal_usd = ?, iva_usd = ?, total_usd = ?, costo_total_usd = ?
                WHERE id = ? AND estado = 'BORRADOR'`).bind(v.clienteId, v.nota, t.subtotal_usd, t.iva_usd, t.total_usd, t.costo_total_usd, id),
  ]);
  await auditar(c, c.get("usuario").id, "DOC_EDITAR", String(id));
  return c.json({ ok: true });
});

documentos.delete("/:id", async (c) => {
  const id = idParam(c), db = c.env.DB;
  const d = await db.prepare(`SELECT estado FROM documentos WHERE id = ?`).bind(id).first<{ estado: string }>();
  if (!d) return falla(c, 404, "Documento no encontrado.");
  if (d.estado !== "BORRADOR") return falla(c, 409, "Un documento emitido no se borra: se anula.");
  await db.batch([db.prepare(`DELETE FROM documento_renglones WHERE documento_id = ?`).bind(id),
    db.prepare(`DELETE FROM documentos WHERE id = ? AND estado = 'BORRADOR'`).bind(id)]);
  await auditar(c, c.get("usuario").id, "DOC_BORRAR_BORRADOR", String(id));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- emitir
documentos.post("/:id/emitir", async (c) => {
  const id = idParam(c), db = c.env.DB, u = c.get("usuario");
  const cargado = await cargar(c, id);
  if (!cargado) return falla(c, 404, "Documento no encontrado.");
  const { doc, lineas } = cargado;
  if (doc.estado !== "BORRADOR") return falla(c, 409, "Este documento ya fue emitido.");
  if (!doc.cliente_id) return falla(c, 400, "Elige el cliente antes de emitir.");
  if (!lineas.length) return falla(c, 400, "Agrega al menos un renglón.");
  if (lineas.some((l) => l.precio_usd <= 0)) return falla(c, 400, "Todos los renglones deben tener un precio mayor que 0.");

  const perfil = await db.prepare(`SELECT nombre_razon_social, rif, direccion_fiscal, telefono, email, tasa_bcv, tasa_bcv_fecha FROM perfil_emisor WHERE id = 1`).first<Fila>();
  const tasa = aTasaE8(String(perfil?.tasa_bcv ?? ""));
  if (!tasa || Number.isNaN(tasa)) return falla(c, 400, "Define la tasa BCV de hoy en el Inicio antes de emitir.");
  const cli = await db.prepare(`SELECT rif_cedula, nombre_apellido, direccion, whatsapp, email FROM clientes WHERE id = ?`).bind(doc.cliente_id).first<Fila>();
  if (!cli) return falla(c, 400, "El cliente ya no existe.");

  const fecha = fechaCaracas(), params = await parametrosVigentes(db, fecha);
  let calc;
  try { calc = calcular(lineas as Linea[], tasa); } catch (e) { return falla(c, 400, (e as Error).message); }

  const esFactura = doc.tipo === "FACTURA", claveNum = `${doc.tipo}:${doc.modo}`, claveCtl = `CONTROL:${doc.modo}`;
  const sigueBorrador = `EXISTS (SELECT 1 FROM documentos WHERE id = ? AND estado = 'BORRADOR')`;
  const emisor = { nombre_razon_social: perfil!.nombre_razon_social, rif: perfil!.rif, direccion_fiscal: perfil!.direccion_fiscal, telefono: perfil!.telefono, email: perfil!.email };
  const reglas = { iva_alicuotas_cent: params.iva_alicuotas_cent, titulo_sin_control: params.titulo_sin_control, leyenda_sin_control: params.leyenda_sin_control,
    leyenda_cambio: params.leyenda_cambio, validez_presupuesto_dias: Number(params.validez_presupuesto_dias ?? 15), plantilla_version: Number(params.plantilla_version ?? 1) };

  // TODO en un solo paso (todo o nada): sumar correlativos, fijar montos en Bs, impuestos y pasar a EMITIDO.
  const pasos = [db.prepare(`UPDATE contadores SET valor = valor + 1 WHERE clave = ? AND ${sigueBorrador}`).bind(claveNum, id)];
  if (esFactura) pasos.push(db.prepare(`UPDATE contadores SET valor = valor + 1 WHERE clave = ? AND ${sigueBorrador}`).bind(claveCtl, id));
  calc.renglones.forEach((r: Fila, i: number) => pasos.push(
    db.prepare(`UPDATE documento_renglones SET monto_usd = ?, monto_bs = ? WHERE id = ?`).bind(r.monto_usd, r.monto_bs, lineas[i].id)));
  calc.impuestos.forEach((x: Fila) => pasos.push(
    db.prepare(`INSERT INTO documento_impuestos (documento_id, alicuota_cent, base_usd, iva_usd, base_bs, iva_bs) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, x.alicuota_cent, x.base_usd, x.iva_usd, x.base_bs, x.iva_bs)));
  const posEmision = pasos.length;
  pasos.push(db.prepare(
    `UPDATE documentos SET estado = 'EMITIDO', numero = (SELECT valor FROM contadores WHERE clave = ?),
       control_interno = ${esFactura ? "(SELECT valor FROM contadores WHERE clave = ?)" : "NULL"},
       cliente_rif = ?, cliente_nombre = ?, cliente_direccion = ?, cliente_whatsapp = ?, cliente_email = ?,
       fecha_emision = ?, emitido_en = ?, tasa_e8 = ?, tasa_cargada_en = ?,
       subtotal_usd = ?, iva_usd = ?, total_usd = ?, subtotal_bs = ?, iva_bs = ?, total_bs = ?, costo_total_usd = ?,
       parametros_json = ?, emisor_json = ?
     WHERE id = ? AND estado = 'BORRADOR'`
  ).bind(...[claveNum, ...(esFactura ? [claveCtl] : []), cli.rif_cedula, cli.nombre_apellido, cli.direccion, cli.whatsapp, cli.email,
    fecha, new Date().toISOString(), tasa, perfil!.tasa_bcv_fecha,
    calc.subtotal_usd, calc.iva_usd, calc.total_usd, calc.subtotal_bs, calc.iva_bs, calc.total_bs, calc.costo_total_usd,
    JSON.stringify(reglas), JSON.stringify(emisor), id]));
  if (esFactura && doc.presupuesto_id)
    pasos.push(db.prepare(`UPDATE documentos SET estado = 'FACTURADO' WHERE id = ? AND estado = 'EMITIDO'`).bind(doc.presupuesto_id));

  try {
    const r = await db.batch(pasos);
    if (!r[posEmision].meta.changes) return falla(c, 409, "Este documento ya fue emitido.");
  } catch (e) {
    if (/Documento emitido|UNIQUE|PRIMARY KEY/.test(String(e))) return falla(c, 409, "Este documento ya fue emitido.");
    throw e;
  }
  const f = await db.prepare(`SELECT numero, control_interno FROM documentos WHERE id = ?`).bind(id).first<Fila>();
  await auditar(c, u.id, "DOC_EMITIR", `${doc.tipo} ${doc.modo} n.º ${f?.numero}`);
  return c.json({ ok: true, numero: f?.numero, control_interno: f?.control_interno });
});

// ---------------------------------------------------------------- anular, convertir, copiar
documentos.post("/:id/anular", async (c) => {
  const id = idParam(c), motivo = texto((await leerJson(c)).motivo, 200), u = c.get("usuario");
  if (motivo.length < 5) return falla(c, 400, "Escribe el motivo de la anulación (mínimo 5 letras).");
  const r = await c.env.DB.prepare(
    `UPDATE documentos SET estado = 'ANULADO', anulado_en = ?, anulado_por = ?, motivo_anulacion = ? WHERE id = ? AND estado = 'EMITIDO'`
  ).bind(new Date().toISOString(), u.id, motivo, id).run();
  if (!r.meta.changes) return falla(c, 409, "Solo se puede anular un documento emitido (no un borrador, ni uno ya anulado o facturado).");
  await auditar(c, u.id, "DOC_ANULAR", `${id}: ${motivo}`);
  return c.json({ ok: true });
});

async function clonar(c: Ctx, origenId: number, tipo: "FACTURA" | "PRESUPUESTO", presupuestoId: number | null) {
  const db = c.env.DB;
  const nuevo = await db.prepare(
    `INSERT INTO documentos (tipo, estado, modo, cliente_id, nota, presupuesto_id, subtotal_usd, iva_usd, total_usd, costo_total_usd, creado_por)
     SELECT ?, 'BORRADOR', ?, cliente_id, nota, ?, subtotal_usd, iva_usd, total_usd, costo_total_usd, ? FROM documentos WHERE id = ? RETURNING id`
  ).bind(tipo, await modoActual(db), presupuestoId, c.get("usuario").id, origenId).first<{ id: number }>();
  await db.prepare(
    `INSERT INTO documento_renglones (documento_id, orden, catalogo_id, tipo, descripcion, cantidad_milli, precio_usd, costo_usd, alicuota_cent, monto_usd)
     SELECT ?, orden, catalogo_id, tipo, descripcion, cantidad_milli, precio_usd, costo_usd, alicuota_cent, monto_usd
     FROM documento_renglones WHERE documento_id = ? ORDER BY orden`
  ).bind(nuevo!.id, origenId).run();
  return nuevo!.id;
}

documentos.post("/:id/convertir", async (c) => {
  const id = idParam(c);
  const o = await c.env.DB.prepare(`SELECT tipo, estado FROM documentos WHERE id = ?`).bind(id).first<Fila>();
  if (!o) return falla(c, 404, "Documento no encontrado.");
  if (o.tipo !== "PRESUPUESTO" || o.estado !== "EMITIDO") return falla(c, 409, "Solo un presupuesto emitido (y no facturado) se convierte en factura.");
  const previo = await c.env.DB.prepare(`SELECT id FROM documentos WHERE presupuesto_id = ? AND estado = 'BORRADOR'`).bind(id).first<{ id: number }>();
  if (previo) return c.json({ ok: true, id: previo.id });
  const nuevo = await clonar(c, id, "FACTURA", id);
  await auditar(c, c.get("usuario").id, "DOC_CONVERTIR", `${id} -> ${nuevo}`);
  return c.json({ ok: true, id: nuevo });
});

documentos.post("/:id/copiar", async (c) => {
  const id = idParam(c);
  const o = await c.env.DB.prepare(`SELECT tipo, estado FROM documentos WHERE id = ?`).bind(id).first<Fila>();
  if (!o) return falla(c, 404, "Documento no encontrado.");
  if (o.estado === "BORRADOR") return falla(c, 409, "Un borrador ya se puede editar.");
  const nuevo = await clonar(c, id, o.tipo, null);
  await auditar(c, c.get("usuario").id, "DOC_COPIAR", `${id} -> ${nuevo}`);
  return c.json({ ok: true, id: nuevo });
});

export default documentos;
