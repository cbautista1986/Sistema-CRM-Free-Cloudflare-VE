// Front end sin compilar: se edita con cualquier editor de texto.
const raiz = document.getElementById("app");
const burbuja = document.getElementById("burbuja");
const $ = (s) => raiz.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const bs = (n) => Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaLocal = (f) => new Date(f.replace(" ", "T") + "Z").toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });

const ESPECIALIDADES = [
  ["SERVICIOS_EQUIPOS", "🛠️ Servicios + venta de equipos"],
  ["SOLO_SERVICIOS", "💼 Solo servicios profesionales"],
  ["MINIMERCADO", "🛒 Bodega / minimercado"],
];
const NEGOCIO = [
  ["nombre_razon_social", "🏷️ Nombre o razón social"], ["rif", "🪪 RIF o cédula"], ["direccion_fiscal", "📍 Dirección fiscal"],
  ["telefono", "📞 Teléfono"], ["email", "✉️ Correo del negocio"],
];
const COBRO = [
  ["datos_pago_movil", "📱 Pago móvil (banco, cédula o RIF, teléfono)"], ["datos_transferencia", "🏦 Transferencia (banco y n.º de cuenta)"],
  ["datos_zelle", "🟣 Zelle (correo y titular)"], ["datos_binance", "🟡 Binance Pay (correo o ID)"], ["datos_paypal", "🔵 PayPal (correo)"],
];
const NAV = [
  ["inicio", "🏠", "Inicio", ""], ["facturar", "🧾", "Facturar", "Fase 3"], ["bodega", "📦", "Bodega", "Fase 5"],
  ["clientes", "👥", "Clientes", "Fase 2"], ["info", "📊", "Info", "Fase 6"],
];
const ERROR = `<p class="error" role="alert" hidden></p>`;
let estado = {};

async function api(ruta, metodo = "GET", cuerpo) {
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
function aviso(texto) {
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

const campo = (id, etiqueta, valor = "", tipo = "text", extra = "") =>
  `<label for="${id}">${etiqueta}</label><input id="${id}" name="${id}" type="${tipo}" value="${esc(valor)}" ${extra}>`;

function enviar(form, accion) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = form.querySelector("button[type=submit]"), err = form.querySelector(".error");
    boton.disabled = true; err.hidden = true;
    try { await accion(Object.fromEntries(new FormData(form))); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { boton.disabled = false; }
  });
}

function navegacion(activo) {
  return `<nav class="nav">${NAV.map(([id, icono, nombre, fase]) =>
    `<button data-nombre="${nombre}" data-fase="${fase}" data-ayuda="${nombre}" class="${id === activo ? "activo" : ""}"><span>${icono}</span>${nombre}</button>`).join("")}</nav>`;
}
function activar() {
  raiz.querySelectorAll("[data-fase]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.fase) aviso(`${b.dataset.nombre || "Esta opción"} llega en la ${b.dataset.fase}`);
    else location.hash = "#/inicio";
  }));
}

function vistaInstalar() {
  raiz.innerHTML = `<section class="tarjeta"><h1>🛡️ Bienvenido</h1>
    <p class="suave">Crea tu cuenta de administrador. Esta pantalla se bloquea después.</p>
    <form id="f">
      ${campo("nombre", "👤 Nombre de tu negocio o personal", "", "text", 'required autocomplete="organization"')}
      ${campo("rif", "🪪 RIF o cédula", "", "text", 'required placeholder="J-12345678-9"')}
      ${campo("direccion", "📍 Dirección fiscal", "", "text", 'required autocomplete="street-address"')}
      ${campo("telefono", "📞 Teléfono", "", "tel", 'autocomplete="tel"')}
      ${campo("email", "✉️ Tu correo (será tu usuario)", "", "email", 'required autocomplete="username"')}
      ${campo("clave", "🔒 Contraseña (mínimo 10 caracteres)", "", "password", 'required minlength="10" autocomplete="new-password"')}
      <fieldset><legend>🎯 ¿Cuál es tu especialidad?</legend>
        ${ESPECIALIDADES.map(([v, t], i) => `<label class="opcion"><input type="radio" name="especialidad" value="${v}" ${i === 0 ? "checked" : ""}> ${t}</label>`).join("")}
      </fieldset>
      ${ERROR}<button class="boton" type="submit">CREAR SISTEMA Y ENTRAR ➔</button>
    </form></section>`;
  enviar($("#f"), async (d) => { await api("instalar", "POST", d); await ruta(); });
}

function vistaLogin() {
  raiz.innerHTML = `<section class="tarjeta"><h1>👋 Iniciar sesión</h1><p class="suave">Entra con tu correo y contraseña.</p>
    <form id="f">
      ${campo("email", "✉️ Correo", "", "email", 'required autocomplete="username"')}
      ${campo("clave", "🔒 Contraseña", "", "password", 'required autocomplete="current-password"')}
      ${ERROR}<button class="boton" type="submit">ENTRAR ➔</button>
    </form></section>`;
  enviar($("#f"), async (d) => { await api("login", "POST", d); await ruta(); });
}

