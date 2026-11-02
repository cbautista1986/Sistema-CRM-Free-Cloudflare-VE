// Existencias: el saldo NUNCA se guarda, se calcula sumando movimientos. Costo = promedio ponderado (valor / existencias).
// Todo movimiento se escribe junto con una "guarda": si las existencias cambiaron mientras se preparaba, el lote entero se deshace.
import { redondear } from "../public/dinero.js";

export type Saldo = { stock: number; valor: number }; // stock en milésimas de unidad, valor en centavos de USD

// Existencias y valor de varios productos con UNA sola consulta (el plan gratis limita las consultas por petición).
export async function saldos(db: D1Database, ids: number[]): Promise<Map<number, Saldo>> {
  const mapa = new Map<number, Saldo>(ids.map((id) => [id, { stock: 0, valor: 0 }]));
  if (!ids.length) return mapa;
  const { results } = await db.prepare(
    `SELECT producto_id, COALESCE(SUM(cantidad_milli), 0) AS stock, COALESCE(SUM(valor_usd), 0) AS valor
     FROM movimientos_stock WHERE producto_id IN (${ids.map(() => "?").join(",")}) GROUP BY producto_id`
  ).bind(...ids).all<{ producto_id: number; stock: number; valor: number }>();
  for (const r of results) mapa.set(r.producto_id, { stock: r.stock, valor: r.valor });
  return mapa;
}

// Valor que "sale" al retirar qty: promedio ponderado. Si sale todo, se lleva todo el valor (nunca sobra ni falta un centavo).
export const valorSalida = (s: Saldo, qty: number) => (s.stock <= 0 ? 0 : qty >= s.stock ? s.valor : redondear(qty, s.valor, s.stock));

// Valor de una entrada "al costo actual" (sobrantes): promedio actual, o el último costo conocido si no hay existencias.
export const valorEntradaAlPromedio = (s: Saldo, qty: number, costoUnitario: number | null) =>
  s.stock > 0 ? redondear(qty, s.valor, s.stock) : redondear(qty, costoUnitario ?? 0, 1000);

export const guardaSaldo = (db: D1Database, id: number, s: Saldo) => db.prepare(
  `INSERT INTO verificaciones (ok) SELECT 0 WHERE
     (SELECT COALESCE(SUM(cantidad_milli), 0) FROM movimientos_stock WHERE producto_id = ?) <> ?
     OR (SELECT COALESCE(SUM(valor_usd), 0) FROM movimientos_stock WHERE producto_id = ?) <> ?`).bind(id, s.stock, id, s.valor);

export type Mov = { producto_id: number; modo: string; tipo: string; motivo?: string | null; cantidad_milli: number; valor_usd: number;
  documento_id?: number | null; compra_id?: number | null; compra_ref?: [number, string]; nota?: string | null; fecha: string; uid: number };

export const movimiento = (db: D1Database, m: Mov) => db.prepare(
  `INSERT INTO movimientos_stock (producto_id, modo, tipo, motivo, cantidad_milli, valor_usd, documento_id, compra_id, nota, fecha, creado_en, creado_por)
   VALUES (?, ?, ?, ?, ?, ?, ?, ${m.compra_ref ? "(SELECT id FROM compras WHERE proveedor_id = ? AND factura_numero = ? AND estado = 'REGISTRADA')" : "?"}, ?, ?, ?, ?)`
).bind(m.producto_id, m.modo, m.tipo, m.motivo ?? null, m.cantidad_milli, m.valor_usd, m.documento_id ?? null,
  ...(m.compra_ref ? m.compra_ref : [m.compra_id ?? null]), m.nota ?? null, m.fecha, new Date().toISOString(), m.uid);

// El costo del producto en el catálogo = promedio ponderado actual (valor / existencias), redondeado al centavo.
// Si no quedan existencias se conserva el último costo conocido.
export const costoPromedio = (db: D1Database, id: number) => db.prepare(
  `UPDATE catalogo SET costo_centavos = (SELECT CASE WHEN SUM(m.cantidad_milli) > 0 THEN (SUM(m.valor_usd) * 2000 + SUM(m.cantidad_milli)) / (2 * SUM(m.cantidad_milli))
     ELSE catalogo.costo_centavos END FROM movimientos_stock m WHERE m.producto_id = catalogo.id) WHERE id = ?`).bind(id);
