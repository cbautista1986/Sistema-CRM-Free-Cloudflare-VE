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
  ["inicio", "🏠", "Inicio", "#/inicio"], ["facturar", "🧾", "Facturar", "Fase 3"], ["catalogo", "🏷️", "Catálogo", "#/catalogo"],
  ["clientes", "👥", "Clientes", "#/clientes"], ["info", "📊", "Info", "Fase 6"],
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
