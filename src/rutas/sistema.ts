// Módulo SISTEMA (solo administrador): salir del modo práctica y respaldo completo.
import { Hono } from "hono";
import { auditar, falla, fechaCaracas, leerJson, modoActual, requiereAdmin, requiereSesion, type Env } from "../comun";

const sistema = new Hono<Env>();
sistema.use("*", requiereSesion, requiereAdmin);

const entero = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 999999999 ? n : 0; };

// Sale del modo práctica UNA vez: borra los documentos de prueba y fija con qué número empieza lo real.
sistema.post("/salir-en-vivo", async (c) => {
  const db = c.env.DB, b = await leerJson(c);
  const f = entero(b.primer_factura), k = entero(b.primer_control), p = entero(b.primer_presupuesto);
  if (!f || !k || !p) return falla(c, 400, "Escribe los tres números iniciales (mínimo 1).");
  if (b.confirmo !== true) return falla(c, 400, "Marca la casilla para confirmar.");
  if ((await modoActual(db)) !== "PRACTICA") return falla(c, 409, "El sistema ya está en vivo.");
  await db.batch([
    db.prepare(`DELETE FROM documento_impuestos WHERE documento_id IN (SELECT id FROM documentos WHERE modo = 'PRACTICA')`),
    db.prepare(`DELETE FROM documento_renglones WHERE documento_id IN (SELECT id FROM documentos WHERE modo = 'PRACTICA')`),
    db.prepare(`UPDATE documentos SET presupuesto_id = NULL WHERE modo = 'PRACTICA'`),
    db.prepare(`DELETE FROM documentos WHERE modo = 'PRACTICA'`),
    db.prepare(`UPDATE contadores SET valor = 0 WHERE clave LIKE '%:PRACTICA'`),
    db.prepare(`UPDATE contadores SET valor = ? WHERE clave = 'FACTURA:REAL'`).bind(f - 1),
    db.prepare(`UPDATE contadores SET valor = ? WHERE clave = 'CONTROL:REAL'`).bind(k - 1),
    db.prepare(`UPDATE contadores SET valor = ? WHERE clave = 'PRESUPUESTO:REAL'`).bind(p - 1),
    db.prepare(`UPDATE ajustes SET valor = 'REAL' WHERE clave = 'modo'`),
  ]);
  await auditar(c, c.get("usuario").id, "SALIR_EN_VIVO", `factura ${f}, control ${k}, presupuesto ${p}`);
  return c.json({ ok: true });
});

// Copia completa de los datos (sin contraseñas ni sesiones) para guardarla fuera del sistema.
const TABLAS = ["perfil_emisor", "clientes", "catalogo", "documentos", "documento_renglones", "documento_impuestos", "contadores", "parametros_fiscales", "ajustes", "auditoria"];
sistema.get("/respaldo", async (c) => {
  const datos: Record<string, unknown> = { generado_en: new Date().toISOString(), version: 1 };
  for (const t of TABLAS) datos[t] = (await c.env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  datos.usuarios = (await c.env.DB.prepare(`SELECT id, nombre, email, rol, creado_en FROM usuarios`).all()).results;
  await auditar(c, c.get("usuario").id, "RESPALDO");
  return new Response(JSON.stringify(datos), { headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="respaldo-${fechaCaracas()}.json"` } });
});

export default sistema;
