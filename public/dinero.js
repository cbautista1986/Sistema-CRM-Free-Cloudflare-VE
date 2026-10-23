// DINERO: toda la matemática de montos vive aquí y la usan el servidor Y el navegador (una sola fuente de verdad).
// Reglas: montos en centavos enteros · tasa BCV en "e8" (Bs por USD × 100.000.000) · redondeo siempre "mitad hacia arriba".
// Nunca se usan decimales de coma flotante para dinero.
const E8 = 100000000;

const seguro = (n) => {
  if (!Number.isSafeInteger(n)) throw new Error("Los montos son demasiado grandes.");
  return n;
};
// round(a × b ÷ div) exacto (BigInt), mitad hacia arriba. Solo para valores no negativos.
export const redondear = (a, b, div) => seguro(Number((BigInt(a) * BigInt(b) + BigInt(div) / 2n) / BigInt(div)));

const limpio = (v) => String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");

// "12,50" o "12.5" -> 1250 centavos. null si está vacío, NaN si no es un monto válido (máximo 9 dígitos enteros).
export function aCentavos(v) {
  const t = limpio(v);
  if (t === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return NaN;
  const [e, d = ""] = t.split(".");
  return Number(e) * 100 + Number(d.padEnd(2, "0"));
}

// "123,45" o "123.4567" -> 12345000000 (e8). null si está vacío, NaN si no es válido o es 0.
export function aTasaE8(v) {
  const t = limpio(v);
  if (t === "") return null;
  if (!/^\d{1,7}(\.\d{1,8})?$/.test(t)) return NaN;
  const [e, d = ""] = t.split(".");
  const n = Number(e) * E8 + Number(d.padEnd(8, "0"));
  return n > 0 ? n : NaN;
}

// "1,5" -> 1500 (milésimas de unidad). Máximo 3 decimales. null si vacío, NaN si inválido o 0.
export function aCantidadMilli(v) {
  const t = limpio(v);
  if (t === "") return null;
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(t)) return NaN;
  const [e, d = ""] = t.split(".");
  const n = Number(e) * 1000 + Number(d.padEnd(3, "0"));
  return n > 0 && n <= 1e9 ? n : NaN;
}

export const cantidadTexto = (milli) => (milli / 1000).toString().replace(".", ",");
export const tasaTexto = (e8) => (e8 / E8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");

// lineas: [{ cantidad_milli, precio_usd (centavos por unidad), alicuota_cent (% × 100), costo_usd? (centavos por unidad) }]
// Devuelve montos por renglón, impuestos por alícuota y totales, en USD y en Bs (los de Bs son los legales).
// Con tasaE8 vacío (borrador sin tasa) los campos en Bs quedan en null.
export function calcular(lineas, tasaE8) {
  const conTasa = Number.isInteger(tasaE8) && tasaE8 > 0;
  const grupos = new Map();
  let costo = 0;
  const renglones = lineas.map((l) => {
    const monto_usd = redondear(l.cantidad_milli, l.precio_usd, 1000);
    const monto_bs = conTasa ? redondear(monto_usd, tasaE8, E8) : null;
    costo = seguro(costo + redondear(l.cantidad_milli, l.costo_usd ?? 0, 1000));
    const g = grupos.get(l.alicuota_cent) ?? { alicuota_cent: l.alicuota_cent, base_usd: 0, base_bs: 0 };
    g.base_usd = seguro(g.base_usd + monto_usd);
    if (conTasa) g.base_bs = seguro(g.base_bs + monto_bs);
    grupos.set(l.alicuota_cent, g);
    return { monto_usd, monto_bs };
  });
  const impuestos = [...grupos.values()].sort((a, b) => a.alicuota_cent - b.alicuota_cent).map((g) => ({
    alicuota_cent: g.alicuota_cent,
    base_usd: g.base_usd, iva_usd: redondear(g.base_usd, g.alicuota_cent, 10000),
    base_bs: conTasa ? g.base_bs : null, iva_bs: conTasa ? redondear(g.base_bs, g.alicuota_cent, 10000) : null,
  }));
  const suma = (k) => seguro(impuestos.reduce((s, i) => s + (i[k] ?? 0), 0));
  const subtotal_usd = suma("base_usd"), iva_usd = suma("iva_usd");
  const subtotal_bs = conTasa ? suma("base_bs") : null, iva_bs = conTasa ? suma("iva_bs") : null;
  return { renglones, impuestos, costo_total_usd: costo, subtotal_usd, iva_usd, total_usd: seguro(subtotal_usd + iva_usd),
    subtotal_bs, iva_bs, total_bs: conTasa ? seguro(subtotal_bs + iva_bs) : null };
}
