// Pantallas de INFORMES (Fase 6): menú de informes y cada informe con selector de periodo, vista compacta y exportación CSV / PDF.
// Todo el contenido sale de informe-tabla.js (mismo modelo para pantalla, CSV y PDF); aquí solo se dibuja y se descarga.
import { $, raiz, esc, api, aviso, navegacion, activar, descargar, cargarPdfLib, ERROR } from "./comun.js";
import { INFORMES, construirModelo, aCsv, construirPdfInforme, nombreArchivoInforme, hoyCaracas } from "./informe-tabla.js";

let periodo = null; // { preset, desde, hasta }: se recuerda al pasar de un informe a otro
let pedido = 0;     // contador para ignorar respuestas tardías

function rangoDe(preset, hoy) {
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7)), dd = (n) => String(n).padStart(2, "0");
  if (preset === "anio") return { desde: `${y}-01-01`, hasta: hoy };
  if (preset === "anterior") {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1, ultimo = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return { desde: `${py}-${dd(pm)}-01`, hasta: `${py}-${dd(pm)}-${dd(ultimo)}` };
  }
  return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
}

function menu() {
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver al inicio" aria-label="Volver">←</button><h1>📊 Informes</h1></header>
    <p class="suave">Para tu contador y para ti. Cada informe se puede descargar en CSV (Excel) o PDF.</p>
    <div class="lista">${INFORMES.map((i) => `<button type="button" class="fila" data-informe="${i.clave}" data-ayuda="${esc(i.ayuda)}">
      <span class="icono-tipo">${i.icono}</span><span class="dato"><strong>${esc(i.nombre)}</strong><small class="suave">${esc(i.ayuda)}</small></span><span aria-hidden="true">›</span></button>`).join("")}</div>
    ${navegacion("inicio")}`;
  $("#atras").addEventListener("click", () => (location.hash = "#/inicio"));
  raiz.querySelectorAll("[data-informe]").forEach((b) => b.addEventListener("click", () => (location.hash = `#/informes/${b.dataset.informe}`)));
  activar();
}

function tabla(s) {
  if (!s.filas.length) return `<p class="suave">Sin datos en este periodo.</p>`;
  const negrita = (f) => /^(Subtotal|TOTAL)/.test(f[0]);
  const fila = (f, extra = "") => `<tr class="${extra}${f.includes("ANULADA") ? " anulada" : ""}${negrita(f) ? " total" : ""}">${f.map((t, i) => `<${i === 0 && negrita(f) ? "th" : "td"}${s.columnas[i]?.der ? ' class="der"' : ""}>${esc(t)}</${i === 0 && negrita(f) ? "th" : "td"}>`).join("")}</tr>`;
  return `<div class="tabla-scroll"><table class="informe"><thead><tr>${s.columnas.map((c) => `<th${c.der ? ' class="der"' : ""}>${esc(c.t)}</th>`).join("")}</tr></thead>
    <tbody>${s.filas.map((f) => fila(f)).join("")}</tbody>${s.totales.length ? `<tfoot>${s.totales.map((f) => fila(f, "total")).join("")}</tfoot>` : ""}</table></div>`;
}

