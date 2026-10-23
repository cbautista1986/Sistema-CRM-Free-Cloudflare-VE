// PDF de presupuestos y facturas. Se genera en el navegador con pdf-lib (incluida en /vendor, sin internet).
// construirPdf(PDFLib, { doc, lineas, impuestos }) -> Uint8Array. Los datos son los que devuelve GET /api/documentos/:id.
// Solo depende de dinero.js, para poder probarlo fuera del navegador.
import { tasaTexto, cantidadTexto } from "./dinero.js";

const ANCHO = 595.28, ALTO = 841.89, M = 40;
const num = (c) => (c / 100).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
export const numeroDoc = (d) => (d.numero == null ? "" : d.tipo === "PRESUPUESTO" ? `P-${String(d.numero).padStart(6, "0")}` : String(d.numero).padStart(8, "0"));
const bonito = (t) => { const d = String(t ?? "").replace(/\D/g, ""); return /^584\d{9}$/.test(d) ? `+58 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : String(t ?? ""); };
const masDias = (iso, dias) => { const f = new Date(`${iso}T12:00:00Z`); f.setUTCDate(f.getUTCDate() + dias); return f.toISOString().slice(0, 10); };

export function nombreArchivo(d) {
  const base = d.tipo === "PRESUPUESTO" ? "Presupuesto" : "Factura";
  return `${d.modo === "PRACTICA" ? "PRACTICA-" : ""}${base}-${numeroDoc(d)}.pdf`;
}

export async function construirPdf(L, { doc: D, lineas, impuestos }) {
  if (!D.emisor_json || D.numero == null) throw new Error("Solo se puede crear el PDF de un documento emitido.");
  const { PDFDocument, StandardFonts, rgb, degrees } = L;
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const permitido = new Set(f.getCharacterSet());
  const limpio = (t) => [...String(t ?? "").replace(/\s+/g, " ").trim()].map((ch) => (permitido.has(ch.codePointAt(0)) ? ch : "?")).join("");
  const emisor = JSON.parse(D.emisor_json), reglas = JSON.parse(D.parametros_json || "{}");
  const esFactura = D.tipo === "FACTURA", sinControl = esFactura && !D.control_fiscal;
  const titulo = esFactura ? (D.control_fiscal ? "FACTURA" : reglas.titulo_sin_control || "FACTURA") : "PRESUPUESTO";

  const paginas = []; let pag, y;
  // marcas de agua en diagonal, centradas en la hoja (se miden con la fuente para que nunca se corten)
  const diagonal = (p, txt, size, grados, color, opacity, dy = 0) => {
    const w = fb.widthOfTextAtSize(txt, size), a = (grados * Math.PI) / 180, h = size * 0.7;
    p.drawText(txt, { x: ANCHO / 2 - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), y: ALTO / 2 - dy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a),
      size, font: fb, color: rgb(...color), rotate: degrees(grados), opacity });
  };
  const marcas = (p) => {
    if (D.modo === "PRACTICA") diagonal(p, "PRÁCTICA - SIN VALOR", 40, 35, [0.6, 0.6, 0.6], 0.4, 150);
    if (D.estado === "ANULADO") diagonal(p, "ANULADA", 100, 35, [0.85, 0.15, 0.15], 0.22, -40);
  };
  const nueva = () => { pag = pdf.addPage([ANCHO, ALTO]); paginas.push(pag); marcas(pag); y = M; };
  // T: escribe una línea; "top" es la distancia desde el borde superior de la hoja; der=true alinea a la derecha de x
  const T = (t, x, top, { s = 10, b = false, c = [0.12, 0.12, 0.12], der = false, p = pag } = {}) => {
    const txt = limpio(t), fuente = b ? fb : f, w = fuente.widthOfTextAtSize(txt, s);
    p.drawText(txt, { x: der ? x - w : x, y: ALTO - top - s, size: s, font: fuente, color: rgb(...c) });
    return w;
  };
  const envolver = (t, max, s, b = false) => {
    const fuente = b ? fb : f, salida = []; let linea = "";
    for (const palabra of limpio(t).split(" ")) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (linea && fuente.widthOfTextAtSize(prueba, s) > max) { salida.push(linea); linea = palabra; } else linea = prueba;
    }
    if (linea) salida.push(linea);
    return salida.length ? salida : [""];
  };
  const caja = (top, alto, relleno, borde) => pag.drawRectangle({ x: M, y: ALTO - top - alto, width: ANCHO - 2 * M, height: alto, color: rgb(...relleno), borderColor: borde ? rgb(...borde) : undefined, borderWidth: borde ? 1 : 0 });

  nueva();
  // ---- encabezado: emisor a la izquierda, título y números a la derecha
  let ey = y;
  T(emisor.nombre_razon_social, M, ey, { s: 14, b: true }); ey += 19;
  T(`RIF: ${emisor.rif}`, M, ey); ey += 14;
  for (const l of envolver(emisor.direccion_fiscal, 280, 9)) { T(l, M, ey, { s: 9 }); ey += 12; }
  const contacto = [emisor.telefono, emisor.email].filter(Boolean).join("  ·  ");
  if (contacto) { T(contacto, M, ey, { s: 9 }); ey += 12; }
  let dy = y; const R = ANCHO - M;
  T(titulo, R, dy, { s: titulo.length > 12 ? 17 : 22, b: true, der: true }); dy += 28;
  T(`N.º: ${numeroDoc(D)}`, R, dy, { s: 11, b: true, der: true }); dy += 15;
  if (esFactura) { T(`Control interno: ${String(D.control_interno).padStart(8, "0")}`, R, dy, { s: 9, der: true }); dy += 13;
    T(`N.º de control fiscal: ${D.control_fiscal || "No asignado"}`, R, dy, { s: 9, der: true }); dy += 13; }
  T(`Fecha de emisión: ${fecha(D.fecha_emision)}`, R, dy, { s: 9, der: true }); dy += 13;
  if (!esFactura) { T(`Válido hasta: ${fecha(masDias(D.fecha_emision, Number(reglas.validez_presupuesto_dias ?? 15)))}`, R, dy, { s: 9, der: true }); dy += 13; }
  y = Math.max(ey, dy) + 8;

  if (sinControl) { // aviso visible: el documento todavía no tiene N.º de control fiscal
    const ls = envolver(reglas.leyenda_sin_control || "DOCUMENTO SIN NÚMERO DE CONTROL FISCAL", ANCHO - 2 * M - 16, 9, true), h = ls.length * 12 + 10;
    caja(y, h, [1, 0.95, 0.95], [0.75, 0.1, 0.1]); ls.forEach((l, i) => T(l, M + 8, y + 6 + i * 12, { s: 9, b: true, c: [0.65, 0.05, 0.05] })); y += h + 10;
  }
  if (D.estado === "ANULADO") {
    const ls = envolver(`DOCUMENTO ANULADO el ${fecha(D.anulado_en)}. Motivo: ${D.motivo_anulacion || ""}`, ANCHO - 2 * M - 16, 9, true), h = ls.length * 12 + 10;
    caja(y, h, [0.98, 0.9, 0.9], [0.85, 0.15, 0.15]); ls.forEach((l, i) => T(l, M + 8, y + 6 + i * 12, { s: 9, b: true, c: [0.7, 0.1, 0.1] })); y += h + 10;
  }

  // ---- cliente
  const datosCliente = [["Cliente", D.cliente_nombre], ["RIF / C.I.", D.cliente_rif], D.cliente_direccion && ["Dirección", D.cliente_direccion], D.cliente_whatsapp && ["WhatsApp", bonito(D.cliente_whatsapp)]].filter(Boolean);
  const textoCliente = datosCliente.flatMap(([k, v]) => envolver(v, 400, 10).map((l, i) => [i === 0 ? k : "", l]));
  const hc = textoCliente.length * 14 + 12;
  caja(y, hc, [0.95, 0.96, 0.98]); textoCliente.forEach(([k, v], i) => { T(k, M + 8, y + 6 + i * 14, { s: 9, c: [0.4, 0.4, 0.4] }); T(v, M + 80, y + 6 + i * 14, { s: 10, b: k === "Cliente" }); });
  y += hc + 12;

  // ---- renglones
  const col = { cant: M + 4, desc: M + 48, pu: 370, iva: 418, usd: 488, bs: R - 2 };
  const encabezadoTabla = () => {
    caja(y, 18, [0.16, 0.34, 0.66]);
    const c = [1, 1, 1];
    T("Cant.", col.cant, y + 4, { s: 8.5, b: true, c }); T("Descripción", col.desc, y + 4, { s: 8.5, b: true, c });
    T("P. unit. USD", col.pu, y + 4, { s: 8.5, b: true, c, der: true }); T("IVA", col.iva, y + 4, { s: 8.5, b: true, c, der: true });
    T("Monto USD", col.usd, y + 4, { s: 8.5, b: true, c, der: true }); T("Monto Bs.", col.bs, y + 4, { s: 8.5, b: true, c, der: true });
    y += 22;
  };
  encabezadoTabla();
  for (const l of lineas) {
    const ds = envolver(l.descripcion, col.pu - col.desc - 70, 9.5), h = ds.length * 12 + 6;
    if (y + h > ALTO - M - 30) { nueva(); encabezadoTabla(); }
    T(cantidadTexto(l.cantidad_milli), col.cant, y + 3, { s: 9.5 });
    ds.forEach((t, i) => T(t, col.desc, y + 3 + i * 12, { s: 9.5 }));
    T(num(l.precio_usd), col.pu, y + 3, { s: 9.5, der: true }); T(l.alicuota_cent === 0 ? "Exento" : `${l.alicuota_cent / 100}%`, col.iva, y + 3, { s: 9.5, der: true });
    T(num(l.monto_usd), col.usd, y + 3, { s: 9.5, der: true }); T(num(l.monto_bs), col.bs, y + 3, { s: 9.5, der: true });
    pag.drawLine({ start: { x: M, y: ALTO - y - h }, end: { x: R, y: ALTO - y - h }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
    y += h;
  }

  // ---- totales (USD de referencia; Bs. son los montos legales)
  const filas = [];
  for (const i of impuestos) {
    if (i.alicuota_cent === 0) filas.push(["Monto exento", i.base_usd, i.base_bs]);
    else { filas.push([`Base imponible ${i.alicuota_cent / 100}%`, i.base_usd, i.base_bs]); filas.push([`IVA ${i.alicuota_cent / 100}%`, i.iva_usd, i.iva_bs]); }
  }
  const notaLineas = D.nota ? envolver(`Nota: ${D.nota}`, ANCHO - 2 * M, 9) : [];
  const cambio = envolver(reglas.leyenda_cambio || "", ANCHO - 2 * M, 8);
  const necesario = 30 + filas.length * 14 + 30 + 14 + cambio.length * 11 + notaLineas.length * 12 + 20;
  if (y + necesario > ALTO - M - 24) nueva();
  y += 10;
  T("USD", col.usd, y, { s: 8, c: [0.45, 0.45, 0.45], der: true }); T("Bs.", col.bs, y, { s: 8, c: [0.45, 0.45, 0.45], der: true }); y += 13;
  for (const [t, u, b] of filas) { T(t, col.pu - 60, y, { s: 9.5 }); T(num(u), col.usd, y, { s: 9.5, der: true }); T(num(b), col.bs, y, { s: 9.5, der: true }); y += 14; }
  pag.drawLine({ start: { x: col.pu - 60, y: ALTO - y + 2 }, end: { x: R, y: ALTO - y + 2 }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) }); y += 4;
  T("TOTAL", col.pu - 60, y, { s: 12, b: true }); T(num(D.total_usd), col.usd, y, { s: 12, b: true, der: true }); T(num(D.total_bs), col.bs, y, { s: 12, b: true, der: true }); y += 26;

  T(`Tasa de cambio BCV: Bs. ${tasaTexto(D.tasa_e8)} por USD`, M, y, { s: 9, b: true }); y += 14;
  cambio.forEach((l) => { T(l, M, y, { s: 8, c: [0.4, 0.4, 0.4] }); y += 11; });
  y += 4; notaLineas.forEach((l) => { T(l, M, y, { s: 9 }); y += 12; });

  paginas.forEach((p, i) => { // pie de cada página
    T(`Página ${i + 1} de ${paginas.length}  ·  Sistema de Facturación (plantilla v${reglas.plantilla_version ?? 1})`, ANCHO / 2 + 90, ALTO - 28, { s: 7.5, c: [0.55, 0.55, 0.55], der: true, p });
  });
  return pdf.save();
}
