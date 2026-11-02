// Módulo EXISTENCIAS: lista, movimientos, carga directa y ajustes: /api/existencias
// Las existencias se calculan sumando movimientos (nunca se guardan sueltas). Cargar y ajustar es solo del administrador.
import { Hono } from "hono";
import { aCantidadMilli, aCentavos, redondear } from "../../public/dinero.js";
import { auditar, falla, fechaCaracas, idParam, leerJson, modoActual, requiereAdmin, requiereSesion, texto, type Env } from "../comun";
import { costoPromedio, guardaSaldo, movimiento, saldos, valorEntradaAlPromedio, valorSalida } from "../stock";

const existencias = new Hono<Env>();
existencias.use("*", requiereSesion);
type Fila = Record<string, any>;
const MOTIVOS: Record<string, 1 | -1> = { DANADO: -1, PERDIDO: -1, GARANTIA: -1, USO_INTERNO: -1, SOBRANTE: 1 };
const CAMBIO = /CHECK constraint failed/;

const estadoStock = (r: Fila) => (r.stock_milli <= 0 ? "AGOTADO" : r.stock_minimo_milli != null && r.stock_milli <= r.stock_minimo_milli ? "BAJO" : "OK");
const LISTA = `SELECT c.id, c.codigo, c.nombre, c.activo, c.stock_minimo_milli, c.costo_centavos, c.precio_centavos,
    COALESCE(SUM(m.cantidad_milli), 0) AS stock_milli, COALESCE(SUM(m.valor_usd), 0) AS valor_usd
  FROM catalogo c LEFT JOIN movimientos_stock m ON m.producto_id = c.id
  WHERE c.tipo = 'PRODUCTO' AND c.controla_stock = 1 AND c.activo = 1 GROUP BY c.id ORDER BY c.nombre COLLATE NOCASE`;

existencias.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(LISTA).all<Fila>();
  const items: Fila[] = results.map((r) => ({ ...r, estado: estadoStock(r) }));
  return c.json({ ok: true, items, valor_total_usd: items.reduce((s, r) => s + r.valor_usd, 0) });
});

existencias.get("/alertas", async (c) => {
  const { results } = await c.env.DB.prepare(LISTA).all<Fila>();
  const malos = results.map((r) => ({ id: r.id, nombre: r.nombre, stock_milli: r.stock_milli, estado: estadoStock(r) })).filter((r) => r.estado !== "OK");
  return c.json({ ok: true, agotados: malos.filter((r) => r.estado === "AGOTADO").length, bajos: malos.filter((r) => r.estado === "BAJO").length, lista: malos.slice(0, 5) });
});

existencias.get("/:id/movimientos", async (c) => {
  const id = idParam(c), db = c.env.DB;
  const p = await db.prepare(`SELECT id, codigo, nombre, tipo, controla_stock, stock_minimo_milli, costo_centavos FROM catalogo WHERE id = ?`).bind(id).first<Fila>();
  if (!p || p.tipo !== "PRODUCTO") return falla(c, 404, "Producto no encontrado.");
  const s = (await saldos(db, [id])).get(id)!;
  const { results } = await db.prepare(
    `SELECT id, tipo, motivo, cantidad_milli, valor_usd, documento_id, compra_id, nota, fecha FROM movimientos_stock WHERE producto_id = ? ORDER BY id DESC LIMIT 100`).bind(id).all();
  return c.json({ ok: true, producto: p, stock_milli: s.stock, valor_usd: s.valor, movimientos: results });
});

// Carga directa: existencias que entran SIN factura de compra (inventario inicial, producción propia, etc.)
existencias.post("/carga", requiereAdmin, async (c) => {
  const db = c.env.DB, u = c.get("usuario"), b = await leerJson(c), id = Number(b.producto_id) || 0;
  const cant = aCantidadMilli(b.cantidad), costo = aCentavos(b.costo_usd);
  if (cant === null || Number.isNaN(cant)) return falla(c, 400, "Escribe la cantidad (ejemplos: 10 o 2,5).");
  if (!costo || Number.isNaN(costo)) return falla(c, 400, "Escribe lo que cuesta cada unidad en USD (ejemplo: 3,50).");
  const p = await db.prepare(`SELECT id, tipo, controla_stock, activo FROM catalogo WHERE id = ?`).bind(id).first<Fila>();
  if (!p || p.tipo !== "PRODUCTO") return falla(c, 404, "Producto no encontrado.");
  const s = (await saldos(db, [id])).get(id)!;
  let valor: number; try { valor = redondear(cant, costo, 1000); } catch (e) { return falla(c, 400, (e as Error).message); }
  try {
    await db.batch([guardaSaldo(db, id, s),
      movimiento(db, { producto_id: id, modo: await modoActual(db), tipo: "CARGA", cantidad_milli: cant, valor_usd: valor, nota: texto(b.nota, 200) || null, fecha: fechaCaracas(), uid: u.id }),
      db.prepare(`UPDATE catalogo SET controla_stock = 1 WHERE id = ?`).bind(id), costoPromedio(db, id)]);
  } catch (e) { if (CAMBIO.test(String(e))) return falla(c, 409, "Las existencias cambiaron mientras guardabas. Revisa y vuelve a intentarlo."); throw e; }
  await auditar(c, u.id, "STOCK_CARGA", `producto ${id} +${cant}`);
  return c.json({ ok: true, stock_milli: s.stock + cant, activado: !p.controla_stock });
});

existencias.post("/ajuste", requiereAdmin, async (c) => {
  const db = c.env.DB, u = c.get("usuario"), b = await leerJson(c), id = Number(b.producto_id) || 0, motivo = texto(b.motivo, 20);
  const signo = MOTIVOS[motivo], cant = aCantidadMilli(b.cantidad), nota = texto(b.nota, 200);
  if (!signo) return falla(c, 400, "Elige el motivo del ajuste.");
  if (cant === null || Number.isNaN(cant)) return falla(c, 400, "Escribe la cantidad (ejemplos: 2 o 0,5).");
  if (nota.length < 5) return falla(c, 400, "Explica el ajuste en la nota (mínimo 5 letras).");
  const p = await db.prepare(`SELECT id, nombre, tipo, controla_stock, costo_centavos FROM catalogo WHERE id = ?`).bind(id).first<Fila>();
  if (!p || p.tipo !== "PRODUCTO") return falla(c, 404, "Producto no encontrado.");
  if (!p.controla_stock) return falla(c, 409, "Este producto no controla existencias: primero carga su cantidad.");
  const s = (await saldos(db, [id])).get(id)!;
  if (signo < 0 && cant > s.stock) return falla(c, 409, `No puedes sacar más de lo que hay (hay ${s.stock / 1000}).`);
  let valor: number; try { valor = signo < 0 ? -valorSalida(s, cant) : valorEntradaAlPromedio(s, cant, p.costo_centavos); } catch (e) { return falla(c, 400, (e as Error).message); }
  try {
    await db.batch([guardaSaldo(db, id, s),
      movimiento(db, { producto_id: id, modo: await modoActual(db), tipo: "AJUSTE", motivo, cantidad_milli: signo * cant, valor_usd: valor, nota, fecha: fechaCaracas(), uid: u.id }),
      costoPromedio(db, id)]);
  } catch (e) { if (CAMBIO.test(String(e))) return falla(c, 409, "Las existencias cambiaron mientras guardabas. Revisa y vuelve a intentarlo."); throw e; }
  await auditar(c, u.id, "STOCK_AJUSTE", `producto ${id} ${motivo} ${signo * cant}`);
  return c.json({ ok: true, stock_milli: s.stock + signo * cant });
});

export default existencias;
