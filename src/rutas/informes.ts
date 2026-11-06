// Módulo INFORMES (Fase 6): libros de ventas y compras, resumen mensual de IVA, ganancias, por cobrar, inventario valorizado: /api/informes
// SOLO LECTURA: ningún informe escribe en la base. Todo sale de los mismos datos que ya guardan los demás módulos
// (el saldo y las existencias se calculan, no se guardan). Solo se incluyen documentos del modo actual (práctica o real).
import { Hono } from "hono";
import { redondear } from "../../public/dinero.js";
import { PAGADO, falla, fechaCaracas, modoActual, requiereSesion, type Ctx, type Env } from "../comun";

const informes = new Hono<Env>();
informes.use("*", requiereSesion);
type Fila = Record<string, any>;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (f: string) => FECHA.test(f) && new Date(`${f}T12:00:00Z`).toISOString().slice(0, 10) === f;

// Rango ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (por defecto: del 1.º del mes en curso a hoy, hora de Caracas)
function rango(c: Ctx): { desde: string; hasta: string } | string {
  const hoy = fechaCaracas();
  const desde = c.req.query("desde") ?? `${hoy.slice(0, 8)}01`, hasta = c.req.query("hasta") ?? hoy;
  if (!fechaValida(desde) || !fechaValida(hasta)) return "Las fechas deben tener la forma AAAA-MM-DD.";
  if (desde > hasta) return "La fecha «desde» no puede ser posterior a «hasta».";
  if (Date.parse(hasta) - Date.parse(desde) > 366 * 86400000) return "El periodo no puede pasar de un año.";
  return { desde, hasta };
}
const suma = (xs: Fila[], k: string) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);

// ---------------------------------------------------------------- libro de ventas (facturas, montos legales en Bs)
informes.get("/ventas", async (c) => {
  const r = rango(c); if (typeof r === "string") return falla(c, 400, r);
  const modo = await modoActual(c.env.DB), db = c.env.DB;
  const [docs, imp] = await Promise.all([
    db.prepare(`SELECT id, numero, control_interno, control_fiscal, fecha_emision, cliente_rif, cliente_nombre, estado, tasa_e8, total_usd, total_bs
        FROM documentos WHERE tipo = 'FACTURA' AND modo = ? AND estado IN ('EMITIDO', 'ANULADO') AND fecha_emision BETWEEN ? AND ? ORDER BY numero, id`)
      .bind(modo, r.desde, r.hasta).all<Fila>(),
    db.prepare(`SELECT i.documento_id, i.alicuota_cent, i.base_bs, i.iva_bs FROM documento_impuestos i JOIN documentos d ON d.id = i.documento_id
        WHERE d.tipo = 'FACTURA' AND d.modo = ? AND d.estado IN ('EMITIDO', 'ANULADO') AND d.fecha_emision BETWEEN ? AND ?`)
      .bind(modo, r.desde, r.hasta).all<Fila>(),
  ]);
  const porDoc = new Map<number, Fila[]>();
  for (const i of imp.results) porDoc.set(i.documento_id, [...(porDoc.get(i.documento_id) ?? []), i]);
  const filas: Fila[] = docs.results.map((d) => ({ ...d, impuestos: (porDoc.get(d.id) ?? []).map((i) => ({ alicuota_cent: i.alicuota_cent, base_bs: i.base_bs, iva_bs: i.iva_bs })) }));
  // Totales: las anuladas se listan (para que la numeración no tenga saltos) pero NO suman.
  const vigentes = filas.filter((f) => f.estado === "EMITIDO"), porAlicuota = new Map<number, { base_bs: number; iva_bs: number }>();
  for (const f of vigentes) for (const i of f.impuestos) {
    const t = porAlicuota.get(i.alicuota_cent) ?? { base_bs: 0, iva_bs: 0 };
    porAlicuota.set(i.alicuota_cent, { base_bs: t.base_bs + i.base_bs, iva_bs: t.iva_bs + i.iva_bs });
  }
  const alicuotas = [...porAlicuota].sort((a, b) => a[0] - b[0]).map(([alicuota_cent, t]) => ({ alicuota_cent, ...t }));
  return c.json({ ok: true, modo, desde: r.desde, hasta: r.hasta, filas, alicuotas, n_vigentes: vigentes.length, n_anuladas: filas.length - vigentes.length,
    total_bs: suma(vigentes, "total_bs"), total_usd: suma(vigentes, "total_usd") });
});

