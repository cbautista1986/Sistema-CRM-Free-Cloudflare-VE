// Módulo FACTURA (pantallas): lista, editor de borradores, vista del documento y PDF.
// Toda la matemática del dinero sale de dinero.js (la misma que usa el servidor).
import { $, raiz, esc, bs, usd, aTexto, api, aviso, campo, enviar, navegacion, activar, ERROR } from "./comun.js";
import { aTasaE8, aCantidadMilli, aCentavos, calcular, cantidadTexto } from "./dinero.js";
import { construirPdf, nombreArchivo, numeroDoc } from "./pdf.js";

const NOMBRE = { FACTURA: "Factura", PRESUPUESTO: "Presupuesto" };
const ESTADOS = { BORRADOR: ["Borrador", "gris"], EMITIDO: ["Emitido", "verde"], FACTURADO: ["Facturado", "azul"], ANULADO: ["Anulado", "rojo"] };
const dia = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(d); // 2026-10-19
const fechaDoc = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const bannerPractica = (estado) => (estado.modo === "PRACTICA"
  ? `<section class="aviso-practica"><b>🧪 MODO PRÁCTICA</b> · los documentos son de prueba, no valen y se borran al salir en vivo (en Ajustes).</section>` : "");

function tasaInfo(estado) {
  const n = estado.negocio, e8 = aTasaE8(String(n.tasa_bcv));
  const cargada = n.tasa_bcv_fecha ? dia(new Date(String(n.tasa_bcv_fecha).replace(" ", "T") + "Z")) : null;
  return { e8: e8 && !Number.isNaN(e8) ? e8 : null, valor: Number(n.tasa_bcv) || 0, vieja: cargada !== dia(new Date()) };
}

let tab = "FACTURA"; // pestaña de la lista (se recuerda)

export async function vistaFactura(estado, id, extra) {
  if (id === "nuevo") return editor(estado, null, extra === "PRESUPUESTO" ? "PRESUPUESTO" : "FACTURA");
  if (id) {
    try { return extra === "editar" ? await editor(estado, await cargarBorrador(id)) : await ver(estado, id); }
    catch (e) { aviso(e.message); location.hash = "#/factura"; return; }
  }
  lista(estado);
}

// ------------------------------------------------------------------ lista
const fila = (x) => {
  const [txt, color] = ESTADOS[x.estado];
  const titulo = x.numero == null ? `${NOMBRE[x.tipo]} (borrador)` : `${NOMBRE[x.tipo]} ${numeroDoc(x)}`;
  return `<article class="fila" data-id="${x.id}">
    <div class="dato"><strong>${esc(titulo)}</strong>
      <small class="suave">${esc(x.cliente ?? "Sin cliente")}${x.fecha_emision ? " · " + fechaDoc(x.fecha_emision) : ""}</small>
      <small class="suave">${usd(x.total_usd)}${x.total_bs != null ? ` · Bs. ${bs(x.total_bs / 100)}` : ""}</small></div>
    <span class="insignia ${color}">${txt}</span>${x.modo === "PRACTICA" ? `<span class="insignia" title="Práctica">🧪</span>` : ""}</article>`;
};

