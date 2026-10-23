// Módulo CLIENTES (pantallas): lista con búsqueda, formulario de alta y edición.
import { $, raiz, esc, api, aviso, campo, enviar, navegacion, activar, telefono, ERROR } from "./comun.js";

export async function vistaClientes(estado, id) {
  if (id === "nuevo") return formulario(null);
  if (id) {
    try { return formulario((await api(`clientes/${encodeURIComponent(id)}`)).cliente); }
    catch (e) { aviso(e.message); location.hash = "#/clientes"; return; }
  }
  lista();
}

const fila = (c) => {
  const t = telefono(c.whatsapp);
  return `<article class="fila" data-id="${c.id}">
  <div class="dato"><strong>${esc(c.nombre_apellido)}</strong><small class="suave">${esc(c.rif_cedula)}${c.whatsapp ? " · " + esc(t?.bonito ?? c.whatsapp) : ""}</small></div>
  ${t?.digitos ? `<a class="icono verde" href="https://wa.me/${t.digitos}" target="_blank" rel="noopener" data-ayuda="Escribir por WhatsApp" aria-label="WhatsApp">💬</a>` : ""}
</article>`;
};

function lista() {
  raiz.innerHTML = `
    <header class="encabezado"><h1>👥 Clientes</h1><button class="icono azul" id="nuevo" data-ayuda="Agregar un cliente" aria-label="Nuevo cliente">＋</button></header>
    <input id="buscar" type="search" placeholder="🔎 Buscar por nombre, RIF o WhatsApp" aria-label="Buscar cliente" autocomplete="off">
    <div id="lista" class="lista"><p class="suave">Cargando…</p></div>
    ${navegacion("clientes")}`;
  $("#nuevo").addEventListener("click", () => (location.hash = "#/clientes/nuevo"));
  activar();
  const cargar = async () => {
    if (!$("#buscar")) return; // la pantalla ya cambió
    const q = $("#buscar").value;
    try {
      const { clientes } = await api(`clientes?q=${encodeURIComponent(q)}`);
      const caja = $("#lista"); if (!caja) return;
      caja.innerHTML = clientes.length ? clientes.map(fila).join("")
        : `<p class="suave">${q ? "Sin resultados." : "Aún no tienes clientes. Toca ＋ para agregar el primero."}</p>`;
      caja.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", (e) => {
        if (!e.target.closest("a")) location.hash = `#/clientes/${el.dataset.id}`;
      }));
    } catch (e) { if ($("#lista")) $("#lista").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  let espera;
  $("#buscar").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 250); });
  cargar();
}

function formulario(c) {
  const v = c ?? {};
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver a la lista" aria-label="Volver">←</button><h1>${c ? "Editar cliente" : "Nuevo cliente"}</h1></header>
    <form id="f" class="tarjeta">
      ${campo("rif_cedula", "🪪 Cédula o RIF", v.rif_cedula, "text", 'required placeholder="V-12345678 o J-12345678-9" autocapitalize="characters"')}
      ${campo("nombre_apellido", "👤 Nombre y apellido (o razón social)", v.nombre_apellido, "text", "required")}
      ${campo("whatsapp", "📲 WhatsApp", v.whatsapp ? (telefono(v.whatsapp)?.bonito ?? v.whatsapp) : "", "tel", 'placeholder="0414-1234567" autocomplete="off"')}
      <p class="pista">Escríbelo como quieras: <b>0414-1234567</b> o <b>+58 414 1234567</b>. Si es de otro país, empieza con + y el código (ejemplo: +1 305 555 1234).</p>
      <p class="pista" id="wa-vista" hidden></p>
      ${campo("email", "✉️ Correo", v.email, "email")}
      ${campo("direccion", "📍 Dirección", v.direccion)}
      ${ERROR}<button class="boton" type="submit">${c ? "GUARDAR CAMBIOS" : "GUARDAR CLIENTE"}</button>
      ${c ? `<button class="boton contorno" type="button" id="borrar">Eliminar cliente</button>` : ""}
    </form>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/clientes"));
  const vistaPrevia = () => { // muestra cómo se va a guardar el número y deja probarlo
    const r = telefono($("#whatsapp").value), el = $("#wa-vista");
    el.hidden = !r;
    if (r) el.innerHTML = r.error ? `<span class="error">${esc(r.error)}</span>`
      : `✅ Se guardará como <b>${esc(r.bonito)}</b> · <a href="https://wa.me/${r.digitos}" target="_blank" rel="noopener">Probar en WhatsApp</a>`;
  };
  $("#whatsapp").addEventListener("input", vistaPrevia); vistaPrevia();
  enviar($("#f"), async (d) => {
    await api(c ? `clientes/${c.id}` : "clientes", c ? "PUT" : "POST", d);
    aviso("Cliente guardado ✅"); location.hash = "#/clientes";
  });
  $("#borrar")?.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar a ${c.nombre_apellido}?`)) return;
    try { await api(`clientes/${c.id}`, "DELETE"); aviso("Cliente eliminado"); location.hash = "#/clientes"; }
    catch (e) { aviso(e.message); }
  });
}