// ---------------------------------------------------------------- libro de compras (Bs con la tasa de la fecha de la factura; USD como referencia)
// Las compras registradas antes de que se guardara la tasa (tasa_e8 vacía) salen sin montos en Bs: no se les inventa una tasa.
informes.get("/compras", async (c) => {
  const r = rango(c); if (typeof r === "string") return falla(c, 400, r);
  const modo = await modoActual(c.env.DB), db = c.env.DB;
  const [docs, imp] = await Promise.all([
    db.prepare(`SELECT id, fecha, proveedor_rif, proveedor_nombre, factura_numero, control_numero, estado, tasa_e8, subtotal_usd, iva_usd, total_usd, subtotal_bs, iva_bs, total_bs
        FROM compras WHERE modo = ? AND fecha BETWEEN ? AND ? ORDER BY fecha, id`).bind(modo, r.desde, r.hasta).all<Fila>(),
    db.prepare(`SELECT i.compra_id, i.alicuota_cent, i.base_bs, i.iva_bs FROM compra_impuestos i JOIN compras c ON c.id = i.compra_id
        WHERE c.modo = ? AND c.fecha BETWEEN ? AND ?`).bind(modo, r.desde, r.hasta).all<Fila>(),
  ]);
  const porCompra = new Map<number, Fila[]>();
  for (const i of imp.results) porCompra.set(i.compra_id, [...(porCompra.get(i.compra_id) ?? []), i]);
  const filas: Fila[] = docs.results.map((d) => ({ ...d, impuestos: (porCompra.get(d.id) ?? []).map((i) => ({ alicuota_cent: i.alicuota_cent, base_bs: i.base_bs, iva_bs: i.iva_bs })) }));
  const vigentes = filas.filter((f) => f.estado === "REGISTRADA"), porAlicuota = new Map<number, { base_bs: number; iva_bs: number }>();
  for (const f of vigentes) for (const i of f.impuestos) {
    const t = porAlicuota.get(i.alicuota_cent) ?? { base_bs: 0, iva_bs: 0 };
    porAlicuota.set(i.alicuota_cent, { base_bs: t.base_bs + i.base_bs, iva_bs: t.iva_bs + i.iva_bs });
  }
  const alicuotas = [...porAlicuota].sort((a, b) => a[0] - b[0]).map(([alicuota_cent, t]) => ({ alicuota_cent, ...t }));
  return c.json({ ok: true, modo, desde: r.desde, hasta: r.hasta, filas, alicuotas, n_vigentes: vigentes.length, n_anuladas: filas.length - vigentes.length,
    n_sin_tasa: vigentes.filter((f) => f.tasa_e8 == null).length,
    subtotal_bs: suma(vigentes, "subtotal_bs"), iva_bs: suma(vigentes, "iva_bs"), total_bs: suma(vigentes, "total_bs"),
    subtotal_usd: suma(vigentes, "subtotal_usd"), iva_usd: suma(vigentes, "iva_usd"), total_usd: suma(vigentes, "total_usd") });
});

// ---------------------------------------------------------------- resumen mensual de IVA: débito fiscal (ventas) - crédito fiscal (compras), en Bs
// Es una GUÍA para el contador, no la declaración: no incluye retenciones, excedentes de meses anteriores ni notas de crédito o débito.
informes.get("/resumen-iva", async (c) => {
  const r = rango(c); if (typeof r === "string") return falla(c, 400, r);
  const modo = await modoActual(c.env.DB), db = c.env.DB;
  const [ventas, compras, sinTasa] = await Promise.all([
    db.prepare(`SELECT substr(d.fecha_emision, 1, 7) AS mes, SUM(CASE WHEN i.alicuota_cent > 0 THEN i.base_bs ELSE 0 END) AS gravadas_bs,
        SUM(CASE WHEN i.alicuota_cent = 0 THEN i.base_bs ELSE 0 END) AS exentas_bs, SUM(i.iva_bs) AS iva_bs
        FROM documento_impuestos i JOIN documentos d ON d.id = i.documento_id
        WHERE d.tipo = 'FACTURA' AND d.estado = 'EMITIDO' AND d.modo = ? AND d.fecha_emision BETWEEN ? AND ? GROUP BY mes`).bind(modo, r.desde, r.hasta).all<Fila>(),
    db.prepare(`SELECT substr(c.fecha, 1, 7) AS mes, SUM(CASE WHEN i.alicuota_cent > 0 THEN i.base_bs ELSE 0 END) AS gravadas_bs,
        SUM(CASE WHEN i.alicuota_cent = 0 THEN i.base_bs ELSE 0 END) AS exentas_bs, SUM(i.iva_bs) AS iva_bs
        FROM compra_impuestos i JOIN compras c ON c.id = i.compra_id
        WHERE c.estado = 'REGISTRADA' AND c.modo = ? AND c.fecha BETWEEN ? AND ? GROUP BY mes`).bind(modo, r.desde, r.hasta).all<Fila>(),
    db.prepare(`SELECT substr(fecha, 1, 7) AS mes, COUNT(*) AS n FROM compras WHERE estado = 'REGISTRADA' AND tasa_e8 IS NULL AND modo = ? AND fecha BETWEEN ? AND ? GROUP BY mes`)
      .bind(modo, r.desde, r.hasta).all<Fila>(),
  ]);
  const V = new Map(ventas.results.map((x) => [x.mes, x])), C = new Map(compras.results.map((x) => [x.mes, x])), S = new Map(sinTasa.results.map((x) => [x.mes, x.n]));
  const meses = [...new Set([...V.keys(), ...C.keys(), ...S.keys()])].sort();
  const filas = meses.map((mes) => {
    const v = V.get(mes) ?? {}, k = C.get(mes) ?? {}, debito_bs = v.iva_bs ?? 0, credito_bs = k.iva_bs ?? 0;
    return { mes, ventas_gravadas_bs: v.gravadas_bs ?? 0, ventas_exentas_bs: v.exentas_bs ?? 0, debito_bs, compras_gravadas_bs: k.gravadas_bs ?? 0, compras_exentas_bs: k.exentas_bs ?? 0,
      credito_bs, diferencia_bs: debito_bs - credito_bs, compras_sin_tasa: S.get(mes) ?? 0 };
  });
  const t = (k: string) => suma(filas, k);
  return c.json({ ok: true, modo, desde: r.desde, hasta: r.hasta, filas, total: { ventas_gravadas_bs: t("ventas_gravadas_bs"), ventas_exentas_bs: t("ventas_exentas_bs"), debito_bs: t("debito_bs"),
    compras_gravadas_bs: t("compras_gravadas_bs"), compras_exentas_bs: t("compras_exentas_bs"), credito_bs: t("credito_bs"), diferencia_bs: t("diferencia_bs"), compras_sin_tasa: t("compras_sin_tasa") } });
});