function lista(estado) {
  raiz.innerHTML = `
    <header class="encabezado"><h1>🧾 Factura</h1><button class="icono azul" id="nuevo" data-ayuda="Crear un documento nuevo" aria-label="Nuevo">＋</button></header>
    ${bannerPractica(estado)}
    <div class="chips dos">${[["FACTURA", "🧾 Facturas"], ["PRESUPUESTO", "📋 Presupuestos"]].map(([v, t]) => `<button class="chip ${v === tab ? "activo" : ""}" data-t="${v}">${t}</button>`).join("")}</div>
    <input id="buscar" type="search" placeholder="🔎 Buscar por cliente o número" aria-label="Buscar" autocomplete="off">
    <div id="lista" class="lista"><p class="suave">Cargando…</p></div>
    ${navegacion("factura")}`;
  $("#nuevo").addEventListener("click", () => (location.hash = `#/factura/nuevo/${tab}`));
  activar();
  const cargar = async () => {
    if (!$("#buscar")) return; // la pantalla ya cambió
    const q = $("#buscar").value;
    try {
      const { documentos } = await api(`documentos?tipo=${tab}&q=${encodeURIComponent(q)}`);
      const caja = $("#lista"); if (!caja) return;
      caja.innerHTML = documentos.length ? documentos.map(fila).join("")
        : `<p class="suave">${q ? "Sin resultados." : `Aún no tienes ${tab === "FACTURA" ? "facturas" : "presupuestos"}. Toca ＋ para crear ${tab === "FACTURA" ? "la primera" : "el primero"}.`}</p>`;
      caja.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/factura/${el.dataset.id}`)));
    } catch (e) { if ($("#lista")) $("#lista").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  raiz.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.t; raiz.querySelectorAll(".chip").forEach((x) => x.classList.toggle("activo", x === b)); cargar();
  }));
  let espera; $("#buscar").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 250); });
  cargar();
}

// ------------------------------------------------------------------ editor de borradores
async function cargarBorrador(id) {
  const { documento: D, lineas } = await api(`documentos/${encodeURIComponent(id)}`);
  if (D.estado !== "BORRADOR") throw new Error("Solo se puede editar un borrador.");
  const cliente = D.cliente_id ? (await api(`clientes/${D.cliente_id}`)).cliente : null;
  return { id: D.id, tipo: D.tipo, cliente, nota: D.nota ?? "", lineas: lineas.map((l) => ({
    catalogo_id: l.catalogo_id, tipo: l.tipo, descripcion: l.descripcion, cantidad: cantidadTexto(l.cantidad_milli),
    precio: aTexto(l.precio_usd), alicuota_iva: l.alicuota_cent / 100, costo_usd: l.costo_usd })) };
}

function editor(estado, existente, tipoNuevo) {
  const d = existente ?? { id: null, tipo: tipoNuevo, cliente: null, nota: "", lineas: [] };
  const tasa = tasaInfo(estado), nombre = NOMBRE[d.tipo];
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver" aria-label="Volver">←</button><h1>${d.id ? `Editar ${nombre.toLowerCase()}` : d.tipo === "FACTURA" ? "Nueva factura" : "Nuevo presupuesto"}</h1></header>
    ${bannerPractica(estado)}
    <section class="tarjeta" id="sec-cliente"></section>
    <section class="tarjeta"><span class="etiqueta">🧾 RENGLONES</span><div id="lineas"></div>
      <div class="dos-botones"><button type="button" class="boton chico morado" id="add-inv">🏷️ Del inventario</button><button type="button" class="boton chico" id="add-srv">🛠️ Servicio al momento</button></div>
      <div id="picker" hidden></div></section>
    <section class="tarjeta" id="sec-totales"></section>
    <section class="tarjeta"><label for="nota">📝 Nota o garantía (sale en el PDF)</label><textarea id="nota" rows="3" maxlength="500">${esc(d.nota)}</textarea></section>
    <p class="error" id="error" role="alert" hidden></p>
    <button class="boton verde" type="button" id="emitir">EMITIR ${nombre.toUpperCase()}</button>
    <button class="boton contorno-azul" type="button" id="guardar">Guardar borrador</button>`;
  $("#atras").addEventListener("click", () => (location.hash = d.id ? `#/factura/${d.id}` : "#/factura"));

  // ---- cliente: elegir uno existente o crear uno nuevo sin salir de la pantalla
  const pintarCliente = () => {
    const s = $("#sec-cliente");
    if (d.cliente) {
      s.innerHTML = `<span class="etiqueta">👤 CLIENTE</span><div class="fila sin-borde"><div class="dato"><strong>${esc(d.cliente.nombre_apellido)}</strong><small class="suave">${esc(d.cliente.rif_cedula)}</small></div><button type="button" class="boton chico" id="cli-cambiar">Cambiar</button></div>`;
      $("#cli-cambiar").addEventListener("click", () => { d.cliente = null; pintarCliente(); });
      return;
    }
    s.innerHTML = `<span class="etiqueta">👤 CLIENTE</span>
      <input id="cli-q" type="search" placeholder="🔎 Buscar por nombre, RIF o WhatsApp" autocomplete="off" aria-label="Buscar cliente">
      <div id="cli-res" class="lista"></div>
      <button type="button" class="boton chico" id="cli-nuevo">＋ Cliente nuevo</button>
      <form id="cli-form" hidden>
        ${campo("rif_cedula", "🪪 Cédula o RIF", "", "text", 'required placeholder="V-12345678 o J-12345678-9" autocapitalize="characters"')}
        ${campo("nombre_apellido", "👤 Nombre y apellido (o razón social)", "", "text", "required")}
        ${campo("whatsapp", "📲 WhatsApp (opcional)", "", "tel", 'placeholder="0414-1234567"')}
        ${ERROR}<button class="boton" type="submit">GUARDAR Y USAR</button></form>`;
    const buscar = async () => {
      if (!$("#cli-q")) return; // el cliente ya fue elegido o la pantalla cambió
      try {
        const { clientes } = await api(`clientes?q=${encodeURIComponent($("#cli-q").value)}`);
        if (!$("#cli-res")) return;
        $("#cli-res").innerHTML = clientes.slice(0, 6).map((c) => `<article class="fila" data-c="${c.id}"><div class="dato"><strong>${esc(c.nombre_apellido)}</strong><small class="suave">${esc(c.rif_cedula)}</small></div></article>`).join("")
          || `<p class="suave">No hay coincidencias. Crea el cliente con «＋ Cliente nuevo».</p>`;
        $("#cli-res").querySelectorAll("[data-c]").forEach((el) => el.addEventListener("click", () => { d.cliente = clientes.find((c) => String(c.id) === el.dataset.c); pintarCliente(); }));
      } catch (e) { if ($("#cli-res")) $("#cli-res").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    let espera; $("#cli-q").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(buscar, 250); });
    $("#cli-nuevo").addEventListener("click", () => { $("#cli-form").hidden = !$("#cli-form").hidden; });
    enviar($("#cli-form"), async (v) => {
      const { id } = await api("clientes", "POST", v);
      d.cliente = (await api(`clientes/${id}`)).cliente; pintarCliente();
    });
    buscar();
  };

  // ---- renglones
  const pintarLineas = () => {
    $("#lineas").innerHTML = d.lineas.length ? d.lineas.map((l, i) => `
      <div class="reng" data-i="${i}">
        <div class="reng-cab"><span>${l.catalogo_id ? (l.tipo === "SERVICIO" ? "🛠️ Servicio" : "📦 Producto") : "🛠️ Servicio al momento"}</span><button type="button" class="x" data-quitar="${i}" aria-label="Quitar renglón">✕</button></div>
        <input data-campo="descripcion" value="${esc(l.descripcion)}" placeholder="Descripción" maxlength="200" aria-label="Descripción">
        <div class="reng-fila">
          <label>Cant.<input data-campo="cantidad" value="${esc(l.cantidad)}" inputmode="decimal" aria-label="Cantidad"></label>
          <label>Precio USD<input data-campo="precio" value="${esc(l.precio)}" inputmode="decimal" placeholder="0,00" aria-label="Precio en USD"></label>
          <label>IVA${l.catalogo_id ? `<span class="iva-fijo">${l.alicuota_iva ? l.alicuota_iva + "%" : "Exento"}</span>`
            : `<select data-campo="alicuota_iva" aria-label="IVA">${[[16, "16%"], [8, "8%"], [0, "Exento"]].map(([n, t]) => `<option value="${n}" ${n === l.alicuota_iva ? "selected" : ""}>${t}</option>`).join("")}</select>`}</label>
        </div>
        <small class="suave" data-sub="${i}"></small>
      </div>`).join("") : `<p class="suave">Agrega productos o servicios del inventario, o un servicio al momento.</p>`;
    refrescar();
  };
  const editarCampo = (e) => {
    const el = e.target.closest("[data-campo]"); if (!el) return;
    const l = d.lineas[Number(el.closest("[data-i]").dataset.i)], k = el.dataset.campo;
    l[k] = k === "alicuota_iva" ? Number(el.value) : el.value; refrescar();
  };
  $("#lineas").addEventListener("input", editarCampo); $("#lineas").addEventListener("change", editarCampo);
  $("#lineas").addEventListener("click", (e) => { const q = e.target.closest("[data-quitar]"); if (q) { d.lineas.splice(Number(q.dataset.quitar), 1); pintarLineas(); } });
  $("#add-srv").addEventListener("click", () => {
    d.lineas.push({ catalogo_id: null, tipo: "SERVICIO", descripcion: "", cantidad: "1", precio: "", alicuota_iva: 16, costo_usd: null });
    pintarLineas(); raiz.querySelector(`[data-i="${d.lineas.length - 1}"] [data-campo="descripcion"]`).focus();
  });
  $("#add-inv").addEventListener("click", () => {
    const p = $("#picker"); p.hidden = !p.hidden; if (p.hidden) return;
    p.innerHTML = `<input id="inv-q" type="search" placeholder="🔎 Buscar en el inventario" autocomplete="off" aria-label="Buscar en el inventario"><div id="inv-res" class="lista"></div>`;
    const cargar = async () => {
      if (!$("#inv-q")) return;
      try {
        const { items } = await api(`catalogo?q=${encodeURIComponent($("#inv-q").value)}`), activos = items.filter((i) => i.activo);
        if (!$("#inv-res")) return;
        $("#inv-res").innerHTML = activos.map((i) => `<article class="fila" data-it="${i.id}"><span class="icono-tipo ${i.tipo === "SERVICIO" ? "morado" : ""}">${i.tipo === "SERVICIO" ? "🛠️" : "📦"}</span>
          <div class="dato"><strong>${esc(i.nombre)}</strong><small class="suave">${i.precio_centavos == null ? "Precio a definir" : usd(i.precio_centavos)}</small></div></article>`).join("") || `<p class="suave">Nada por aquí. Crea productos y servicios en Inventario.</p>`;
        $("#inv-res").querySelectorAll("[data-it]").forEach((el) => el.addEventListener("click", () => {
          const it = activos.find((x) => String(x.id) === el.dataset.it);
          d.lineas.push({ catalogo_id: it.id, tipo: it.tipo, descripcion: it.nombre, cantidad: "1", precio: aTexto(it.precio_centavos), alicuota_iva: it.alicuota_iva, costo_usd: it.costo_centavos });
          p.hidden = true; pintarLineas();
        }));
      } catch (e) { if ($("#inv-res")) $("#inv-res").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    let espera; $("#inv-q").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 250); }); cargar();
  });

  // ---- totales en vivo (mismo cálculo que el servidor)
  const calculoActual = () => {
    const validas = []; let malas = 0;
    d.lineas.forEach((l, i) => {
      const cant = aCantidadMilli(l.cantidad), precio = aCentavos(l.precio);
      if (cant === null || Number.isNaN(cant) || precio === null || Number.isNaN(precio)) { malas++; return; }
      validas.push({ cantidad_milli: cant, precio_usd: precio, alicuota_cent: Math.round(l.alicuota_iva * 100), costo_usd: l.costo_usd, _i: i });
    });
    try { return { r: calcular(validas, tasa.e8), validas, malas }; } catch (e) { return { error: e.message, validas, malas }; }
  };
  function refrescar() {
    const c = calculoActual(), t = $("#sec-totales");
    if (c.error) { t.innerHTML = `<p class="error">${esc(c.error)}</p>`; return; }
    c.validas.forEach((v, k) => { const el = raiz.querySelector(`[data-sub="${v._i}"]`); if (el) el.textContent = `Subtotal ${usd(c.r.renglones[k].monto_usd)}${c.r.renglones[k].monto_bs != null ? ` · Bs. ${bs(c.r.renglones[k].monto_bs / 100)}` : ""}`; });
    d.lineas.forEach((l, i) => { if (!c.validas.some((v) => v._i === i)) { const el = raiz.querySelector(`[data-sub="${i}"]`); if (el) el.textContent = "⚠️ Revisa la cantidad y el precio (ejemplo: 1 y 12,50)"; } });
    const r = c.r, hayCosto = c.validas.some((v) => v.costo_usd != null);
    t.innerHTML = `<span class="etiqueta">💰 TOTALES</span>
      ${r.impuestos.map((i) => i.alicuota_cent === 0 ? `<div class="tot"><span>Monto exento</span><b>${usd(i.base_usd)}</b></div>`
        : `<div class="tot"><span>Base ${i.alicuota_cent / 100}% · IVA</span><b>${usd(i.base_usd)} · ${usd(i.iva_usd)}</b></div>`).join("")}
      <div class="tot grande"><span>TOTAL USD</span><b>${usd(r.total_usd)}</b></div>
      ${r.total_bs != null ? `<div class="tot"><span>Total en Bs.</span><b>Bs. ${bs(r.total_bs / 100)}</b></div>` : ""}
      <small class="suave">${tasa.e8 ? `Tasa BCV: Bs. ${bs(tasa.valor)}${tasa.vieja ? " · ⚠️ no se actualizó hoy" : " · actualizada hoy"}` : "⚠️ Define la tasa BCV en el Inicio para ver y emitir en Bs."}</small>
      ${hayCosto ? `<small class="ganancia-txt">🔒 Ganancia: ${usd(r.subtotal_usd - r.costo_total_usd)} (solo la ves tú)</small>` : ""}`;
  }

  // ---- guardar y emitir
  const cuerpo = () => ({ tipo: d.tipo, cliente_id: d.cliente?.id ?? null, nota: $("#nota").value,
    lineas: d.lineas.map((l) => ({ catalogo_id: l.catalogo_id, descripcion: l.descripcion, cantidad: l.cantidad, precio_usd: l.precio, alicuota_iva: l.alicuota_iva })) });
  const guardar = async () => { if (d.id) await api(`documentos/${d.id}`, "PUT", cuerpo()); else d.id = (await api("documentos", "POST", cuerpo())).id; };
  const ejecutar = async (fn) => {
    const err = $("#error"), botones = [$("#emitir"), $("#guardar")]; err.hidden = true; botones.forEach((b) => (b.disabled = true));
    try { await fn(); } catch (e) { err.textContent = e.message; err.hidden = false; } finally { botones.forEach((b) => (b.disabled = false)); }
  };
  $("#guardar").addEventListener("click", () => ejecutar(async () => { await guardar(); aviso("Borrador guardado ✅"); location.hash = `#/factura/${d.id}`; }));
  $("#emitir").addEventListener("click", () => ejecutar(async () => {
    if (!d.cliente) throw new Error("Elige el cliente primero.");
    const c = calculoActual();
    if (c.error) throw new Error(c.error);
    if (c.malas) throw new Error("Revisa los renglones: hay cantidades o precios con formato inválido.");
    if (!c.r.total_bs) throw new Error("Define la tasa BCV de hoy en el Inicio antes de emitir.");
    await guardar();
    const aviso1 = `¿Emitir ${nombre.toLowerCase()} a ${d.cliente.nombre_apellido} por ${usd(c.r.total_usd)} (Bs. ${bs(c.r.total_bs / 100)})?\n\nDespués NO se puede editar ni borrar: solo anular.`
      + `${estado.modo === "PRACTICA" ? "\n\n🧪 Modo práctica: es un documento de prueba." : ""}${tasa.vieja ? "\n\n⚠️ La tasa BCV no se actualizó hoy." : ""}`;
    if (!confirm(aviso1)) { aviso("Quedó guardado como borrador."); return; }
    await api(`documentos/${d.id}/emitir`, "POST");
    aviso(`${nombre} emitida ✅`); location.hash = `#/factura/${d.id}`;
  }));
  pintarCliente(); pintarLineas();
}

// ------------------------------------------------------------------ vista de un documento
let promesaPdf;
const cargarPdfLib = () => (window.PDFLib ? Promise.resolve(window.PDFLib) : (promesaPdf ??= new Promise((ok, mal) => {
  const s = document.createElement("script"); s.src = "/vendor/pdf-lib.min.js";
  s.onload = () => ok(window.PDFLib); s.onerror = () => { promesaPdf = null; mal(new Error("No se pudo cargar el generador de PDF.")); };
  document.head.appendChild(s);
})));

async function ver(estado, id) {
  const datos = await api(`documentos/${encodeURIComponent(id)}`), { documento: D, lineas, impuestos } = datos;
  const [estTxt, estColor] = ESTADOS[D.estado], emitido = D.estado !== "BORRADOR", reglas = JSON.parse(D.parametros_json || "{}");
  const cliente = D.cliente_nombre ? { nombre: D.cliente_nombre, rif: D.cliente_rif } : D.cliente_id ? await api(`clientes/${D.cliente_id}`).then((r) => ({ nombre: r.cliente.nombre_apellido, rif: r.cliente.rif_cedula })) : null;
  const sinControl = D.tipo === "FACTURA" && emitido && !D.control_fiscal;
  const titulo = D.tipo === "FACTURA" && emitido && !D.control_fiscal ? (reglas.titulo_sin_control || "Factura") : NOMBRE[D.tipo];
  const botones = D.estado === "BORRADOR"
    ? [["editar", "✏️ Editar", ""], ["emitir", `EMITIR ${NOMBRE[D.tipo].toUpperCase()}`, "verde"], ["borrar", "Eliminar borrador", "contorno"]]
    : [["pdf", "📄 Descargar PDF", ""], ["compartir", "📤 Compartir PDF", "verde"],
      ...(D.tipo === "PRESUPUESTO" && D.estado === "EMITIDO" ? [["convertir", "🧾 Convertir en factura", ""]] : []),
      ["copiar", "📑 Copiar como borrador nuevo", "contorno-azul"], ...(D.estado === "EMITIDO" ? [["anular", "⛔ Anular", "contorno"]] : [])];
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver a la lista" aria-label="Volver">←</button>
      <h1>${esc(titulo)} ${emitido ? esc(numeroDoc(D)) : "(borrador)"}</h1><span class="insignia ${estColor}">${estTxt}</span></header>
    ${D.modo === "PRACTICA" ? bannerPractica({ modo: "PRACTICA" }) : ""}
    ${D.estado === "ANULADO" ? `<section class="aviso-anulado">⛔ ANULADO el ${fechaDoc(D.anulado_en)} · Motivo: ${esc(D.motivo_anulacion)}</section>` : ""}
    ${sinControl ? `<section class="aviso-control">⚠️ ${esc(reglas.leyenda_sin_control || "Documento sin N.º de control fiscal")}</section>` : ""}
    <section class="tarjeta">
      <div class="tot"><span>Cliente</span><b>${cliente ? esc(cliente.nombre) : "(sin elegir)"}</b></div>
      ${cliente ? `<div class="tot"><span>RIF / C.I.</span><b>${esc(cliente.rif)}</b></div>` : ""}
      ${emitido ? `<div class="tot"><span>Fecha de emisión</span><b>${fechaDoc(D.fecha_emision)}</b></div>` : ""}
      ${D.tipo === "FACTURA" && emitido ? `<div class="tot"><span>Control interno</span><b>${String(D.control_interno).padStart(8, "0")}</b></div>
        <div class="tot"><span>N.º de control fiscal</span><b>${esc(D.control_fiscal || "No asignado")}</b></div>` : ""}
      ${emitido ? `<div class="tot"><span>Tasa BCV usada</span><b>Bs. ${bs(D.tasa_e8 / 1e8)}</b></div>` : ""}
    </section>
    <section class="tarjeta"><span class="etiqueta">🧾 RENGLONES</span>${lineas.map((l) => `<div class="reng-ver"><div><b>${esc(l.descripcion)}</b><br><small class="suave">${cantidadTexto(l.cantidad_milli)} × ${usd(l.precio_usd)} · ${l.alicuota_cent ? "IVA " + l.alicuota_cent / 100 + "%" : "Exento"}</small></div><b>${usd(l.monto_usd)}</b></div>`).join("")}</section>
    <section class="tarjeta"><span class="etiqueta">💰 TOTALES</span>
      ${emitido ? impuestos.map((i) => i.alicuota_cent === 0 ? `<div class="tot"><span>Monto exento</span><b>${usd(i.base_usd)} · Bs. ${bs(i.base_bs / 100)}</b></div>`
        : `<div class="tot"><span>Base ${i.alicuota_cent / 100}%</span><b>${usd(i.base_usd)} · Bs. ${bs(i.base_bs / 100)}</b></div><div class="tot"><span>IVA ${i.alicuota_cent / 100}%</span><b>${usd(i.iva_usd)} · Bs. ${bs(i.iva_bs / 100)}</b></div>`).join("") : ""}
      <div class="tot grande"><span>TOTAL</span><b>${usd(D.total_usd)}</b></div>
      ${emitido ? `<div class="tot"><span>Total en Bs.</span><b>Bs. ${bs(D.total_bs / 100)}</b></div>` : `<small class="suave">Los montos en Bs. se fijan al emitir, con la tasa BCV de ese momento.</small>`}
      ${D.costo_total_usd ? `<small class="ganancia-txt">🔒 Ganancia: ${usd(D.subtotal_usd - D.costo_total_usd)} (solo la ves tú)</small>` : ""}</section>
    ${D.nota ? `<section class="tarjeta"><span class="etiqueta">📝 NOTA</span><p>${esc(D.nota)}</p></section>` : ""}
    <p class="error" id="error" role="alert" hidden></p>
    ${botones.map(([id2, txt, clase]) => `<button type="button" class="boton ${clase}" data-acc="${id2}">${txt}</button>`).join("")}
    <form id="anular-form" class="tarjeta" hidden>${campo("motivo", "Motivo de la anulación (mínimo 5 letras)", "", "text", 'required minlength="5" maxlength="200"')}
      ${ERROR}<button class="boton rojo" type="submit">CONFIRMAR ANULACIÓN</button></form>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/factura"));
  const pedir = async (fn) => { try { await fn(); } catch (e) { const er = $("#error"); er.textContent = e.message; er.hidden = false; } };
  const blobPdf = async () => new Blob([await construirPdf(await cargarPdfLib(), { doc: D, lineas, impuestos })], { type: "application/pdf" });
  const accion = {
    editar: () => (location.hash = `#/factura/${id}/editar`),
    emitir: () => pedir(async () => {
      if (!confirm(`¿Emitir ${NOMBRE[D.tipo].toLowerCase()} por ${usd(D.total_usd)}?\n\nDespués NO se puede editar ni borrar: solo anular.`)) return;
      await api(`documentos/${id}/emitir`, "POST"); aviso("Emitida ✅"); await ver(estado, id);
    }),
    borrar: () => pedir(async () => { if (!confirm("¿Eliminar este borrador?")) return; await api(`documentos/${id}`, "DELETE"); aviso("Borrador eliminado"); location.hash = "#/factura"; }),
    pdf: () => pedir(async () => { const a = document.createElement("a"); a.href = URL.createObjectURL(await blobPdf()); a.download = nombreArchivo(D); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }),
    compartir: () => pedir(async () => {
      const blob = await blobPdf(), archivo = new File([blob], nombreArchivo(D), { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) { await navigator.share({ files: [archivo], title: nombreArchivo(D) }); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombreArchivo(D); a.click();
      aviso("Tu navegador no puede compartir archivos: se descargó el PDF.");
    }),
    convertir: () => pedir(async () => { const r = await api(`documentos/${id}/convertir`, "POST"); aviso("Borrador de factura creado"); location.hash = `#/factura/${r.id}`; }),
    copiar: () => pedir(async () => { const r = await api(`documentos/${id}/copiar`, "POST"); aviso("Copia creada como borrador"); location.hash = `#/factura/${r.id}`; }),
    anular: () => { $("#anular-form").hidden = false; $("#motivo").focus(); },
  };
  raiz.querySelectorAll("[data-acc]").forEach((b) => b.addEventListener("click", () => accion[b.dataset.acc]()));
  enviar($("#anular-form"), async (v) => { await api(`documentos/${id}/anular`, "POST", { motivo: v.motivo }); aviso("Documento anulado"); await ver(estado, id); });
}
