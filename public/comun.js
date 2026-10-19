// Utilidades compartidas por todas las pantallas.
export const raiz = document.getElementById("app");
const burbuja = document.getElementById("burbuja");
export const $ = (s) => raiz.querySelector(s);
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const bs = (n) => Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (centavos) => (centavos == null ? "—" : `$ ${bs(centavos / 100)}`); // centavos -> "$ 12,50"
export const aTexto = (centavos) => (centavos == null ? "" : (centavos / 100).toFixed(2).replace(".", ",")); // centavos -> "12,50"
export const fechaLocal = (f) => new Date(f.replace(" ", "T") + "Z").toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
export const ERROR = `<p class="error" role="alert" hidden></p>`;

export async function api(ruta, metodo = "GET", cuerpo) {
  const r = await fetch(`/api/${ruta}`, {
    method: metodo,
    headers: cuerpo ? { "Content-Type": "application/json" } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

let tAviso;
export function aviso(texto) {
  burbuja.textContent = texto; burbuja.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => (burbuja.hidden = true), 2400);
}

// Leyendas: al dejar presionado medio segundo cualquier elemento con data-ayuda
let pulso;
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-ayuda]");
  if (el) pulso = setTimeout(() => aviso(el.dataset.ayuda), 500);
});
for (const ev of ["pointerup", "pointercancel", "pointerleave", "scroll"]) document.addEventListener(ev, () => clearTimeout(pulso), true);

export const campo = (id, etiqueta, valor = "", tipo = "text", extra = "") =>
  `<label for="${id}">${etiqueta}</label><input id="${id}" name="${id}" type="${tipo}" value="${esc(valor)}" ${extra}>`;

export function enviar(form, accion) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = form.querySelector("button[type=submit]"), err = form.querySelector(".error");
    boton.disabled = true; err.hidden = true;
    try { await accion(Object.fromEntries(new FormData(form))); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { boton.disabled = false; }
  });
}

// Barra inferior: destino "#/ruta" = pantalla lista; "Fase N" = todavía no existe
const NAV = [
  ["inicio", "🏠", "Inicio", "#/inicio"], ["factura", "🧾", "Factura", "Fase 3"], ["clientes", "👥", "Clientes", "#/clientes"],
  ["pagos", "💳", "Pagos", "Fase 4"], ["inventario", "📦", "Inventario", "#/inventario"],
];
export function navegacion(activo) {
  return `<nav class="nav">${NAV.map(([id, icono, nombre, destino]) =>
    `<button data-nombre="${nombre}" data-destino="${destino}" data-ayuda="${nombre}" class="${id === activo ? "activo" : ""}"><span>${icono}</span>${nombre}</button>`).join("")}</nav>`;
}
// Enlaza todos los botones con data-destino de la pantalla actual
export function activar() {
  raiz.querySelectorAll("[data-destino]").forEach((b) => b.addEventListener("click", () => {
    const d = b.dataset.destino;
    if (d.startsWith("#")) location.hash = d; else aviso(`${b.dataset.nombre} llega en la ${d}`);
  }));
}

// Teléfonos: la persona escribe como quiera y se guarda siempre igual (código de país + número, sin "+" ni espacios).
// Devuelve null si está vacío, { error } si no se entiende, o { digitos: "584141234567", bonito: "+58 414 123 4567" }.
// Debe comportarse igual que normalizarWhatsapp() de src/comun.ts.
const MSG_VE = "Un celular venezolano tiene 10 dígitos y empieza por 4 (ejemplo: 0414-1234567).";
const MSG_OTRO = "No reconozco ese número. Escríbelo como 0414-1234567, o con + y el código del país (ejemplo: +1 305 555 1234).";
export function telefono(texto) {
  const t = String(texto ?? "").trim();
  if (!t) return null;
  let d = t.replace(/\D/g, "");
  const conCodigo = t.startsWith("+") || d.startsWith("00");
  if (d.startsWith("00")) d = d.slice(2);
  if (conCodigo) { if (d.startsWith("580")) d = "58" + d.slice(3); }
  else if (d.startsWith("0")) d = "58" + d.replace(/^0+/, "");
  else if (d.length === 10 && d[0] === "4") d = "58" + d;
  const venezolano = d.startsWith("58");
  if (venezolano && !/^584\d{9}$/.test(d)) return { error: MSG_VE };
  if (!/^\d{8,15}$/.test(d) || d.startsWith("0") || (!conCodigo && !venezolano)) return { error: MSG_OTRO };
  return { digitos: d, bonito: venezolano ? `+58 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : `+${d}` };
}