// ---------------------------------------------------------------- ganancias (privadas: solo para el dueño)
// Misma fórmula que Inicio (documentos/resumen): ganancia = monto del renglón - costo (el costo es opcional).
const COSTO = `((r.cantidad_milli * COALESCE(r.costo_usd, 0) + 500) / 1000)`;
informes.get("/ganancias", async (c) => {
  const r = rango(c); if (typeof r === "string") return falla(c, 400, r);
  const modo = await modoActual(c.env.DB), db = c.env.DB;
  const base = `FROM documento_renglones r JOIN documentos d ON d.id = r.documento_id
    WHERE d.tipo = 'FACTURA' AND d.estado = 'EMITIDO' AND d.modo = ? AND d.fecha_emision BETWEEN ? AND ?`;
  const [tipos, items, clientes] = await Promise.all([
    db.prepare(`SELECT r.tipo, SUM(r.monto_usd) AS ingresos, SUM(${COSTO}) AS costos ${base} GROUP BY r.tipo`).bind(modo, r.desde, r.hasta).all<Fila>(),
    db.prepare(`SELECT r.tipo, MIN(r.descripcion) AS nombre, SUM(r.cantidad_milli) AS cantidad_milli, SUM(r.monto_usd) AS ingresos, SUM(${COSTO}) AS costos ${base}
        GROUP BY r.tipo, COALESCE(CAST(r.catalogo_id AS TEXT), r.descripcion) ORDER BY SUM(r.monto_usd) - SUM(${COSTO}) DESC LIMIT 100`).bind(modo, r.desde, r.hasta).all<Fila>(),
    db.prepare(`SELECT COALESCE(d.cliente_rif, '') AS rif, MIN(d.cliente_nombre) AS nombre, SUM(r.monto_usd) AS ingresos, SUM(${COSTO}) AS costos ${base}
        GROUP BY COALESCE(d.cliente_rif, '') ORDER BY SUM(r.monto_usd) - SUM(${COSTO}) DESC LIMIT 100`).bind(modo, r.desde, r.hasta).all<Fila>(),
  ]);
  const con = (f: Fila): Fila => ({ ...f, ganancia: f.ingresos - f.costos });
  const t = (x: string) => con(tipos.results.find((f) => f.tipo === x) ?? { tipo: x, ingresos: 0, costos: 0 });
  const servicios = t("SERVICIO"), productos = t("PRODUCTO");
  return c.json({ ok: true, modo, desde: r.desde, hasta: r.hasta, servicios, productos,
    total: { ingresos: servicios.ingresos + productos.ingresos, costos: servicios.costos + productos.costos, ganancia: servicios.ganancia + productos.ganancia },
    por_item: items.results.map(con), por_cliente: clientes.results.map(con) });
});

