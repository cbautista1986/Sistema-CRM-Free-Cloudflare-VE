// Módulo COMPRAS (pantallas): facturas de compra, proveedores y existencias de cada producto.
// Las existencias y el costo promedio los calcula el servidor; aquí solo se muestran y se registran movimientos.
import { $, raiz, esc, usd, api, aviso, campo, enviar, navegacion, activar, telefono, ERROR } from "./comun.js";
import { aCantidadMilli, aCentavos, calcular, cantidadTexto } from "./dinero.js";
import { fijarFiltro } from "./catalogo.js";

const fechaDoc = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const hoyCaracas = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
const pestanas = () => `<div class="chips tres">${[["PRODUCTO", "📦 Productos"], ["SERVICIO", "🛠️ Servicios"], ["COMPRAS", "🧾 Compras"]]
  .map(([v, t]) => `<button class="chip ${v === "COMPRAS" ? "activo" : ""}" data-f="${v}">${t}</button>`).join("")}</div>`;
const cablearPestanas = () => raiz.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.f === "COMPRAS") return; fijarFiltro(b.dataset.f); location.hash = "#/inventario";
}));

// ------------------------------------------------------------------ rutas
export async function vistaCompras(estado, id) {
  try {
    if (id === "nueva") return nuevaCompra();
    if (id) return await verCompra(id);
  } catch (e) { aviso(e.message); location.hash = "#/compras"; return; }
  listaCompras();
}
export async function vistaProveedores(estado, id) {
  try {
    if (id === "nuevo") return formProveedor(null);
    if (id) return formProveedor((await api(`proveedores/${encodeURIComponent(id)}`)).proveedor);
  } catch (e) { aviso(e.message); location.hash = "#/proveedores"; return; }
  listaProveedores();
}
export async function vistaExistencias(estado, id) {
  try { return await detalleStock(id); } catch (e) { aviso(e.message); location.hash = "#/inventario"; }
}

