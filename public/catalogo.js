// Módulo CATÁLOGO (pantallas): servicios y productos con precio, costo privado e IVA.
import { $, raiz, esc, bs, usd, aTexto, api, aviso, campo, enviar, navegacion, activar, ERROR } from "./comun.js";
import { cantidadTexto } from "./dinero.js";

let filtro = "PRODUCTO", elegido = false; // pestaña actual: "PRODUCTO" o "SERVICIO" (se recuerda al volver a la lista)
export const fijarFiltro = (f) => { filtro = f; elegido = true; }; // lo usa la pantalla de Compras para volver a Productos o Servicios

export async function vistaCatalogo(estado, id) {
  if (id === "nuevo") return formulario(null);
  if (id) {
    try { return formulario((await api(`catalogo/${encodeURIComponent(id)}`)).item); }
    catch (e) { aviso(e.message); location.hash = "#/inventario"; return; }
  }
  if (!elegido) { // la primera vez, si solo hay servicios, abre directo en la pestaña Servicios
    elegido = true;
    try { const { items } = await api("catalogo"); if (items.length && !items.some((i) => i.tipo === "PRODUCTO")) filtro = "SERVICIO"; } catch { /* sigue en Productos */ }
  }
  lista(Number(estado.negocio.tasa_bcv) || 0);
}

const detalle = (i, tasa) => [
  i.codigo ? esc(i.codigo) : "",
  i.precio_centavos == null ? "Precio a definir al facturar" : usd(i.precio_centavos) + (tasa ? ` · Bs. ${bs((i.precio_centavos / 100) * tasa)}` : ""),
  i.alicuota_iva ? `IVA ${i.alicuota_iva}%` : "Exento",
  i.tipo === "PRODUCTO" && i.controla_stock ? `Stock ${cantidadTexto(i.stock_milli)}` : "",
].filter(Boolean).join(" · ");

const alertaStock = (i) => (!(i.tipo === "PRODUCTO" && i.controla_stock) ? "" : i.stock_milli <= 0 ? '<span class="insignia rojo">Agotado</span>'
  : i.stock_minimo_milli != null && i.stock_milli <= i.stock_minimo_milli ? '<span class="insignia ambar">Poco stock</span>' : "");

const fila = (i, tasa) => {
  const ganancia = i.precio_centavos != null && i.costo_centavos != null ? i.precio_centavos - i.costo_centavos : null;
  return `<article class="fila ${i.activo ? "" : "apagado"}" data-id="${i.id}">
    <span class="icono-tipo ${i.tipo === "SERVICIO" ? "morado" : ""}">${i.tipo === "SERVICIO" ? "🛠️" : "📦"}</span>
    <div class="dato"><strong>${esc(i.nombre)}</strong><small class="suave">${detalle(i, tasa)}</small>
      ${ganancia != null ? `<small class="ganancia-txt">Ganancia ${usd(ganancia)}</small>` : ""}</div>
    ${i.activo ? "" : `<span class="insignia">Inactivo</span>`}${alertaStock(i)}
  </article>`;
};

