// Módulo PAGOS: cobros recibidos, por cobrar, recibos y datos de cobro: /api/pagos
// Reglas: el saldo NUNCA se guarda (se calcula: total del documento - pagos vigentes), un pago no se edita ni se borra (se anula con
// motivo), los bolívares se convierten a dólares con la tasa del día del pago y cada pago lleva su recibo con correlativo propio.
import { Hono } from "hono";
import { aCentavos, aTasaE8, bsAUsd } from "../../public/dinero.js";
import { PAGADO, RIF, auditar, comodin, falla, fechaCaracas, idParam, leerJson, normalizarWhatsapp, parametrosVigentes, requiereAdmin, requiereSesion, texto, type Env } from "../comun";

const pagos = new Hono<Env>();
pagos.use("*", requiereSesion);
type Fila = Record<string, any>;

const METODOS: Record<string, string[]> = { PAGO_MOVIL: ["BS"], TRANSFERENCIA: ["BS", "USD"], EFECTIVO: ["BS", "USD"], ZELLE: ["USD"], BINANCE: ["USD"], PAYPAL: ["USD"], OTRO: ["BS", "USD"] };
const dolares = (c: number) => `$ ${(c / 100).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function porCobrar(db: D1Database) {
  const hoy = fechaCaracas();
  const { results } = await db.prepare(
    `SELECT * FROM (SELECT d.id, d.numero, d.cliente_nombre, d.fecha_emision, d.vence_el, d.condicion, d.dias_credito, d.total_usd, ${PAGADO} AS pagado_usd
       FROM documentos d WHERE d.tipo = 'FACTURA' AND d.estado = 'EMITIDO') WHERE total_usd - pagado_usd > 0 ORDER BY vence_el, id`
  ).all<Fila>();
  return results.map((r) => {
    const vencida = !!r.vence_el && r.vence_el < hoy;
    return { ...r, saldo_usd: r.total_usd - r.pagado_usd, vencida, dias_atraso: vencida ? Math.round((Date.parse(hoy) - Date.parse(r.vence_el)) / 86400000) : 0 };
  });
}

pagos.get("/por-cobrar", async (c) => c.json({ ok: true, facturas: await porCobrar(c.env.DB) }));

pagos.get("/resumen", async (c) => {
  const lista = await porCobrar(c.env.DB), mes = fechaCaracas().slice(0, 7);
  const venc = lista.filter((x) => x.vencida);
  const cobrado = await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd), 0) AS t FROM pagos WHERE estado = 'VIGENTE' AND substr(fecha_pago, 1, 7) = ?`).bind(mes).first<{ t: number }>();
  return c.json({ ok: true, por_cobrar_usd: lista.reduce((s, x) => s + x.saldo_usd, 0), por_cobrar_n: lista.length,
    vencidas_n: venc.length, vencidas_usd: venc.reduce((s, x) => s + x.saldo_usd, 0), cobrado_mes_usd: cobrado?.t ?? 0 });
});

// ---------------------------------------------------------------- datos de cobro (campos fijos por método)
const CAMPOS: Record<string, string[]> = { PAGO_MOVIL: ["banco", "documento", "telefono"], TRANSFERENCIA: ["banco", "cuenta", "tipo", "titular", "documento"],
  ZELLE: ["contacto", "titular"], BINANCE: ["contacto", "titular"], PAYPAL: ["contacto"], EFECTIVO: [] };

function limpiarDatos(metodo: string, bruto: Record<string, unknown>) {
  const campos = CAMPOS[metodo];
  if (!campos) return "Método no válido.";
  const out: Record<string, string> = {};
  for (const k of [...campos, "nota"]) { const v = texto(bruto[k], k === "nota" ? 300 : 80); if (v) out[k] = v; }
  if (out.telefono) {
    const n = normalizarWhatsapp(out.telefono);
    if (typeof n !== "string" || !n.startsWith("58")) return "El teléfono del pago móvil no es válido (ejemplo: 0414-1234567).";
    out.telefono = "0" + n.slice(2);
  }
  if (out.cuenta) { const d = out.cuenta.replace(/\D/g, ""); if (d.length !== 20) return "El número de cuenta debe tener 20 dígitos."; out.cuenta = d; }
  if (out.documento) { out.documento = out.documento.toUpperCase(); if (!RIF.test(out.documento)) return "La cédula o el RIF no es válido (ejemplo: V-12345678)."; }
  return out;
}

