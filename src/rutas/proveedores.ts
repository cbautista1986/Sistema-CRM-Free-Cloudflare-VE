// Módulo PROVEEDORES: /api/proveedores
import { Hono } from "hono";
import { EMAIL, RIF, auditar, comodin, esForanea, esUnico, falla, idParam, leerJson, normalizarWhatsapp, requiereSesion, texto, type Env } from "../comun";

const proveedores = new Hono<Env>();
proveedores.use("*", requiereSesion);
const COLUMNAS = "id, rif, nombre, direccion, whatsapp, email";

function validar(b: Record<string, unknown>) {
  const rif = texto(b.rif, 20).toUpperCase(), nombre = texto(b.nombre, 120);
  const direccion = texto(b.direccion, 200) || null, whatsapp = normalizarWhatsapp(texto(b.whatsapp, 40));
  const email = texto(b.email, 120).toLowerCase() || null;
  if (!RIF.test(rif)) return "El RIF o la cédula no es válido (ejemplos: J-12345678-9, V-12345678).";
  if (nombre.length < 2) return "Escribe el nombre o la razón social.";
  if (email && !EMAIL.test(email)) return "El correo no es válido.";
  if (whatsapp !== null && typeof whatsapp === "object") return whatsapp.error;
  return { rif, nombre, direccion, whatsapp, email };
}

proveedores.get("/", async (c) => {
  const q = texto(c.req.query("q"), 60), like = `%${comodin(q)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNAS} FROM proveedores WHERE ? = '' OR nombre LIKE ? ESCAPE '\\' OR rif LIKE ? ESCAPE '\\' ORDER BY nombre COLLATE NOCASE LIMIT 100`
  ).bind(q, like, like).all();
  return c.json({ ok: true, proveedores: results });
});

proveedores.get("/:id", async (c) => {
  const f = await c.env.DB.prepare(`SELECT ${COLUMNAS} FROM proveedores WHERE id = ?`).bind(idParam(c)).first();
  return f ? c.json({ ok: true, proveedor: f }) : falla(c, 404, "Proveedor no encontrado.");
});

proveedores.post("/", async (c) => {
  const v = validar(await leerJson(c));
  if (typeof v === "string") return falla(c, 400, v);
  try {
    const r = await c.env.DB.prepare(`INSERT INTO proveedores (rif, nombre, direccion, whatsapp, email) VALUES (?, ?, ?, ?, ?)`)
      .bind(v.rif, v.nombre, v.direccion, v.whatsapp, v.email).run();
    await auditar(c, c.get("usuario").id, "PROVEEDOR_CREAR", v.rif);
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e) {
    if (esUnico(e)) return falla(c, 409, "Ya existe un proveedor con ese RIF.");
    throw e;
  }
});

proveedores.put("/:id", async (c) => {
  const id = idParam(c), v = validar(await leerJson(c));
  if (typeof v === "string") return falla(c, 400, v);
  try {
    const r = await c.env.DB.prepare(`UPDATE proveedores SET rif = ?, nombre = ?, direccion = ?, whatsapp = ?, email = ? WHERE id = ?`)
      .bind(v.rif, v.nombre, v.direccion, v.whatsapp, v.email, id).run();
    if (!r.meta.changes) return falla(c, 404, "Proveedor no encontrado.");
    await auditar(c, c.get("usuario").id, "PROVEEDOR_EDITAR", `${id} ${v.rif}`);
    return c.json({ ok: true });
  } catch (e) {
    if (esUnico(e)) return falla(c, 409, "Ya existe otro proveedor con ese RIF.");
    throw e;
  }
});

proveedores.delete("/:id", async (c) => {
  const id = idParam(c);
  try {
    const r = await c.env.DB.prepare(`DELETE FROM proveedores WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) return falla(c, 404, "Proveedor no encontrado.");
    await auditar(c, c.get("usuario").id, "PROVEEDOR_ELIMINAR", String(id));
    return c.json({ ok: true });
  } catch (e) {
    if (esForanea(e)) return falla(c, 409, "Este proveedor ya tiene compras y no se puede eliminar.");
    throw e;
  }
});

export default proveedores;
