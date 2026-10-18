// Módulo CLIENTES: /api/clientes
import { Hono } from "hono";
import { EMAIL, RIF, auditar, comodin, esForanea, esUnico, falla, idParam, leerJson, requiereSesion, texto, type Env } from "../comun";

const clientes = new Hono<Env>();
clientes.use("*", requiereSesion);

const COLUMNAS = "id, rif_cedula, nombre_apellido, direccion, whatsapp, email";

function validar(b: Record<string, unknown>) {
  const rif = texto(b.rif_cedula, 20).toUpperCase(), nombre = texto(b.nombre_apellido, 120);
  const direccion = texto(b.direccion, 200) || null, whatsapp = texto(b.whatsapp, 30) || null;
  const email = texto(b.email, 120).toLowerCase() || null;
  if (!RIF.test(rif)) return "La cédula o el RIF no es válido (ejemplos: V-12345678, J-12345678-9).";
  if (nombre.length < 2) return "Escribe el nombre y apellido (o la razón social).";
  if (email && !EMAIL.test(email)) return "El correo no es válido.";
  if (whatsapp && !/^[\d\s+()-]{7,30}$/.test(whatsapp)) return "El WhatsApp solo puede tener números, espacios, + y guiones.";
  return { rif, nombre, direccion, whatsapp, email };
}

clientes.get("/", async (c) => {
  const q = texto(c.req.query("q"), 60), like = `%${comodin(q)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNAS} FROM clientes
     WHERE ? = '' OR nombre_apellido LIKE ? ESCAPE '\\' OR rif_cedula LIKE ? ESCAPE '\\' OR whatsapp LIKE ? ESCAPE '\\'
     ORDER BY nombre_apellido COLLATE NOCASE LIMIT 100`
  ).bind(q, like, like, like).all();
  return c.json({ ok: true, clientes: results });
});

clientes.get("/:id", async (c) => {
  const f = await c.env.DB.prepare(`SELECT ${COLUMNAS} FROM clientes WHERE id = ?`).bind(idParam(c)).first();
  return f ? c.json({ ok: true, cliente: f }) : falla(c, 404, "Cliente no encontrado.");
});

clientes.post("/", async (c) => {
  const v = validar(await leerJson(c));
  if (typeof v === "string") return falla(c, 400, v);
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO clientes (rif_cedula, nombre_apellido, direccion, whatsapp, email) VALUES (?, ?, ?, ?, ?)`
    ).bind(v.rif, v.nombre, v.direccion, v.whatsapp, v.email).run();
    await auditar(c, c.get("usuario").id, "CLIENTE_CREAR", v.rif);
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e) {
    if (esUnico(e)) return falla(c, 409, "Ya existe un cliente con esa cédula o RIF.");
    throw e;
  }
});

clientes.put("/:id", async (c) => {
  const id = idParam(c), v = validar(await leerJson(c));
  if (typeof v === "string") return falla(c, 400, v);
  try {
    const r = await c.env.DB.prepare(
      `UPDATE clientes SET rif_cedula = ?, nombre_apellido = ?, direccion = ?, whatsapp = ?, email = ? WHERE id = ?`
    ).bind(v.rif, v.nombre, v.direccion, v.whatsapp, v.email, id).run();
    if (!r.meta.changes) return falla(c, 404, "Cliente no encontrado.");
    await auditar(c, c.get("usuario").id, "CLIENTE_EDITAR", `${id} ${v.rif}`);
    return c.json({ ok: true });
  } catch (e) {
    if (esUnico(e)) return falla(c, 409, "Ya existe otro cliente con esa cédula o RIF.");
    throw e;
  }
});

clientes.delete("/:id", async (c) => {
  const id = idParam(c);
  try {
    const r = await c.env.DB.prepare(`DELETE FROM clientes WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) return falla(c, 404, "Cliente no encontrado.");
    await auditar(c, c.get("usuario").id, "CLIENTE_ELIMINAR", String(id));
    return c.json({ ok: true });
  } catch (e) {
    if (esForanea(e)) return falla(c, 409, "Este cliente ya tiene documentos y no se puede eliminar.");
    throw e;
  }
});

export default clientes;
