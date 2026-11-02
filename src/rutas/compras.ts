// Módulo COMPRAS: facturas de compra de tus proveedores: /api/compras
// Al registrar una compra entran existencias (promedio ponderado). Una compra no se edita ni se borra: se anula (solo el administrador),
// y solo si no hubo otros movimientos del producto después (si ya vendiste parte, se corrige con un ajuste).
import { Hono } from "hono";
import { aCantidadMilli, aCentavos, calcular } from "../../public/dinero.js";
import { auditar, comodin, esUnico, falla, fechaCaracas, idParam, leerJson, modoActual, parametrosVigentes, requiereAdmin, requiereSesion, texto, type Env } from "../comun";
import { costoPromedio, guardaSaldo, movimiento, saldos } from "../stock";

const compras = new Hono<Env>();
compras.use("*", requiereSesion);
type Fila = Record<string, any>;
const CAMBIO = /CHECK constraint failed/;

compras.get("/", async (c) => {
  const q = texto(c.req.query("q"), 60), like = `%${comodin(q)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, modo, proveedor_nombre, factura_numero, fecha, total_usd, estado FROM compras
     WHERE ? = '' OR proveedor_nombre LIKE ? ESCAPE '\\' OR factura_numero LIKE ? ESCAPE '\\' ORDER BY fecha DESC, id DESC LIMIT 100`
  ).bind(q, like, like).all();
  return c.json({ ok: true, compras: results });
});

compras.get("/:id", async (c) => {
  const f = await c.env.DB.prepare(`SELECT * FROM compras WHERE id = ?`).bind(idParam(c)).first<Fila>();
  if (!f) return falla(c, 404, "Compra no encontrada.");
  const { renglones_json, ...resto } = f;
  return c.json({ ok: true, compra: resto, renglones: JSON.parse(renglones_json) });
});