// ------------------------------------------------------------------ lista de compras
function listaCompras() {
  raiz.innerHTML = `
    <header class="encabezado"><h1>🧾 Compras</h1><button class="icono" id="provs" data-ayuda="Proveedores" aria-label="Proveedores">👥</button>
      <button class="icono azul" id="nueva" data-ayuda="Registrar una compra" aria-label="Nueva compra">＋</button></header>
    ${pestanas()}
    <input id="buscar" type="search" placeholder="🔎 Buscar por proveedor o factura" aria-label="Buscar" autocomplete="off">
    <div id="lista" class="lista"><p class="suave">Cargando…</p></div>${navegacion("inventario")}`;
  $("#nueva").addEventListener("click", () => (location.hash = "#/compras/nueva"));
  $("#provs").addEventListener("click", () => (location.hash = "#/proveedores"));
  cablearPestanas(); activar();
  const cargar = async () => {
    if (!$("#buscar")) return;
    try {
      const { compras } = await api(`compras?q=${encodeURIComponent($("#buscar").value)}`);
      const caja = $("#lista"); if (!caja) return;
      caja.innerHTML = compras.length ? compras.map((x) => `<article class="fila ${x.estado === "ANULADA" ? "apagado" : ""}" data-id="${x.id}">
        <div class="dato"><strong>Factura ${esc(x.factura_numero)} · ${esc(x.proveedor_nombre)}</strong><small class="suave">${fechaDoc(x.fecha)} · ${usd(x.total_usd)}</small></div>
        ${x.estado === "ANULADA" ? `<span class="insignia rojo">Anulada</span>` : ""}${x.modo === "PRACTICA" ? `<span class="insignia">🧪</span>` : ""}</article>`).join("")
        : `<p class="suave">${$("#buscar").value ? "Sin resultados." : "Aún no has registrado compras. Toca ＋ para registrar la primera."}</p>`;
      caja.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/compras/${el.dataset.id}`)));
    } catch (e) { if ($("#lista")) $("#lista").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  let espera; $("#buscar").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 250); });
  cargar();
}

// ------------------------------------------------------------------ registrar una compra
function nuevaCompra() {
  const hoy = hoyCaracas(), d = { proveedor: null, lineas: [] };
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver" aria-label="Volver">←</button><h1>Registrar compra</h1></header>
    <section class="tarjeta" id="sec-prov"></section>
    <section class="tarjeta"><span class="etiqueta">🧾 FACTURA DEL PROVEEDOR</span>
      ${campo("factura_numero", "Número de la factura", "", "text", 'required maxlength="40"')}
      ${campo("control_numero", "Número de control (opcional)", "", "text", 'maxlength="40"')}
      ${campo("fecha", "📅 Fecha de la factura", hoy, "date", `max="${hoy}" required`)}</section>
    <section class="tarjeta"><span class="etiqueta">📦 PRODUCTOS COMPRADOS</span><div id="lineas"></div>
      <button type="button" class="boton chico morado" id="add-prod">🏷️ Agregar producto</button><div id="picker" hidden></div></section>
    <section class="tarjeta" id="sec-totales"></section>
    <section class="tarjeta"><label for="nota">📝 Nota (opcional)</label><textarea id="nota" rows="2" maxlength="300"></textarea></section>
    <p class="error" id="error" role="alert" hidden></p>
    <button class="boton verde" type="button" id="registrar">REGISTRAR COMPRA</button>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/compras"));

  const pintarProv = () => {
    const s = $("#sec-prov");
    if (d.proveedor) {
      s.innerHTML = `<span class="etiqueta">👥 PROVEEDOR</span><div class="fila sin-borde"><div class="dato"><strong>${esc(d.proveedor.nombre)}</strong><small class="suave">${esc(d.proveedor.rif)}</small></div><button type="button" class="boton chico" id="prov-cambiar">Cambiar</button></div>`;
      $("#prov-cambiar").addEventListener("click", () => { d.proveedor = null; pintarProv(); }); return;
    }
    s.innerHTML = `<span class="etiqueta">👥 PROVEEDOR</span>
      <input id="prov-q" type="search" placeholder="🔎 Buscar proveedor" autocomplete="off" aria-label="Buscar proveedor"><div id="prov-res" class="lista"></div>
      <button type="button" class="boton chico" id="prov-nuevo">＋ Proveedor nuevo</button>
      <form id="prov-form" hidden>${campo("rif", "🪪 RIF o cédula", "", "text", 'required placeholder="J-12345678-9" autocapitalize="characters"')}
        ${campo("nombre", "🏢 Nombre o razón social", "", "text", "required")}${ERROR}<button class="boton" type="submit">GUARDAR Y USAR</button></form>`;
    const buscar = async () => {
      if (!$("#prov-q")) return;
      try {
        const { proveedores } = await api(`proveedores?q=${encodeURIComponent($("#prov-q").value)}`);
        if (!$("#prov-res")) return;
        $("#prov-res").innerHTML = (proveedores.length ? `<p class="pista">Toca un proveedor para elegirlo:</p>` : "") + proveedores.slice(0, 6).map((p) =>
          `<article class="fila" data-p="${p.id}"><div class="dato"><strong>${esc(p.nombre)}</strong><small class="suave">${esc(p.rif)}</small></div></article>`).join("")
          || `<p class="suave">No hay coincidencias. Crea el proveedor con «＋ Proveedor nuevo».</p>`;
        $("#prov-res").querySelectorAll("[data-p]").forEach((el) => el.addEventListener("click", () => { d.proveedor = proveedores.find((p) => String(p.id) === el.dataset.p); pintarProv(); }));
      } catch (e) { if ($("#prov-res")) $("#prov-res").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    let espera; $("#prov-q").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(buscar, 250); });
    $("#prov-nuevo").addEventListener("click", () => { $("#prov-form").hidden = !$("#prov-form").hidden; });
    enviar($("#prov-form"), async (v) => { const { id } = await api("proveedores", "POST", v); d.proveedor = (await api(`proveedores/${id}`)).proveedor; pintarProv(); });
    buscar();
  };

  const pintarLineas = () => {
    $("#lineas").innerHTML = d.lineas.length ? d.lineas.map((l, i) => `
      <div class="reng" data-i="${i}">
        <div class="reng-cab"><span>📦 ${esc(l.nombre)}</span><button type="button" class="x" data-quitar="${i}" aria-label="Quitar renglón">✕</button></div>
        <div class="reng-fila">
          <label>Cant.<input data-campo="cantidad" value="${esc(l.cantidad)}" inputmode="decimal" aria-label="Cantidad"></label>
          <label>Costo USD c/u<input data-campo="costo" value="${esc(l.costo)}" inputmode="decimal" placeholder="0,00" aria-label="Costo por unidad en USD"></label>
          <label>IVA<select data-campo="alicuota_iva" aria-label="IVA">${[[16, "16%"], [8, "8%"], [0, "Exento"]].map(([n, t]) => `<option value="${n}" ${n === l.alicuota_iva ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <small class="suave" data-sub="${i}"></small>
        ${l.controla ? `<small class="suave">Ahora hay ${cantidadTexto(l.stock_milli)} en existencias.</small>` : `<small class="suave">⚠️ Este producto aún no controla existencias: al guardar empezará a controlarlas con esta cantidad.</small>`}
      </div>`).join("") : `<p class="suave">Agrega los productos que aparecen en la factura del proveedor.</p>`;
    refrescar();
  };
  const editar = (e) => {
    const el = e.target.closest("[data-campo]"); if (!el) return;
    const l = d.lineas[Number(el.closest("[data-i]").dataset.i)], k = el.dataset.campo;
    l[k] = k === "alicuota_iva" ? Number(el.value) : el.value; refrescar();
  };
  $("#lineas").addEventListener("input", editar); $("#lineas").addEventListener("change", editar);
  $("#lineas").addEventListener("click", (e) => { const q = e.target.closest("[data-quitar]"); if (q) { d.lineas.splice(Number(q.dataset.quitar), 1); pintarLineas(); } });
  $("#add-prod").addEventListener("click", () => {
    const p = $("#picker"); p.hidden = !p.hidden; if (p.hidden) return;
    p.innerHTML = `<input id="inv-q" type="search" placeholder="🔎 Buscar en el inventario" autocomplete="off" aria-label="Buscar en el inventario"><div id="inv-res" class="lista"></div>`;
    const cargar = async () => {
      if (!$("#inv-q")) return;
      try {
        const { items } = await api(`catalogo?tipo=PRODUCTO&q=${encodeURIComponent($("#inv-q").value)}`), activos = items.filter((i) => i.activo);
        if (!$("#inv-res")) return;
        $("#inv-res").innerHTML = activos.map((i) => `<article class="fila" data-it="${i.id}"><span class="icono-tipo">📦</span><div class="dato"><strong>${esc(i.nombre)}</strong>
          <small class="suave">${i.controla_stock ? `Existencias: ${cantidadTexto(i.stock_milli)}` : "Sin control de existencias"}</small></div></article>`).join("")
          || `<p class="suave">No hay productos. Créalos primero en Inventario.</p>`;
        $("#inv-res").querySelectorAll("[data-it]").forEach((el) => el.addEventListener("click", () => {
          const i = activos.find((x) => String(x.id) === el.dataset.it);
          d.lineas.push({ producto_id: i.id, nombre: i.nombre, cantidad: "1", costo: "", alicuota_iva: i.alicuota_iva, controla: !!i.controla_stock, stock_milli: i.stock_milli });
          p.hidden = true; pintarLineas();
        }));
      } catch (e) { if ($("#inv-res")) $("#inv-res").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    let espera; $("#inv-q").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 250); }); cargar();
  });

  const calculo = () => {
    const validas = []; let malas = 0;
    d.lineas.forEach((l, i) => {
      const cant = aCantidadMilli(l.cantidad), costo = aCentavos(l.costo);
      if (cant === null || Number.isNaN(cant) || !costo || Number.isNaN(costo)) { malas++; return; }
      validas.push({ cantidad_milli: cant, precio_usd: costo, alicuota_cent: Math.round(l.alicuota_iva * 100), _i: i });
    });
    try { return { r: calcular(validas, null), validas, malas }; } catch (e) { return { error: e.message, validas, malas }; }
  };
  function refrescar() {
    const c = calculo(), t = $("#sec-totales");
    if (c.error) { t.innerHTML = `<p class="error">${esc(c.error)}</p>`; return; }
    c.validas.forEach((v, k) => { const el = raiz.querySelector(`[data-sub="${v._i}"]`); if (el) el.textContent = `Subtotal ${usd(c.r.renglones[k].monto_usd)}`; });
    d.lineas.forEach((l, i) => { if (!c.validas.some((v) => v._i === i)) { const el = raiz.querySelector(`[data-sub="${i}"]`); if (el) el.textContent = "⚠️ Escribe la cantidad y el costo (ejemplo: 10 y 3,50)"; } });
    t.innerHTML = `<span class="etiqueta">💰 TOTAL DE LA COMPRA</span>
      <div class="tot"><span>Subtotal</span><b>${usd(c.r.subtotal_usd)}</b></div><div class="tot"><span>IVA</span><b>${usd(c.r.iva_usd)}</b></div>
      <div class="tot grande"><span>TOTAL USD</span><b>${usd(c.r.total_usd)}</b></div>`;
  }

  $("#registrar").addEventListener("click", async () => {
    const err = $("#error"), btn = $("#registrar"); err.hidden = true; btn.disabled = true;
    try {
      if (!d.proveedor) throw new Error("Elige el proveedor.");
      const c = calculo();
      if (c.error) throw new Error(c.error);
      if (!d.lineas.length || c.malas) throw new Error("Revisa los productos: hay cantidades o costos que faltan o están mal escritos.");
      const nuevos = d.lineas.filter((l) => !l.controla).map((l) => l.nombre);
      if (!confirm(`¿Registrar la factura ${$("#factura_numero").value} de ${d.proveedor.nombre} por ${usd(c.r.total_usd)}?\n\nEntrarán a las existencias y se actualiza el costo promedio.`
        + (nuevos.length ? `\n\nEmpezarán a controlar existencias: ${[...new Set(nuevos)].join(", ")}.` : ""))) return;
      const r = await api("compras", "POST", { proveedor_id: d.proveedor.id, factura_numero: $("#factura_numero").value, control_numero: $("#control_numero").value, fecha: $("#fecha").value,
        nota: $("#nota").value, lineas: d.lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, costo_usd: l.costo, alicuota_iva: l.alicuota_iva })) });
      aviso("Compra registrada ✅"); location.hash = `#/compras/${r.id}`;
    } catch (e) { err.textContent = e.message; err.hidden = false; } finally { btn.disabled = false; }
  });
  pintarProv(); pintarLineas();
}

