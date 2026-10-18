// Entrada de la aplicación: instalador, login, inicio y ajustes. Cada módulo vive en su propio archivo.
import { $, raiz, esc, bs, fechaLocal, api, aviso, campo, enviar, navegacion, activar, ERROR } from "./comun.js";
import { vistaClientes } from "./clientes.js";
import { vistaCatalogo } from "./catalogo.js";

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
let estado = {};

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
      <button class="boton chico verde" id="tasa-editar" data-ayuda="Cambia la tasa BCV del día">🔄 Actualizar</button>
      <form id="tasa-form" hidden><span class="etiqueta">🟢 TASA BCV DE HOY (Bs por USD)</span>
        <input name="tasa_bcv" inputmode="decimal" placeholder="Ej: 123,45" required aria-label="Tasa BCV">
        <button class="boton chico verde" type="submit">Guardar</button>
        <button class="boton chico contorno" type="button" id="tasa-cancelar" aria-label="Cancelar">✕</button>${ERROR}</form>
    </section>
    <section class="tarjeta ganancia"><span class="etiqueta">💰 TU GANANCIA NETA (ESTE MES)</span><strong>$ 0,00</strong>
      <small class="suave">🟣 Por servicios: $0 · 🔵 Reventa de equipos: $0</small></section>
    <div class="rejilla">
      <button class="accion azul" data-destino="Fase 3" data-nombre="Nueva factura o servicio" data-ayuda="Crea una factura o cobra un servicio"><span>⚡</span>Nueva factura o servicio</button>
      <button class="accion ambar" data-destino="Fase 3" data-nombre="Nuevo presupuesto" data-ayuda="Crea un presupuesto sin mover inventario"><span>📋</span>Nuevo presupuesto</button>
      <button class="accion verde" data-destino="Fase 4" data-nombre="Enviar mis datos de pago" data-ayuda="Envía tus datos de pago por WhatsApp"><span>📲</span>Enviar mis datos de pago</button>
      <button class="accion morado" data-destino="Fase 4" data-nombre="Por cobrar / trabajos" data-ayuda="Trabajos en curso y cuentas por cobrar"><span>⏳</span>Por cobrar / trabajos</button>
    </div>
    <section class="tarjeta"><span class="etiqueta">🔔 ALERTAS RÁPIDAS</span><p class="suave">Todo en orden ✅</p></section>
    ${navegacion("inicio")}`;
  $("#ajustes").addEventListener("click", () => (location.hash = "#/ajustes"));
  const editando = (si) => { $("#tasa-vista").hidden = si; $("#tasa-editar").hidden = si; $("#tasa-form").hidden = !si; if (si) $("#tasa-form input").focus(); };
  $("#tasa-editar").addEventListener("click", () => editando(true));
  $("#tasa-cancelar").addEventListener("click", () => editando(false));
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
    const [seccion, id] = location.hash.replace(/^#\/?/, "").split("/");
    if (seccion === "ajustes") return vistaAjustes();
    if (seccion === "clientes") return await vistaClientes(estado, id);
    if (seccion === "catalogo") return await vistaCatalogo(estado, id);
    vistaInicio();
  } catch (e) {
    raiz.innerHTML = `<section class="tarjeta"><h1>⚠️ No se pudo cargar</h1><p class="error">${esc(e.message)}</p><button class="boton" id="reintentar">Reintentar</button></section>`;
    $("#reintentar").addEventListener("click", ruta);
  }
}
window.addEventListener("hashchange", ruta);
ruta();