compras.post("/", async (c) => {
  const db = c.env.DB, u = c.get("usuario"), b = await leerJson(c), hoy = fechaCaracas();
  const prov = await db.prepare(`SELECT id, rif, nombre FROM proveedores WHERE id = ?`).bind(Number(b.proveedor_id) || 0).first<Fila>();
  if (!prov) return falla(c, 400, "Elige el proveedor.");
  const factura = texto(b.factura_numero, 40), control = texto(b.control_numero, 40) || null, fecha = texto(b.fecha, 10) || hoy;
  if (!factura) return falla(c, 400, "Escribe el número de la factura del proveedor.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy) return falla(c, 400, "La fecha de la factura no es válida (no puede ser futura).");
  const params = await parametrosVigentes(db, hoy), permitidas = (params.iva_alicuotas_cent ?? "0,800,1600").split(",").map(Number), max = Number(params.max_renglones ?? 30);
  const bruto = b.lineas;
  if (!Array.isArray(bruto) || !bruto.length) return falla(c, 400, "Agrega al menos un producto.");
  if (bruto.length > max) return falla(c, 400, `Máximo ${max} renglones por compra: divídela en dos.`);
  const ids = [...new Set(bruto.map((r) => Number(((r ?? {}) as Record<string, unknown>).producto_id) || 0).filter(Boolean))];
  const { results: prods } = ids.length
    ? await db.prepare(`SELECT id, nombre, tipo, activo, alicuota_iva, controla_stock FROM catalogo WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<Fila>()
    : { results: [] as Fila[] };
  const P = new Map(prods.map((p) => [p.id, p]));
  const ls: { producto_id: number; descripcion: string; cantidad_milli: number; costo_usd: number; alicuota_cent: number }[] = [];
  for (const [n, r] of bruto.entries()) {
    const x = (r ?? {}) as Record<string, unknown>, pos = `Renglón ${n + 1}`, p = P.get(Number(x.producto_id));
    if (!p || p.tipo !== "PRODUCTO") return falla(c, 400, `${pos}: elige un producto del inventario.`);
    if (!p.activo) return falla(c, 400, `${pos}: «${p.nombre}» está desactivado.`);
    const cant = aCantidadMilli(x.cantidad), costo = aCentavos(x.costo_usd);
    if (cant === null || Number.isNaN(cant)) return falla(c, 400, `${pos}: la cantidad no es válida (ejemplos: 10 o 2,5).`);
    if (!costo || Number.isNaN(costo)) return falla(c, 400, `${pos}: escribe el costo por unidad en USD (mayor que 0).`);
    const alic = x.alicuota_iva === undefined || x.alicuota_iva === "" || x.alicuota_iva === null ? p.alicuota_iva * 100 : Math.round(Number(x.alicuota_iva) * 100);
    if (!permitidas.includes(alic)) return falla(c, 400, `${pos}: el IVA no es válido.`);
    ls.push({ producto_id: p.id, descripcion: p.nombre, cantidad_milli: cant, costo_usd: costo, alicuota_cent: alic });
  }
  let calc;
  try { calc = calcular(ls.map((l) => ({ cantidad_milli: l.cantidad_milli, precio_usd: l.costo_usd, alicuota_cent: l.alicuota_cent })), null); }
  catch (e) { return falla(c, 400, (e as Error).message); }
  const renglones = ls.map((l, i) => ({ ...l, monto_usd: calc.renglones[i].monto_usd }));
  const entradas = new Map<number, { cant: number; valor: number }>();
  for (const r of renglones) { const e = entradas.get(r.producto_id) ?? { cant: 0, valor: 0 }; e.cant += r.cantidad_milli; e.valor += r.monto_usd; entradas.set(r.producto_id, e); }
  if (await db.prepare(`SELECT id FROM compras WHERE proveedor_id = ? AND factura_numero = ? AND estado = 'REGISTRADA'`).bind(prov.id, factura).first())
    return falla(c, 409, "Ya registraste esa factura de este proveedor.");
  const sal = await saldos(db, [...entradas.keys()]), modo = await modoActual(db);
  const pasos = [db.prepare(
    `INSERT INTO compras (modo, proveedor_id, proveedor_rif, proveedor_nombre, factura_numero, control_numero, fecha, subtotal_usd, iva_usd, total_usd, nota, renglones_json, registrado_en, registrado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(modo, prov.id, prov.rif, prov.nombre, factura, control, fecha, calc.subtotal_usd, calc.iva_usd, calc.total_usd, texto(b.nota, 300) || null, JSON.stringify(renglones), new Date().toISOString(), u.id)];
  for (const [pid, e] of entradas)
    pasos.push(guardaSaldo(db, pid, sal.get(pid)!),
      movimiento(db, { producto_id: pid, modo, tipo: "COMPRA", cantidad_milli: e.cant, valor_usd: e.valor, compra_ref: [prov.id, factura], fecha, uid: u.id }),
      db.prepare(`UPDATE catalogo SET controla_stock = 1 WHERE id = ?`).bind(pid), costoPromedio(db, pid));
  try { await db.batch(pasos); }
  catch (e) {
    if (esUnico(e)) return falla(c, 409, "Ya registraste esa factura de este proveedor.");
    if (CAMBIO.test(String(e))) return falla(c, 409, "Las existencias cambiaron mientras guardabas. Revisa y vuelve a intentarlo.");
    throw e;
  }
  const f = await db.prepare(`SELECT id FROM compras WHERE proveedor_id = ? AND factura_numero = ? AND estado = 'REGISTRADA'`).bind(prov.id, factura).first<{ id: number }>();
  await auditar(c, u.id, "COMPRA_REGISTRAR", `${prov.rif} factura ${factura}`);
  return c.json({ ok: true, id: f?.id, activados: prods.filter((p) => !p.controla_stock).map((p) => p.nombre) });
});

compras.post("/:id/anular", requiereAdmin, async (c) => {
  const db = c.env.DB, id = idParam(c), u = c.get("usuario"), motivo = texto((await leerJson(c)).motivo, 200);
  if (motivo.length < 5) return falla(c, 400, "Escribe el motivo de la anulación (mínimo 5 letras).");
  const co = await db.prepare(`SELECT id, estado FROM compras WHERE id = ?`).bind(id).first<Fila>();
  if (!co) return falla(c, 404, "Compra no encontrada.");
  if (co.estado !== "REGISTRADA") return falla(c, 409, "Esta compra ya estaba anulada.");
  const { results: movs } = await db.prepare(`SELECT m.id, m.producto_id, m.cantidad_milli, m.valor_usd, c.nombre FROM movimientos_stock m JOIN catalogo c ON c.id = m.producto_id
    WHERE m.compra_id = ? AND m.tipo = 'COMPRA'`).bind(id).all<Fila>();
  const pids = movs.map((m) => m.producto_id), sal = await saldos(db, pids);
  const { results: ult } = pids.length
    ? await db.prepare(`SELECT producto_id, MAX(id) AS ultimo FROM movimientos_stock WHERE producto_id IN (${pids.map(() => "?").join(",")}) GROUP BY producto_id`).bind(...pids).all<Fila>()
    : { results: [] as Fila[] };
  for (const m of movs) {
    if (ult.find((x) => x.producto_id === m.producto_id)?.ultimo !== m.id || sal.get(m.producto_id)!.stock < m.cantidad_milli)
      return falla(c, 409, `Después de esta compra hubo otros movimientos de «${m.nombre}»: no se puede anular. Corrígelo con un ajuste.`);
  }
  const pasos = [
    db.prepare(`INSERT INTO verificaciones (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM compras WHERE id = ? AND estado = 'REGISTRADA')`).bind(id),
    db.prepare(`UPDATE compras SET estado = 'ANULADA', anulado_en = ?, anulado_por = ?, motivo_anulacion = ? WHERE id = ? AND estado = 'REGISTRADA'`).bind(new Date().toISOString(), u.id, motivo, id),
  ];
  const modo = await modoActual(db), fecha = fechaCaracas();
  for (const m of movs)
    pasos.push(guardaSaldo(db, m.producto_id, sal.get(m.producto_id)!),
      movimiento(db, { producto_id: m.producto_id, modo, tipo: "ANULACION_COMPRA", cantidad_milli: -m.cantidad_milli, valor_usd: -m.valor_usd, compra_id: id, nota: "Compra anulada", fecha, uid: u.id }),
      costoPromedio(db, m.producto_id));
  try { await db.batch(pasos); }
  catch (e) { if (CAMBIO.test(String(e))) return falla(c, 409, "La compra o las existencias cambiaron mientras anulabas. Revisa y vuelve a intentarlo."); throw e; }
  await auditar(c, u.id, "COMPRA_ANULAR", `${id}: ${motivo}`);
  return c.json({ ok: true });
});

export default compras;
