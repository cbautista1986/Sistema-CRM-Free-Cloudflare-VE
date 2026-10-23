// Entrada de la aplicación: instalador, login, inicio y ajustes. Cada módulo vive en su propio archivo.
import { $, raiz, esc, bs, usd, fechaLocal, api, aviso, campo, enviar, navegacion, activar, ERROR } from "./comun.js";
import { vistaClientes } from "./clientes.js";
import { vistaCatalogo } from "./catalogo.js";
import { vistaFactura } from "./factura.js";

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
    ${estado.modo === "PRACTICA" ? `<section class="aviso-practica"><b>🧪 MODO PRÁCTICA</b> · los documentos son de prueba y se borran al salir en vivo (Ajustes).</section>` : ""}
    <section class="tarjeta tasa">
      <div id="tasa-vista"><span class="etiqueta">🟢 TASA BCV</span><br><strong>${tasa ? `Bs. ${bs(tasa)}` : "Sin definir"}</strong><br>
        <small class="suave">${n.tasa_bcv_fecha ? `Actualizada: ${fechaLocal(n.tasa_bcv_fecha)}` : "Escribe la tasa de hoy"}</small></div>
      <button class="boton chico verde" id="tasa-editar" data-ayuda="Cambia la tasa BCV del día">🔄 Actualizar</button>
      <form id="tasa-form" hidden><span class="etiqueta">🟢 TASA BCV DE HOY (Bs por USD)</span>
        <input name="tasa_bcv" inputmode="decimal" placeholder="Ej: 123,45" required aria-label="Tasa BCV">
        <button class="boton chico verde" type="submit">Guardar</button>
        <button class="boton chico contorno" type="button" id="tasa-cancelar" aria-label="Cancelar">✕</button>${ERROR}</form>
    </section>
    <section class="tarjeta ganancia" data-destino="Fase 6" data-nombre="Informes" data-ayuda="Informes de ventas y ganancias"><span class="etiqueta">💰 TU GANANCIA NETA (ESTE MES)</span><strong id="gan-total">$ 0,00</strong>
      <small class="suave" id="gan-det">🟣 Servicios: $0 · 🔵 Productos: $0</small></section>
    <div class="rejilla">
      <button class="accion azul" data-destino="#/factura" data-nombre="Factura" data-ayuda="Presupuestos y facturas"><span>🧾</span>Factura<small>Presupuestos y facturas</small></button>
      <button class="accion ambar" data-destino="#/clientes" data-nombre="Clientes" data-ayuda="Tus clientes y su WhatsApp"><span>👥</span>Clientes<small>Tus clientes</small></button>
      <button class="accion verde" data-destino="Fase 4" data-nombre="Pagos" data-ayuda="Por cobrar, pagos recibidos y tus datos de cobro"><span>💳</span>Pagos<small>Cobros y por cobrar</small></button>
      <button class="accion morado" data-destino="#/inventario" data-nombre="Inventario" data-ayuda="Tus productos y servicios"><span>📦</span>Inventario<small>Productos y servicios</small></button>
    </div>
    <section class="tarjeta"><span class="etiqueta">🔔 ALERTAS RÁPIDAS</span><p class="suave">Todo en orden ✅</p></section>
    ${navegacion("inicio")}`;
  $("#ajustes").addEventListener("click", () => (location.hash = "#/ajustes"));
  const editando = (si) => { $("#tasa-vista").hidden = si; $("#tasa-editar").hidden = si; $("#tasa-form").hidden = !si; if (si) $("#tasa-form input").focus(); };
  $("#tasa-editar").addEventListener("click", () => editando(true));
  $("#tasa-cancelar").addEventListener("click", () => editando(false));
  enviar($("#tasa-form"), async (d) => { await api("config", "PUT", { tasa_bcv: d.tasa_bcv }); aviso("Tasa actualizada ✅"); await ruta(); });
  activar();
  api("documentos/resumen").then((r) => { // ganancia real del mes (facturas emitidas)
    $("#gan-total").textContent = usd(r.total); $("#gan-det").textContent = `🟣 Servicios: ${usd(r.servicios)} · 🔵 Productos: ${usd(r.productos)}`;
  }).catch(() => {});
}

function vistaAjustes() {
  const n = estado.negocio;
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver al inicio" aria-label="Volver">←</button><h1>Ajustes</h1></header>
    <form id="f" class="tarjeta">
      ${NEGOCIO.map(([id, et]) => campo(id, et, n[id])).join("")}
      <h2>💳 Mis datos de cobro</h2><p class="suave">Se enviarán a tus clientes junto con el monto en Bs y USD.</p>
      ${COBRO.map(([id, et]) => campo(id, et, n[id])).join("")}
      ${ERROR}<button class="boton verde" type="submit">GUARDAR CAMBIOS</button>
    </form>
    ${estado.modo === "PRACTICA" ? `<section class="tarjeta"><h2>🧪 Modo práctica</h2>
      <p class="suave">Mientras estés en práctica, las facturas y presupuestos son de prueba: llevan marca de agua, no valen y se borran al salir en vivo. Cuando todo esté probado y revisado con tu contador, sal en vivo para empezar la numeración real.</p>
      <form id="vivo">
        ${campo("primer_factura", "🧾 Primer N.º de factura", "1", "text", 'inputmode="numeric" required')}
        ${campo("primer_control", "🔢 Primer N.º de control interno", "1", "text", 'inputmode="numeric" required')}
        ${campo("primer_presupuesto", "📋 Primer N.º de presupuesto", "1", "text", 'inputmode="numeric" required')}
        <label class="opcion"><input type="checkbox" name="confirmo"> Entiendo que se BORRAN los documentos de práctica y que NO se puede volver atrás.</label>
        ${ERROR}<button class="boton rojo" type="submit">SALIR EN VIVO</button></form></section>`
      : `<section class="tarjeta"><h2>✅ En vivo</h2><p class="suave">El sistema está en modo real: las facturas emitidas no se pueden editar ni borrar, solo anular.</p></section>`}
    <section class="tarjeta"><h2>💾 Respaldo</h2><p class="suave">Descarga una copia de todos tus datos (clientes, inventario y documentos). Guárdala fuera del sistema, en un lugar seguro.</p>
      <button class="boton" id="respaldo" type="button">⬇️ Exportar respaldo</button></section>
    <p class="suave">Sesión: ${esc(estado.usuario.email)}</p>
    <button class="boton contorno" id="salir">Cerrar sesión</button>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/inicio"));
  $("#salir").addEventListener("click", async () => { await api("logout", "POST"); history.replaceState(null, "", "/"); await ruta(); });
  enviar($("#f"), async (d) => { await api("config", "PUT", d); aviso("Guardado ✅"); location.hash = "#/inicio"; });
  if ($("#vivo")) enviar($("#vivo"), async (d) => {
    await api("sistema/salir-en-vivo", "POST", { primer_factura: Number(d.primer_factura), primer_control: Number(d.primer_control),
      primer_presupuesto: Number(d.primer_presupuesto), confirmo: d.confirmo === "on" });
    aviso("El sistema está en vivo ✅"); await ruta();
  });
  $("#respaldo").addEventListener("click", async () => {
    try {
      const r = await fetch("/api/sistema/respaldo"); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo descargar el respaldo.");
      const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = `respaldo-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000); aviso("Respaldo descargado ✅");
    } catch (e) { aviso(e.message); }
  });
}

async function ruta() {
  try {
    estado = await api("estado");
    if (!estado.instalado) return vistaInstalar();
    if (!estado.sesion) return vistaLogin();
    const [seccion, id, extra] = location.hash.replace(/^#\/?/, "").split("/");
    if (seccion === "ajustes") return vistaAjustes();
    if (seccion === "clientes") return await vistaClientes(estado, id);
    if (seccion === "factura") return await vistaFactura(estado, id, extra);
    if (seccion === "inventario" || seccion === "catalogo") return await vistaCatalogo(estado, id);
    vistaInicio();
  } catch (e) {
    raiz.innerHTML = `<section class="tarjeta"><h1>⚠️ No se pudo cargar</h1><p class="error">${esc(e.message)}</p><button class="boton" id="reintentar">Reintentar</button></section>`;
    $("#reintentar").addEventListener("click", ruta);
  }
}
window.addEventListener("hashchange", ruta);
ruta();