// ---------------------------------------------------------------- cuentas por cobrar: estado de cuenta por cliente y antigüedad
const TRAMOS = [["SIN_VENCER", "Al día"], ["D1_30", "1 a 30 días"], ["D31_60", "31 a 60 días"], ["D61_90", "61 a 90 días"], ["D91_MAS", "Más de 90 días"]] as const;
const tramo = (atraso: number) => (atraso <= 0 ? "SIN_VENCER" : atraso <= 30 ? "D1_30" : atraso <= 60 ? "D31_60" : atraso <= 90 ? "D61_90" : "D91_MAS");
informes.get("/por-cobrar", async (c) => {
  const modo = await modoActual(c.env.DB), hoy = fechaCaracas();
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (SELECT d.id, d.numero, d.cliente_rif, d.cliente_nombre, d.fecha_emision, d.vence_el, d.condicion, d.total_usd, ${PAGADO} AS pagado_usd
       FROM documentos d WHERE d.tipo = 'FACTURA' AND d.estado = 'EMITIDO' AND d.modo = ?) WHERE total_usd - pagado_usd > 0 ORDER BY cliente_nombre COLLATE NOCASE, fecha_emision, id`
  ).bind(modo).all<Fila>();
  const vacios = () => Object.fromEntries(TRAMOS.map(([k]) => [k, 0])) as Record<string, number>;
  const clientes = new Map<string, Fila>(), tramos = vacios();
  for (const f of results) {
    const atraso = f.vence_el && f.vence_el < hoy ? Math.round((Date.parse(hoy) - Date.parse(f.vence_el)) / 86400000) : 0, saldo = f.total_usd - f.pagado_usd, t = tramo(atraso);
    const k = f.cliente_rif ?? "", cli = clientes.get(k) ?? { rif: k, nombre: f.cliente_nombre, saldo_usd: 0, tramos: vacios(), facturas: [] };
    cli.saldo_usd += saldo; cli.tramos[t] += saldo; tramos[t] += saldo;
    cli.facturas.push({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, vence_el: f.vence_el, condicion: f.condicion, total_usd: f.total_usd, pagado_usd: f.pagado_usd, saldo_usd: saldo, dias_atraso: atraso, tramo: t });
    clientes.set(k, cli);
  }
  const lista = [...clientes.values()].sort((a, b) => b.saldo_usd - a.saldo_usd);
  return c.json({ ok: true, modo, hoy, tramos: TRAMOS.map(([clave, etiqueta]) => ({ clave, etiqueta, saldo_usd: tramos[clave] })),
    total_usd: lista.reduce((s, x) => s + x.saldo_usd, 0), n_facturas: results.length, clientes: lista });
});

// ---------------------------------------------------------------- inventario valorizado y movimientos del periodo
informes.get("/inventario", async (c) => {
  const r = rango(c); if (typeof r === "string") return falla(c, 400, r);
  const modo = await modoActual(c.env.DB), db = c.env.DB;
  const [prod, movs, resumen] = await Promise.all([
    db.prepare(`SELECT c.id, c.codigo, c.nombre, COALESCE(SUM(m.cantidad_milli), 0) AS stock_milli, COALESCE(SUM(m.valor_usd), 0) AS valor_usd
        FROM catalogo c LEFT JOIN movimientos_stock m ON m.producto_id = c.id AND m.modo = ?
        WHERE c.tipo = 'PRODUCTO' AND c.controla_stock = 1 GROUP BY c.id HAVING c.activo = 1 OR stock_milli <> 0 ORDER BY c.nombre COLLATE NOCASE`).bind(modo).all<Fila>(),
    db.prepare(`SELECT m.id, m.fecha, c.nombre AS producto, m.tipo, m.motivo, m.cantidad_milli, m.valor_usd FROM movimientos_stock m JOIN catalogo c ON c.id = m.producto_id
        WHERE m.modo = ? AND m.fecha BETWEEN ? AND ? ORDER BY m.fecha DESC, m.id DESC LIMIT 300`).bind(modo, r.desde, r.hasta).all<Fila>(),
    db.prepare(`SELECT tipo, COUNT(*) AS n, SUM(valor_usd) AS valor_usd FROM movimientos_stock WHERE modo = ? AND fecha BETWEEN ? AND ? GROUP BY tipo ORDER BY tipo`)
      .bind(modo, r.desde, r.hasta).all<Fila>(),
  ]);
  const items = prod.results.map((p) => ({ ...p, costo_prom_usd: p.stock_milli > 0 ? redondear(1000, p.valor_usd, p.stock_milli) : 0 }));
  const nMovs = suma(resumen.results, "n");
  return c.json({ ok: true, modo, desde: r.desde, hasta: r.hasta, items, valor_total_usd: suma(items, "valor_usd"), movimientos: movs.results,
    movimientos_n: nMovs, movimientos_recortados: nMovs > movs.results.length, resumen_movimientos: resumen.results });
});

export default informes;