// ------------------------------------------------------------------ ver una compra
async function verCompra(id) {
  const { compra: C, renglones } = await api(`compras/${encodeURIComponent(id)}`), anulada = C.estado === "ANULADA";
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver" aria-label="Volver">←</button><h1>Compra ${esc(C.factura_numero)}</h1>
      <span class="insignia ${anulada ? "rojo" : "verde"}">${anulada ? "Anulada" : "Registrada"}</span></header>
    ${C.modo === "PRACTICA" ? `<section class="aviso-practica"><b>🧪 MODO PRÁCTICA</b> · compra de prueba.</section>` : ""}
    ${anulada ? `<section class="aviso-anulado">⛔ ANULADA el ${fechaDoc(C.anulado_en)} · Motivo: ${esc(C.motivo_anulacion)}</section>` : ""}
    <section class="tarjeta">
      <div class="tot"><span>Proveedor</span><b>${esc(C.proveedor_nombre)}</b></div><div class="tot"><span>RIF</span><b>${esc(C.proveedor_rif)}</b></div>
      <div class="tot"><span>Fecha de la factura</span><b>${fechaDoc(C.fecha)}</b></div>${C.control_numero ? `<div class="tot"><span>N.º de control</span><b>${esc(C.control_numero)}</b></div>` : ""}</section>
    <section class="tarjeta"><span class="etiqueta">📦 PRODUCTOS</span>${renglones.map((l) => `<div class="reng-ver"><div><b>${esc(l.descripcion)}</b><br>
      <small class="suave">${cantidadTexto(l.cantidad_milli)} × ${usd(l.costo_usd)} · ${l.alicuota_cent ? "IVA " + l.alicuota_cent / 100 + "%" : "Exento"}</small></div><b>${usd(l.monto_usd)}</b></div>`).join("")}</section>
    <section class="tarjeta"><div class="tot"><span>Subtotal</span><b>${usd(C.subtotal_usd)}</b></div><div class="tot"><span>IVA</span><b>${usd(C.iva_usd)}</b></div>
      <div class="tot grande"><span>TOTAL</span><b>${usd(C.total_usd)}</b></div></section>
    ${C.nota ? `<section class="tarjeta"><span class="etiqueta">📝 NOTA</span><p>${esc(C.nota)}</p></section>` : ""}
    <p class="error" id="error" role="alert" hidden></p>
    ${anulada ? "" : `<button type="button" class="boton contorno" id="anular">⛔ Anular compra</button>
      <form id="anular-form" class="tarjeta" hidden>${campo("motivo", "Motivo de la anulación (mínimo 5 letras)", "", "text", 'required minlength="5" maxlength="200"')}
      ${ERROR}<button class="boton rojo" type="submit">CONFIRMAR ANULACIÓN</button></form>`}`;
  $("#atras").addEventListener("click", () => (location.hash = "#/compras"));
  $("#anular")?.addEventListener("click", () => { $("#anular-form").hidden = false; $("#motivo").focus(); });
  if ($("#anular-form")) enviar($("#anular-form"), async (v) => { await api(`compras/${C.id}/anular`, "POST", { motivo: v.motivo }); aviso("Compra anulada"); await verCompra(id); });
}

// ------------------------------------------------------------------ proveedores
function listaProveedores() {
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver" aria-label="Volver">←</button><h1>👥 Proveedores</h1>
      <button class="icono azul" id="nuevo" data-ayuda="Agregar un proveedor" aria-label="Nuevo proveedor">＋</button></header>
    <input id="buscar" type="search" placeholder="🔎 Buscar por nombre o RIF" aria-label="Buscar" autocomplete="off">
    <div id="lista" class="lista"><p class="suave">Cargando…</p></div>${navegacion("inventario")}`;
  $("#atras").addEventListener("click", () => (location.hash = "#/compras"));
  $("#nuevo").addEventListener("click", () => (location.hash = "#/proveedores/nuevo")); activar();
  const cargar = async () => {
    if (!$("#buscar")) return;
    try {
      const { proveedores } = await api(`proveedores?q=${encodeURIComponent($("#buscar").value)}`);
      const caja = $("#lista"); if (!caja) return;
      caja.innerHTML = proveedores.length ? proveedores.map((p) => `<article class="fila" data-id="${p.id}"><div class="dato"><strong>${esc(p.nombre)}</strong>
        <small class="suave">${esc(p.rif)}${p.whatsapp ? " · " + esc(telefono(p.whatsapp)?.bonito ?? p.whatsapp) : ""}</small></div></article>`).join("")
        : `<p class="suave">${$("#buscar").value ? "Sin resultados." : "Aún no tienes proveedores. Toca ＋ para agregar el primero."}</p>`;
      caja.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/proveedores/${el.dataset.id}`)));
    } catch (e) { if ($("#lista")) $("#lista").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  let espera; $("#buscar").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 250); });
  cargar();
}

function formProveedor(p) {
  const v = p ?? {};
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver" aria-label="Volver">←</button><h1>${p ? "Editar proveedor" : "Nuevo proveedor"}</h1></header>
    <form id="f" class="tarjeta">
      ${campo("rif", "🪪 RIF o cédula", v.rif, "text", 'required placeholder="J-12345678-9" autocapitalize="characters"')}
      ${campo("nombre", "🏢 Nombre o razón social", v.nombre, "text", "required")}
      ${campo("whatsapp", "📲 WhatsApp (opcional)", v.whatsapp ? (telefono(v.whatsapp)?.bonito ?? v.whatsapp) : "", "tel", 'placeholder="0414-1234567"')}
      ${campo("email", "✉️ Correo (opcional)", v.email, "email")}
      ${campo("direccion", "📍 Dirección (opcional)", v.direccion)}
      ${ERROR}<button class="boton" type="submit">${p ? "GUARDAR CAMBIOS" : "GUARDAR"}</button>
      ${p ? `<button class="boton contorno" type="button" id="borrar">Eliminar proveedor</button>` : ""}</form>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/proveedores"));
  enviar($("#f"), async (d) => { await api(p ? `proveedores/${p.id}` : "proveedores", p ? "PUT" : "POST", d); aviso("Guardado ✅"); location.hash = "#/proveedores"; });
  $("#borrar")?.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar a "${p.nombre}"?`)) return;
    try { await api(`proveedores/${p.id}`, "DELETE"); aviso("Eliminado"); location.hash = "#/proveedores"; } catch (e) { aviso(e.message); }
  });
}