function vistaInicio() {
  const n = estado.negocio, tasa = Number(n.tasa_bcv) || 0;
  raiz.innerHTML = `
    <header class="encabezado"><span class="logo">🖼️</span><h1>Hola, ${esc(n.nombre_razon_social)}</h1>
      <button class="icono" id="ajustes" data-ayuda="Ajustes del negocio, datos de cobro y cerrar sesión" aria-label="Ajustes">⚙️</button></header>
    <section class="tarjeta tasa">
      <div id="tasa-vista"><span class="etiqueta">🟢 TASA BCV</span><br><strong>${tasa ? `Bs. ${bs(tasa)}` : "Sin definir"}</strong><br>
        <small class="suave">${n.tasa_bcv_fecha ? `Actualizada: ${fechaLocal(n.tasa_bcv_fecha)}` : "Escribe la tasa de hoy"}</small></div>
      <form id="tasa-form" hidden><input name="tasa_bcv" inputmode="decimal" placeholder="Ej: 123,45" required aria-label="Tasa BCV">
        <button class="boton chico verde" type="submit">Guardar</button>${ERROR}</form>
      <button class="boton chico verde" id="tasa-editar" data-ayuda="Cambia la tasa BCV del día">🔄 Actualizar</button>
    </section>
    <section class="tarjeta ganancia"><span class="etiqueta">💰 TU GANANCIA NETA (ESTE MES)</span><strong>$ 0,00</strong>
      <small class="suave">🟣 Por servicios: $0 · 🔵 Reventa de equipos: $0</small></section>
    <div class="rejilla">
      <button class="accion azul" data-fase="Fase 3" data-nombre="Nueva factura o servicio" data-ayuda="Crea una factura o cobra un servicio"><span>⚡</span>Nueva factura o servicio</button>
      <button class="accion ambar" data-fase="Fase 3" data-nombre="Nuevo presupuesto" data-ayuda="Crea un presupuesto sin mover inventario"><span>📋</span>Nuevo presupuesto</button>
      <button class="accion verde" data-fase="Fase 4" data-nombre="Enviar mis datos de pago" data-ayuda="Envía tus datos de pago por WhatsApp"><span>📲</span>Enviar mis datos de pago</button>
      <button class="accion morado" data-fase="Fase 4" data-nombre="Por cobrar / trabajos" data-ayuda="Trabajos en curso y cuentas por cobrar"><span>⏳</span>Por cobrar / trabajos</button>
    </div>
    <section class="tarjeta"><span class="etiqueta">🔔 ALERTAS RÁPIDAS</span><p class="suave">Todo en orden ✅</p></section>
    ${navegacion("inicio")}`;
  $("#ajustes").addEventListener("click", () => (location.hash = "#/ajustes"));
  $("#tasa-editar").addEventListener("click", () => {
    $("#tasa-vista").hidden = true; $("#tasa-editar").hidden = true; $("#tasa-form").hidden = false; $("#tasa-form input").focus();
  });
  enviar($("#tasa-form"), async (d) => { await api("config", "PUT", { tasa_bcv: d.tasa_bcv }); aviso("Tasa actualizada ✅"); await ruta(); });
  activar();
}

function vistaAjustes() {
  const n = estado.negocio;
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver al inicio" aria-label="Volver">←</button><h1>Ajustes</h1></header>
    <form id="f" class="tarjeta">
      ${NEGOCIO.map(([id, et]) => campo(id, et, n[id])).join("")}
      <label for="especialidad">🎯 Especialidad</label>
      <select id="especialidad" name="especialidad">${ESPECIALIDADES.map(([v, t]) => `<option value="${v}" ${v === n.especialidad ? "selected" : ""}>${t}</option>`).join("")}</select>
      <h2>💳 Mis datos de cobro</h2><p class="suave">Se enviarán a tus clientes junto con el monto en Bs y USD.</p>
      ${COBRO.map(([id, et]) => campo(id, et, n[id])).join("")}
      ${ERROR}<button class="boton verde" type="submit">GUARDAR CAMBIOS</button>
    </form>
    <p class="suave">Sesión: ${esc(estado.usuario.email)}</p>
    <button class="boton contorno" id="salir">Cerrar sesión</button>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/inicio"));
  $("#salir").addEventListener("click", async () => { await api("logout", "POST"); history.replaceState(null, "", "/"); await ruta(); });
  enviar($("#f"), async (d) => { await api("config", "PUT", d); aviso("Guardado ✅"); location.hash = "#/inicio"; });
}

async function ruta() {
  try {
    estado = await api("estado");
    if (!estado.instalado) return vistaInstalar();
    if (!estado.sesion) return vistaLogin();
    location.hash === "#/ajustes" ? vistaAjustes() : vistaInicio();
  } catch (e) {
    raiz.innerHTML = `<section class="tarjeta"><h1>⚠️ No se pudo cargar</h1><p class="error">${esc(e.message)}</p><button class="boton" id="reintentar">Reintentar</button></section>`;
    $("#reintentar").addEventListener("click", ruta);
  }
}
window.addEventListener("hashchange", ruta);
ruta();