export async function vistaInformes(estado, clave) {
  const inf = INFORMES.find((i) => i.clave === clave);
  if (!inf) return menu();
  const hoy = hoyCaracas();
  if (!periodo) periodo = { preset: "mes", ...rangoDe("mes", hoy) };
  raiz.innerHTML = `
    <header class="encabezado"><button class="icono" id="atras" data-ayuda="Volver a informes" aria-label="Volver">←</button><h1>${inf.icono} ${esc(inf.nombre)}</h1></header>
    ${inf.periodo ? `<div class="chips" id="chips">${[["mes", "Este mes"], ["anterior", "Mes anterior"], ["anio", "Este año"], ["otro", "Otro"]]
      .map(([k, t]) => `<button type="button" class="chip${periodo.preset === k ? " activo" : ""}" data-preset="${k}">${t}</button>`).join("")}</div>
      <form id="rango" class="tarjeta" ${periodo.preset === "otro" ? "" : "hidden"}>
        <label for="desde">Desde</label><input id="desde" name="desde" type="date" value="${periodo.desde}" required max="${hoy}">
        <label for="hasta">Hasta</label><input id="hasta" name="hasta" type="date" value="${periodo.hasta}" required max="${hoy}">
        ${ERROR}<button class="boton chico" type="submit">Ver informe</button></form>` : ""}
    <div id="resultado"><p class="cargando">Cargando…</p></div>
    <section class="tarjeta" id="exportar" hidden><span class="etiqueta">⬇️ DESCARGAR</span>
      <div class="dos-botones"><button type="button" class="boton chico" id="csv">CSV (Excel)</button><button type="button" class="boton chico verde" id="pdf">PDF</button></div></section>`;
  $("#atras").addEventListener("click", () => (location.hash = "#/informes"));
  let ultimo = null; // { m, datos }

  async function cargar() {
    const mio = ++pedido;
    $("#exportar").hidden = true; $("#resultado").innerHTML = `<p class="cargando">Cargando…</p>`;
    try {
      const datos = await api(`informes/${clave}${inf.periodo ? `?desde=${periodo.desde}&hasta=${periodo.hasta}` : ""}`);
      if (mio !== pedido || !$("#resultado")) return; // llegó tarde: el usuario ya cambió de pantalla o de periodo
      const m = construirModelo(clave, datos); ultimo = { m, datos };
      $("#resultado").innerHTML = `
        <section class="tarjeta resumen"><span class="etiqueta">${esc(m.periodo)}${datos.modo === "PRACTICA" ? " · 🧪 PRÁCTICA" : ""}</span>
          <div class="res-rejilla">${m.resumen.map(([k, v]) => `<div class="res"><small class="suave">${esc(k)}</small><strong>${esc(v)}</strong></div>`).join("")}</div></section>
        ${m.secciones.map((s) => `<section class="tarjeta"><h2>${esc(s.titulo)}</h2>${tabla(s)}</section>`).join("")}
        ${m.notas.map((n) => `<p class="pista">${esc(n)}</p>`).join("")}`;
      $("#exportar").hidden = false;
    } catch (e) {
      if (mio !== pedido || !$("#resultado")) return;
      $("#resultado").innerHTML = `<p class="error" role="alert">${esc(e.message)}</p>`;
    }
  }

  if (inf.periodo) {
    raiz.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
      const preset = b.dataset.preset;
      raiz.querySelectorAll("[data-preset]").forEach((x) => x.classList.toggle("activo", x === b));
      $("#rango").hidden = preset !== "otro";
      if (preset === "otro") { periodo = { ...periodo, preset }; return; }
      periodo = { preset, ...rangoDe(preset, hoy) }; cargar();
    }));
    $("#rango").addEventListener("submit", (e) => {
      e.preventDefault();
      const desde = $("#desde").value, hasta = $("#hasta").value, err = $("#rango .error");
      err.hidden = true;
      if (!desde || !hasta || desde > hasta) { err.textContent = "Elige las dos fechas; «desde» no puede ser posterior a «hasta»."; err.hidden = false; return; }
      periodo = { preset: "otro", desde, hasta }; cargar();
    });
  }
  const exportar = (tipo) => async () => {
    if (!ultimo) return;
    try {
      const { m, datos } = ultimo;
      if (tipo === "csv") descargar(new Blob([aCsv(m, estado.negocio)], { type: "text/csv;charset=utf-8" }), nombreArchivoInforme(m, datos.modo, "csv", datos));
      else {
        const bytes = await construirPdfInforme(await cargarPdfLib(), m, { negocio: estado.negocio, modo: datos.modo });
        descargar(new Blob([bytes], { type: "application/pdf" }), nombreArchivoInforme(m, datos.modo, "pdf", datos));
      }
      aviso("Descargado ✅");
    } catch (e) { aviso(e.message); }
  };
  $("#csv").addEventListener("click", exportar("csv")); $("#pdf").addEventListener("click", exportar("pdf"));
  await cargar();
}