// ------------------------------------------------------------------ existencias de un producto
const MOTIVOS = [["DANADO", "Dañado"], ["PERDIDO", "Perdido o robado"], ["GARANTIA", "Garantía (devuelto al proveedor)"], ["USO_INTERNO", "Uso interno"], ["SOBRANTE", "Sobrante (apareció de más)"]];
const etiquetaMov = (m) => ({ COMPRA: "🧾 Compra", CARGA: "➕ Carga directa", VENTA: "🧾 Venta", DEVOLUCION_VENTA: "↩️ Devolución (factura anulada)", ANULACION_COMPRA: "⛔ Compra anulada",
  AJUSTE: `🛠️ Ajuste: ${MOTIVOS.find((x) => x[0] === m.motivo)?.[1] ?? ""}` })[m.tipo] ?? m.tipo;

async function detalleStock(id) {
  const m = await api(`existencias/${encodeURIComponent(id)}/movimientos`), P = m.producto;
  const estado = !P.controla_stock ? "" : m.stock_milli <= 0 ? "AGOTADO" : P.stock_minimo_milli != null && m.stock_milli <= P.stock_minimo_milli ? "BAJO" : "";
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver" aria-label="Volver">←</button><h1>${esc(P.nombre)}</h1>
      ${estado ? `<span class="insignia ${estado === "AGOTADO" ? "rojo" : "ambar"}">${estado === "AGOTADO" ? "Agotado" : "Poco stock"}</span>` : ""}</header>
    <section class="tarjeta">
      <div class="tot"><span>Controla existencias</span><b>${P.controla_stock ? "Sí" : "No"}</b></div>
      <div class="tot grande"><span>Existencias</span><b>${P.controla_stock ? cantidadTexto(m.stock_milli) : "—"}</b></div>
      <div class="tot"><span>Valor en inventario</span><b>${usd(m.valor_usd)}</b></div>
      <div class="tot"><span>Costo promedio</span><b>${usd(P.costo_centavos)}</b></div>
      ${P.stock_minimo_milli != null ? `<div class="tot"><span>Avisar cuando queden</span><b>${cantidadTexto(P.stock_minimo_milli)} o menos</b></div>` : ""}</section>
    <p class="error" id="error" role="alert" hidden></p>
    <button type="button" class="boton verde" id="b-carga">➕ Cargar existencias (sin factura)</button>
    <form id="f-carga" class="tarjeta" hidden>
      ${campo("cantidad", "Cantidad que entra", "", "text", 'required inputmode="decimal"')}${campo("costo_usd", "Costo por unidad en USD", "", "text", 'required inputmode="decimal" placeholder="0,00"')}
      ${campo("nota", "Nota (opcional)", "", "text", 'maxlength="200" placeholder="Ejemplo: inventario inicial"')}${ERROR}<button class="boton" type="submit">GUARDAR CARGA</button></form>
    <button type="button" class="boton contorno-azul" id="b-ajuste">🛠️ Ajustar existencias</button>
    <form id="f-ajuste" class="tarjeta" hidden>
      <label for="motivo">Motivo</label><select id="motivo" name="motivo">${MOTIVOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
      ${campo("a_cantidad", "Cantidad", "", "text", 'required inputmode="decimal"')}${campo("a_nota", "Explica el ajuste (mínimo 5 letras)", "", "text", 'required minlength="5" maxlength="200"')}
      ${ERROR}<button class="boton rojo" type="submit">GUARDAR AJUSTE</button></form>
    <section class="tarjeta"><span class="etiqueta">📜 MOVIMIENTOS</span>${m.movimientos.length ? m.movimientos.map((x) => `<div class="reng-ver ${x.documento_id || x.compra_id ? "enlace" : ""}" ${x.documento_id ? `data-ir="#/factura/${x.documento_id}"` : x.compra_id ? `data-ir="#/compras/${x.compra_id}"` : ""}>
      <div><b>${etiquetaMov(x)}</b><br><small class="suave">${fechaDoc(x.fecha)}${x.nota ? " · " + esc(x.nota) : ""}</small></div>
      <b class="${x.cantidad_milli < 0 ? "rojo-txt" : ""}">${x.cantidad_milli > 0 ? "+" : ""}${cantidadTexto(x.cantidad_milli)}</b></div>`).join("") : `<p class="suave">Todavía no hay movimientos.</p>`}</section>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/inventario"));
  raiz.querySelectorAll("[data-ir]").forEach((el) => el.addEventListener("click", () => (location.hash = el.dataset.ir)));
  $("#b-carga").addEventListener("click", () => { $("#f-carga").hidden = !$("#f-carga").hidden; });
  $("#b-ajuste").addEventListener("click", () => { $("#f-ajuste").hidden = !$("#f-ajuste").hidden; });
  enviar($("#f-carga"), async (v) => { await api("existencias/carga", "POST", { producto_id: P.id, cantidad: v.cantidad, costo_usd: v.costo_usd, nota: v.nota }); aviso("Existencias cargadas ✅"); await detalleStock(id); });
  enviar($("#f-ajuste"), async (v) => { await api("existencias/ajuste", "POST", { producto_id: P.id, motivo: v.motivo, cantidad: v.a_cantidad, nota: v.a_nota }); aviso("Ajuste guardado ✅"); await detalleStock(id); });
}