pagos.get("/metodos", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT metodo, activo, datos_json FROM metodos_cobro ORDER BY rowid`).all<Fila>();
  return c.json({ ok: true, metodos: results.map((r) => ({ metodo: r.metodo, activo: !!r.activo, datos: JSON.parse(r.datos_json || "{}") })) });
});

pagos.put("/metodos/:metodo", requiereAdmin, async (c) => {
  const metodo = c.req.param("metodo") ?? "", b = await leerJson(c);
  const datos = limpiarDatos(metodo, ((b.datos ?? {}) as Record<string, unknown>));
  if (typeof datos === "string") return falla(c, 400, datos);
  const activo = b.activo === true || b.activo === "1" ? 1 : 0;
  const r = await c.env.DB.prepare(`UPDATE metodos_cobro SET activo = ?, datos_json = ? WHERE metodo = ?`).bind(activo, JSON.stringify(datos), metodo).run();
  if (!r.meta.changes) return falla(c, 404, "Método no encontrado.");
  await auditar(c, c.get("usuario").id, "COBRO_DATOS", metodo);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- cobros
pagos.get("/", async (c) => {
  const q = texto(c.req.query("q"), 60), like = `%${comodin(q)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.numero, p.metodo, p.moneda, p.monto_recibido, p.tasa_e8, p.monto_usd, p.fecha_pago, p.estado, p.modo,
            d.tipo AS doc_tipo, d.numero AS doc_numero, d.cliente_nombre
     FROM pagos p JOIN documentos d ON d.id = p.documento_id
     WHERE ? = '' OR d.cliente_nombre LIKE ? ESCAPE '\\' OR CAST(p.numero AS TEXT) LIKE ? ESCAPE '\\' OR p.referencia LIKE ? ESCAPE '\\'
     ORDER BY p.id DESC LIMIT 100`
  ).bind(q, like, like, like).all();
  return c.json({ ok: true, pagos: results });
});

pagos.post("/", async (c) => {
  const db = c.env.DB, u = c.get("usuario"), b = await leerJson(c), hoy = fechaCaracas();
  const docId = Number(b.documento_id) || 0, metodo = texto(b.metodo, 20), moneda = texto(b.moneda, 3).toUpperCase();
  if (!METODOS[metodo] || !METODOS[metodo].includes(moneda)) return falla(c, 400, "El método de pago y la moneda no son compatibles.");
  const D = await db.prepare(`SELECT d.id, d.tipo, d.estado, d.modo, d.total_usd, d.fecha_emision, ${PAGADO} AS pagado FROM documentos d WHERE d.id = ?`).bind(docId).first<Fila>();
  if (!D) return falla(c, 404, "Documento no encontrado.");
  if (D.estado !== "EMITIDO") return falla(c, 409, "Solo se registran pagos en documentos emitidos y vigentes.");
  const saldoAntes = D.total_usd - D.pagado;
  if (saldoAntes <= 0) return falla(c, 409, "Este documento ya está pagado por completo.");

  const monto = aCentavos(b.monto);
  if (!monto || Number.isNaN(monto)) return falla(c, 400, "Escribe el monto recibido (ejemplo: 12,50).");
  let tasa: number | null = null, montoUsd = monto;
  if (moneda === "BS") {
    tasa = aTasaE8(b.tasa);
    if (!tasa || Number.isNaN(tasa)) return falla(c, 400, "Escribe la tasa BCV del día del pago (ejemplo: 123,45).");
    try { montoUsd = bsAUsd(monto, tasa); } catch (e) { return falla(c, 400, (e as Error).message); }
    if (montoUsd < 1) return falla(c, 400, "El monto es demasiado pequeño para esa tasa.");
    if (Math.abs(saldoAntes - montoUsd) <= 1) montoUsd = saldoAntes; // diferencia de redondeo de un centavo: se cierra el saldo
  }
  if (montoUsd > saldoAntes) return falla(c, 400, `El pago (${dolares(montoUsd)}) es mayor que el saldo (${dolares(saldoAntes)}).`);
  const fecha = texto(b.fecha, 10) || hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy || fecha < D.fecha_emision) return falla(c, 400, "La fecha del pago no es válida (no puede ser futura ni anterior a la emisión).");

  const params = await parametrosVigentes(db, hoy), claveRecibo = `RECIBO:${D.modo}`;
  const reglas = JSON.stringify({ leyenda_recibo: params.leyenda_recibo, plantilla_version: Number(params.plantilla_version ?? 1) });
  // Solo se registra si el saldo sigue siendo el que vimos (dos cobros a la vez no pueden pasarse del total).
  const guarda = `(SELECT d.total_usd - ${PAGADO} FROM documentos d WHERE d.id = ?) = ?`;
  const r = await db.batch([
    db.prepare(`UPDATE contadores SET valor = valor + 1 WHERE clave = ? AND ${guarda}`).bind(claveRecibo, docId, saldoAntes),
    db.prepare(
      `INSERT INTO pagos (documento_id, modo, numero, metodo, moneda, monto_recibido, tasa_e8, monto_usd, saldo_despues_usd, referencia, nota, fecha_pago, registrado_en, registrado_por, reglas_json)
       SELECT ?, ?, (SELECT valor FROM contadores WHERE clave = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guarda} RETURNING id, numero`
    ).bind(docId, D.modo, claveRecibo, metodo, moneda, monto, tasa, montoUsd, saldoAntes - montoUsd, texto(b.referencia, 60) || null, texto(b.nota, 200) || null,
      fecha, new Date().toISOString(), u.id, reglas, docId, saldoAntes),
  ]);
  const nuevo = (r[1].results as Fila[])[0];
  if (!nuevo) return falla(c, 409, "El saldo cambió mientras registrabas el pago. Revisa y vuelve a intentarlo.");
  await auditar(c, u.id, "PAGO_REGISTRAR", `${metodo} ${moneda} ${monto} -> doc ${docId} recibo ${nuevo.numero}`);
  return c.json({ ok: true, id: nuevo.id, numero: nuevo.numero, saldo_usd: saldoAntes - montoUsd });
});

pagos.get("/:id", async (c) => {
  const p = await c.env.DB.prepare(`SELECT * FROM pagos WHERE id = ?`).bind(idParam(c)).first<Fila>();
  if (!p) return falla(c, 404, "Pago no encontrado.");
  const d = await c.env.DB.prepare(
    `SELECT id, tipo, numero, estado, modo, cliente_nombre, cliente_rif, cliente_whatsapp, emisor_json, total_usd, fecha_emision FROM documentos WHERE id = ?`).bind(p.documento_id).first<Fila>();
  return c.json({ ok: true, pago: p, documento: d });
});

pagos.post("/:id/anular", async (c) => {
  const id = idParam(c), motivo = texto((await leerJson(c)).motivo, 200), u = c.get("usuario");
  if (motivo.length < 5) return falla(c, 400, "Escribe el motivo de la anulación (mínimo 5 letras).");
  const r = await c.env.DB.prepare(
    `UPDATE pagos SET estado = 'ANULADO', anulado_en = ?, anulado_por = ?, motivo_anulacion = ? WHERE id = ? AND estado = 'VIGENTE'`
  ).bind(new Date().toISOString(), u.id, motivo, id).run();
  if (!r.meta.changes) return falla(c, 409, "Ese pago no existe o ya estaba anulado.");
  await auditar(c, u.id, "PAGO_ANULAR", `${id}: ${motivo}`);
  return c.json({ ok: true });
});

export default pagos;