function lista(tasa) {
  raiz.innerHTML = `
    <header class="encabezado"><h1>📦 Inventario</h1><button class="icono azul" id="nuevo" data-ayuda="Agregar un servicio o producto" aria-label="Nuevo">＋</button></header>
    <div class="chips tres">${[["PRODUCTO", "📦 Productos"], ["SERVICIO", "🛠️ Servicios"], ["COMPRAS", "🧾 Compras"]]
      .map(([v, t]) => `<button class="chip ${v === filtro ? "activo" : ""}" data-f="${v}">${t}</button>`).join("")}</div>
    <input id="buscar" type="search" placeholder="🔎 Buscar por nombre o código" aria-label="Buscar" autocomplete="off">
    <div id="lista" class="lista"><p class="suave">Cargando…</p></div>
    ${navegacion("inventario")}`;
  $("#nuevo").addEventListener("click", () => (location.hash = "#/inventario/nuevo"));
  activar();
  const cargar = async () => {
    if (!$("#buscar")) return; // la pantalla ya cambió
    const q = $("#buscar").value;
    try {
      const { items } = await api(`catalogo?q=${encodeURIComponent(q)}&tipo=${filtro}`);
      const caja = $("#lista"); if (!caja) return;
      caja.innerHTML = items.length ? items.map((i) => fila(i, tasa)).join("")
        : `<p class="suave">${q ? "Sin resultados." : `Aún no tienes ${filtro === "SERVICIO" ? "servicios" : "productos"}. Toca ＋ para agregar el primero.`}</p>`;
      caja.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/inventario/${el.dataset.id}`)));
    } catch (e) { if ($("#lista")) $("#lista").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  raiz.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.f === "COMPRAS") { location.hash = "#/compras"; return; }
    filtro = b.dataset.f;
    raiz.querySelectorAll(".chip").forEach((x) => x.classList.toggle("activo", x === b));
    cargar();
  }));
  let espera;
  $("#buscar").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 250); });
  cargar();
}

const IVAS = [[16, "General 16%"], [8, "Reducido 8%"], [0, "Exento"]];

function formulario(i) {
  const v = i ?? { tipo: filtro, alicuota_iva: 16, activo: 1, controla_stock: 1 };
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver a la lista" aria-label="Volver">←</button><h1>${i ? "Editar" : "Nuevo"}</h1></header>
    <form id="f" class="tarjeta">
      <fieldset><legend>¿Qué es?</legend>
        <label class="opcion"><input type="radio" name="tipo" value="SERVICIO" ${v.tipo === "SERVICIO" ? "checked" : ""}> 🛠️ Servicio (mano de obra, sin inventario)</label>
        <label class="opcion"><input type="radio" name="tipo" value="PRODUCTO" ${v.tipo === "PRODUCTO" ? "checked" : ""}> 📦 Producto o equipo</label>
      </fieldset>
      ${campo("nombre", "🏷️ Nombre", v.nombre, "text", "required")}
      ${campo("codigo", "🔖 Código (opcional)", v.codigo, "text", 'autocapitalize="characters"')}
      ${campo("precio_usd", "💵 Precio de venta en USD", aTexto(v.precio_centavos), "text", 'inputmode="decimal" placeholder="Vacío = se define al facturar"')}
      ${campo("costo_usd", "🔒 Costo en USD (solo lo ves tú)", aTexto(v.costo_centavos), "text", 'inputmode="decimal" placeholder="Opcional"')}
      <label for="alicuota_iva">🧾 IVA</label>
      <select id="alicuota_iva" name="alicuota_iva">${IVAS.map(([n, t]) => `<option value="${n}" ${n === v.alicuota_iva ? "selected" : ""}>${t}</option>`).join("")}</select>
      <div id="caja-stock" ${v.tipo === "PRODUCTO" ? "" : "hidden"}>
        <label class="opcion"><input type="checkbox" id="controla_stock" ${v.controla_stock ? "checked" : ""}> 📦 Controlar existencias (se descuentan al vender)</label>
        ${campo("stock_minimo", "🔔 Avisar cuando queden (opcional)", v.stock_minimo_milli != null ? cantidadTexto(v.stock_minimo_milli) : "", "text", 'inputmode="decimal" placeholder="Ejemplo: 5"')}
        ${i ? `<button type="button" class="boton chico" id="ver-stock">📜 Ver existencias y movimientos</button>` : ""}
      </div>
      ${i ? `<label class="opcion"><input type="checkbox" id="activo" ${v.activo ? "checked" : ""}> Disponible para vender</label>` : ""}
      ${ERROR}<button class="boton" type="submit">${i ? "GUARDAR CAMBIOS" : "GUARDAR"}</button>
      ${i ? `<button class="boton contorno" type="button" id="borrar">Eliminar</button>` : ""}
    </form>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/inventario"));
  raiz.querySelectorAll('input[name="tipo"]').forEach((x) => x.addEventListener("change", () => { $("#caja-stock").hidden = raiz.querySelector('input[name="tipo"]:checked').value !== "PRODUCTO"; }));
  $("#ver-stock")?.addEventListener("click", () => (location.hash = `#/existencias/${i.id}`));
  enviar($("#f"), async (d) => {
    d.controla_stock = d.tipo === "PRODUCTO" && $("#controla_stock").checked ? "1" : "0";
    d.activo = $("#activo") && !$("#activo").checked ? "0" : "1";
    await api(i ? `catalogo/${i.id}` : "catalogo", i ? "PUT" : "POST", d);
    aviso("Guardado ✅"); location.hash = "#/inventario";
  });
  $("#borrar")?.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar "${i.nombre}"?`)) return;
    try { await api(`catalogo/${i.id}`, "DELETE"); aviso("Eliminado"); location.hash = "#/inventario"; }
    catch (e) { aviso(e.message); }
  });
}
