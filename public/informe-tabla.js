// Informes de la Fase 6, sin pantalla: convierte lo que devuelve /api/informes/* en un «modelo» de tablas y de ahí se sacan
// la vista del celular, el CSV y el PDF (los tres salen del MISMO modelo, así nunca dicen cosas distintas).
// Modelo: { clave, titulo, periodo, resumen: [[etiqueta, valor]], notas: [texto], secciones: [{ titulo, columnas: [{ t, der }], filas: [[texto]], totales: [[texto]] }] }
// Solo muestra números que ya calculó el servidor; aquí no se hace ninguna cuenta de dinero salvo sumas de la propia pantalla.
import { cantidadTexto } from "./dinero.js";

export const num = (c) => (c == null ? "" : (c / 100).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const nroFactura = (n) => (n == null ? "" : String(n).padStart(8, "0"));
const alicuota = (cent) => (cent === 0 ? "Exento" : `${cent / 100}%`);
const MOV = { COMPRA: "Compra", CARGA: "Carga", VENTA: "Venta", DEVOLUCION_VENTA: "Devolución de venta", ANULACION_COMPRA: "Anulación de compra", AJUSTE: "Ajuste" };
const MOTIVO = { DANADO: "Dañado", PERDIDO: "Perdido", GARANTIA: "Garantía", USO_INTERNO: "Uso interno", SOBRANTE: "Sobrante" };
const izq = (t) => ({ t }), der = (t) => ({ t, der: true });
const periodo = (r) => `Del ${fecha(r.desde)} al ${fecha(r.hasta)}`;

export const hoyCaracas = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const INFORMES = [
  { clave: "ventas", icono: "📒", nombre: "Libro de ventas", ayuda: "Facturas emitidas con base e IVA en bolívares", periodo: true },
  { clave: "compras", icono: "📕", nombre: "Libro de compras", ayuda: "Compras registradas con su IVA crédito fiscal", periodo: true },
  { clave: "ganancias", icono: "💰", nombre: "Ganancias", ayuda: "Productos y servicios, por ítem y por cliente", periodo: true },
  { clave: "por-cobrar", icono: "💵", nombre: "Cuentas por cobrar", ayuda: "Estado de cuenta por cliente y antigüedad", periodo: false },
  { clave: "inventario", icono: "📦", nombre: "Inventario valorizado", ayuda: "Existencias × costo promedio y movimientos", periodo: true },
];

function modeloVentas(r) {
  const alic = r.alicuotas.map((a) => a.alicuota_cent);
  const columnas = [izq("Fecha"), izq("N.º factura"), izq("Control interno"), izq("Control fiscal"), izq("RIF / Cédula"), izq("Cliente"), izq("Estado"),
    ...alic.flatMap((a) => [der(`Base ${alicuota(a)} (Bs)`), ...(a === 0 ? [] : [der(`IVA ${alicuota(a)} (Bs)`)])]), der("Total (Bs)"), der("Total (USD)")];
  const celdasImp = (f) => alic.flatMap((a) => { const i = f.impuestos.find((x) => x.alicuota_cent === a); return [num(i?.base_bs ?? 0), ...(a === 0 ? [] : [num(i?.iva_bs ?? 0)])]; });
  const filas = r.filas.map((f) => {
    const anulada = f.estado === "ANULADO";
    return [fecha(f.fecha_emision), nroFactura(f.numero), f.control_interno == null ? "" : nroFactura(f.control_interno), f.control_fiscal || "", f.cliente_rif || "", f.cliente_nombre || "",
      anulada ? "ANULADA" : "Emitida", ...(anulada ? [...alic.flatMap((a) => (a === 0 ? [""] : ["", ""])), "", ""] : [...celdasImp(f), num(f.total_bs), num(f.total_usd)])];
  });
  const totales = [["TOTAL", "", "", "", "", "", `${r.n_vigentes} emitida(s)`, ...alic.flatMap((a) => { const t = r.alicuotas.find((x) => x.alicuota_cent === a); return [num(t.base_bs), ...(a === 0 ? [] : [num(t.iva_bs)])]; }), num(r.total_bs), num(r.total_usd)]];
  return { clave: "ventas", titulo: "Libro de ventas", periodo: periodo(r),
    resumen: [["Facturas emitidas", String(r.n_vigentes)], ["Anuladas (no suman)", String(r.n_anuladas)], ["Total en Bs", num(r.total_bs)], ["Total en USD", num(r.total_usd)]],
    notas: ["Montos en bolívares: son los montos legales de cada factura. Las facturas anuladas se listan para que la numeración no tenga saltos, pero no suman.",
      "Las facturas no tienen N.º de control fiscal mientras no haya imprenta digital autorizada."],
    secciones: [{ titulo: "Facturas", columnas, filas, totales }] };
}

function modeloCompras(r) {
  return { clave: "compras", titulo: "Libro de compras", periodo: periodo(r),
    resumen: [["Compras registradas", String(r.n_vigentes)], ["Anuladas (no suman)", String(r.n_anuladas)], ["IVA crédito fiscal (USD)", num(r.iva_usd)], ["Total (USD)", num(r.total_usd)]],
    notas: ["Montos en dólares tal como se registró cada compra (las compras no guardan tasa BCV). Confirmar con el contador si el libro debe ir en bolívares."],
    secciones: [{ titulo: "Compras", columnas: [izq("Fecha"), izq("RIF proveedor"), izq("Proveedor"), izq("N.º factura"), izq("N.º control"), izq("Estado"), der("Base (USD)"), der("IVA (USD)"), der("Total (USD)")],
      filas: r.filas.map((f) => { const anulada = f.estado === "ANULADA"; return [fecha(f.fecha), f.proveedor_rif, f.proveedor_nombre, f.factura_numero, f.control_numero || "", anulada ? "ANULADA" : "Registrada",
        anulada ? "" : num(f.subtotal_usd), anulada ? "" : num(f.iva_usd), anulada ? "" : num(f.total_usd)]; }),
      totales: [["TOTAL", "", "", "", "", `${r.n_vigentes} registrada(s)`, num(r.subtotal_usd), num(r.iva_usd), num(r.total_usd)]] }] };
}

function modeloGanancias(r) {
  const cols = (primera) => [izq(primera), der("Ingresos (USD)"), der("Costos (USD)"), der("Ganancia (USD)")];
  const fila = (n, f) => [n, num(f.ingresos), num(f.costos), num(f.ganancia)];
  return { clave: "ganancias", titulo: "Ganancias", periodo: periodo(r),
    resumen: [["Ingresos", num(r.total.ingresos)], ["Costos", num(r.total.costos)], ["Ganancia", num(r.total.ganancia)]],
    notas: ["Informe privado del dueño: incluye costos. Ganancia = monto vendido (sin IVA) - costo del renglón; el costo es opcional, un renglón sin costo cuenta como ganancia completa. Solo facturas emitidas."],
    secciones: [
      { titulo: "Por tipo", columnas: cols("Tipo"), filas: [fila("Servicios", r.servicios), fila("Productos", r.productos)], totales: [fila("TOTAL", r.total)] },
      { titulo: "Por producto o servicio", columnas: [izq("Tipo"), izq("Nombre"), der("Cantidad"), der("Ingresos (USD)"), der("Costos (USD)"), der("Ganancia (USD)")],
        filas: r.por_item.map((f) => [f.tipo === "SERVICIO" ? "Servicio" : "Producto", f.nombre, cantidadTexto(f.cantidad_milli), num(f.ingresos), num(f.costos), num(f.ganancia)]), totales: [] },
      { titulo: "Por cliente", columnas: [izq("RIF / Cédula"), izq("Cliente"), der("Ingresos (USD)"), der("Costos (USD)"), der("Ganancia (USD)")],
        filas: r.por_cliente.map((f) => [f.rif, f.nombre || "", num(f.ingresos), num(f.costos), num(f.ganancia)]), totales: [] }] };
}

function modeloPorCobrar(r) {
  const filas = [];
  for (const c of r.clientes) {
    for (const f of c.facturas) filas.push([c.nombre || "", c.rif, nroFactura(f.numero), fecha(f.fecha_emision), fecha(f.vence_el), f.dias_atraso > 0 ? String(f.dias_atraso) : "", num(f.total_usd), num(f.pagado_usd), num(f.saldo_usd)]);
    if (c.facturas.length > 1) filas.push([`Subtotal ${c.nombre || ""}`, "", "", "", "", "", "", "", num(c.saldo_usd)]);
  }
  return { clave: "por-cobrar", titulo: "Cuentas por cobrar", periodo: `Al ${fecha(r.hoy)}`,
    resumen: [["Por cobrar", num(r.total_usd)], ["Facturas con saldo", String(r.n_facturas)], ["Clientes", String(r.clientes.length)]],
    notas: ["El saldo es el total de la factura menos los pagos vigentes (incluye abonos hechos al presupuesto de origen). La antigüedad cuenta los días pasados desde el vencimiento."],
    secciones: [
      { titulo: "Antigüedad de saldos", columnas: [izq("Tramo"), der("Saldo (USD)")], filas: r.tramos.map((t) => [t.etiqueta, num(t.saldo_usd)]), totales: [["TOTAL", num(r.total_usd)]] },
      { titulo: "Estado de cuenta por cliente", columnas: [izq("Cliente"), izq("RIF / Cédula"), izq("N.º factura"), izq("Emisión"), izq("Vence"), der("Días de atraso"), der("Total (USD)"), der("Pagado (USD)"), der("Saldo (USD)")],
        filas, totales: [["TOTAL", "", "", "", "", "", "", "", num(r.total_usd)]] }] };
}

function modeloInventario(r) {
  return { clave: "inventario", titulo: "Inventario valorizado", periodo: `Existencias a hoy · movimientos ${periodo(r).toLowerCase()}`,
    resumen: [["Valor del inventario (USD)", num(r.valor_total_usd)], ["Productos", String(r.items.length)], ["Movimientos del periodo", String(r.movimientos_n)]],
    notas: ["Valor = suma de los movimientos de cada producto (costo promedio ponderado). Solo productos con control de existencias.",
      ...(r.movimientos_recortados ? [`Se muestran los últimos ${r.movimientos.length} de ${r.movimientos_n} movimientos; acorta el periodo para ver los demás.`] : [])],
    secciones: [
      { titulo: "Existencias valorizadas", columnas: [izq("Código"), izq("Producto"), der("Existencias"), der("Costo promedio (USD)"), der("Valor (USD)")],
        filas: r.items.map((p) => [p.codigo || "", p.nombre, cantidadTexto(p.stock_milli), num(p.costo_prom_usd), num(p.valor_usd)]), totales: [["TOTAL", "", "", "", num(r.valor_total_usd)]] },
      { titulo: "Resumen de movimientos del periodo", columnas: [izq("Tipo"), der("Movimientos"), der("Valor (USD)")],
        filas: r.resumen_movimientos.map((m) => [MOV[m.tipo] || m.tipo, String(m.n), num(m.valor_usd)]), totales: [] },
      { titulo: "Movimientos del periodo", columnas: [izq("Fecha"), izq("Producto"), izq("Tipo"), izq("Motivo"), der("Cantidad"), der("Valor (USD)")],
        filas: r.movimientos.map((m) => [fecha(m.fecha), m.producto, MOV[m.tipo] || m.tipo, MOTIVO[m.motivo] || "", cantidadTexto(m.cantidad_milli), num(m.valor_usd)]), totales: [] }] };
}

export const construirModelo = (clave, datos) => ({ ventas: modeloVentas, compras: modeloCompras, ganancias: modeloGanancias, "por-cobrar": modeloPorCobrar, inventario: modeloInventario })[clave](datos);

// ---------------------------------------------------------------- CSV (separador «;» y coma decimal: abre bien en Excel en español)
const celdaCsv = (t) => { let s = String(t ?? "").replace(/\r?\n/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  if (/^[=+\-@\t]/.test(s) && !/^-?[\d.,]+$/.test(s)) s = `'${s}`; // evita que Excel trate un texto como fórmula
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const sinPuntos = (t) => (/^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(t) ? t.replace(/\./g, "") : t); // 1.234,56 -> 1234,56 (número limpio para Excel)
export function aCsv(m, negocio) {
  const linea = (xs) => xs.map(celdaCsv).join(";");
  const out = [linea([negocio?.nombre_razon_social || ""]), linea([negocio?.rif || ""]), linea([m.titulo]), linea([m.periodo])];
  for (const s of m.secciones) {
    out.push("", linea([s.titulo]), linea(s.columnas.map((c) => c.t)), ...s.filas.map((f) => linea(f.map(sinPuntos))), ...s.totales.map((f) => linea(f.map(sinPuntos))));
  }
  return "\uFEFF" + out.join("\r\n") + "\r\n";
}
export const nombreArchivoInforme = (m, modo, ext, r) => `${modo === "PRACTICA" ? "PRACTICA-" : ""}${m.titulo.replace(/ /g, "-").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}${r?.desde ? `_${r.desde}_${r.hasta}` : `_${r?.hoy || ""}`}.${ext}`;

// ---------------------------------------------------------------- PDF (horizontal, tabla con encabezado repetido en cada página)
export async function construirPdfInforme(L, m, { negocio, modo }) {
  const { PDFDocument, StandardFonts, rgb } = L;
  const pdf = await PDFDocument.create(), f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const permitido = new Set(f.getCharacterSet());
  const limpio = (t) => [...String(t ?? "").replace(/\s+/g, " ").trim()].map((ch) => (permitido.has(ch.codePointAt(0)) ? ch : "?")).join("");
  const ANCHO = 841.89, ALTO = 595.28, M = 32, UTIL = ANCHO - 2 * M, paginas = [];
  let pag, y;
  const nueva = () => {
    pag = pdf.addPage([ANCHO, ALTO]); paginas.push(pag); y = ALTO - M;
    if (modo === "PRACTICA") pag.drawText("PRACTICA - SIN VALOR", { x: ANCHO - M - 110, y: ALTO - 20, size: 8, font: fb, color: rgb(0.85, 0.15, 0.15) });
  };
  const recortar = (t, w, size, fuente) => { t = limpio(t); if (fuente.widthOfTextAtSize(t, size) <= w) return t; while (t.length > 1 && fuente.widthOfTextAtSize(t + "…", size) > w) t = t.slice(0, -1); return t + "…"; };
  const texto = (t, x, size, fuente, opc = {}) => pag.drawText(limpio(t), { x, y, size, font: fuente, color: opc.color || rgb(0.1, 0.1, 0.1) });
  nueva();
  texto(negocio?.nombre_razon_social || "", M, 13, fb); y -= 14; texto(`RIF ${negocio?.rif || ""}`, M, 9, f); y -= 20;
  texto(m.titulo, M, 16, fb, { color: rgb(0.1, 0.45, 0.91) }); y -= 14; texto(m.periodo + (modo === "PRACTICA" ? " · DATOS DE PRACTICA" : ""), M, 9, f); y -= 14;
  texto(m.resumen.map(([k, v]) => `${k}: ${v}`).join("   ·   "), M, 9, fb); y -= 16;
  for (const n of m.notas) { const t = limpio(n), partes = []; let r = t; // notas en varias líneas
    while (r.length) { let k = r.length; while (k > 1 && f.widthOfTextAtSize(r.slice(0, k), 7.5) > UTIL) k = r.lastIndexOf(" ", k - 1) > 0 ? r.lastIndexOf(" ", k - 1) : 1; partes.push(r.slice(0, k)); r = r.slice(k).trim(); }
    for (const p of partes) { texto(p, M, 7.5, f, { color: rgb(0.4, 0.4, 0.4) }); y -= 9.5; } }
  y -= 6;
  for (const s of m.secciones) {
    // ancho de cada columna según su contenido, reducido en proporción si no cabe en la hoja
    let size = 8; const todas = [s.columnas.map((c) => c.t), ...s.filas, ...s.totales];
    const medir = (sz) => s.columnas.map((_, i) => Math.min(Math.max(...todas.map((fila) => fb.widthOfTextAtSize(limpio(fila[i]), sz))) + 8, i === 0 || s.columnas.length < 6 ? 260 : 150));
    let anchos = medir(size); while (anchos.reduce((a, b) => a + b, 0) > UTIL && size > 5.5) { size -= 0.5; anchos = medir(size); }
    const total = anchos.reduce((a, b) => a + b, 0); if (total > UTIL) anchos = anchos.map((w) => (w * UTIL) / total);
    const alto = size + 6;
    const encabezado = () => { pag.drawRectangle({ x: M, y: y - 3, width: anchos.reduce((a, b) => a + b, 0), height: alto, color: rgb(0.93, 0.95, 0.99) });
      let x = M; s.columnas.forEach((c, i) => { const t = recortar(c.t, anchos[i] - 6, size, fb); pag.drawText(t, { x: c.der ? x + anchos[i] - 3 - fb.widthOfTextAtSize(t, size) : x + 3, y, size, font: fb, color: rgb(0.1, 0.1, 0.1) }); x += anchos[i]; }); y -= alto; };
    if (y < M + 70) nueva();
    texto(s.titulo, M, 10.5, fb); y -= 14; encabezado();
    const fila = (celdas, negrita) => {
      if (y < M + alto) { nueva(); encabezado(); }
      let x = M; s.columnas.forEach((c, i) => { const t = recortar(celdas[i], anchos[i] - 6, size, negrita ? fb : f);
        pag.drawText(t, { x: c.der ? x + anchos[i] - 3 - (negrita ? fb : f).widthOfTextAtSize(t, size) : x + 3, y, size, font: negrita ? fb : f, color: rgb(0.1, 0.1, 0.1) }); x += anchos[i]; });
      y -= alto;
    };
    if (!s.filas.length) { texto("Sin datos en este periodo.", M + 3, size, f); y -= alto; }
    s.filas.forEach((c) => fila(c, /^(Subtotal|TOTAL)/.test(c[0])));
    s.totales.forEach((c) => fila(c, true));
    y -= 12;
  }
  const generado = `Generado el ${hoyCaracas().split("-").reverse().join("/")} · Informe interno, sin valor fiscal`;
  paginas.forEach((p, i) => { const t = limpio(`${generado} · Página ${i + 1} de ${paginas.length}`); p.drawText(t, { x: M, y: 14, size: 7, font: f, color: rgb(0.45, 0.45, 0.45) }); });
  return pdf.save();
}
