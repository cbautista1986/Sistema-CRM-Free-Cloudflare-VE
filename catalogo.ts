// Módulo CATÁLOGO (servicios y productos): /api/catalogo
import { Hono } from "hono";
import { aCentavos, auditar, comodin, esForanea, esUnico, falla, idParam, leerJson, requiereSesion, texto, type Env } from "../comun";

const catalogo = new Hono<Env>();
catalogo.use("*", requiereSesion);

const COLUMNAS = "id, codigo, nombre, tipo, costo_centavos, precio_centavos, alicuota_iva, activo";
const TIPOS = ["SERVICIO", "PRODUCTO"], IVAS = [0, 8, 16];

function validar(b: Record<string, unknown>) {
  const nombre = texto(b.nombre, 120), tipo = texto(b.tipo, 10) || "SERVICIO";
  const codigo = texto(b.codigo, 30).toUpperCase() || null;
  const costo = aCentavos(b.costo_usd), precio = aCentavos(b.precio_usd), iva = Number(b.alicuota_iva ?? 16);
  const activo = String(b.activo ?? "1") === "0" ? 0 : 1;
  if (nombre.length < 2) return "Escribe el nombre.";
  if (!TIPOS.includes(tipo)) return "El tipo no es válido.";
  if (Number.isNaN(costo) || Number.isNaN(precio)) return "Escribe los montos solo con números (ejemplo: 12,50).";
  if (tipo === "PRODUCTO" && !precio) return "Un producto necesita su precio de venta.";
  if (!IVAS.includes(iva)) return "El IVA no es válido.";
  return { nombre, tipo, codigo, costo, precio, iva, activo }; // precio vacío en un servicio = "se define al facturar"
}

catalogo.get("/", async (c) => {
  const q = texto(c.req.query("q"), 60), like = `%${comodin(q)}%`, tipo = texto(c.req.query("tipo"), 10);
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNAS} FROM catalogo
     WHERE (? = '' OR nombre LIKE ? ESCAPE '\\' OR codigo LIKE ? ESCAPE '\\') AND (? = '' OR tipo = ?)
     ORDER BY activo DESC, nombre COLLATE NOCASE LIMIT 200`
  ).bind(q, like, like, tipo, tipo).all();
  return c.json({ ok: true, items: results });
});

catalogo.get("/:id", async (c) => {
  const f = await c.env.DB.prepare(`SELECT ${COLUMNAS} FROM catalogo WHERE id = ?`).bind(idParam(c)).first();
  return f ? c.json({ ok: true, item: f }) : falla(c, 404, "No encontrado.");
});

catalogo.post("/", async (c) => {
  const v = validar(await leerJson(c));
  if (typeof v === "string") return falla(c, 400, v);
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO catalogo (codigo, nombre, tipo, costo_centavos, precio_centavos, alicuota_iva, activo) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(v.codigo, v.nombre, v.tipo, v.costo, v.precio, v.iva, v.activo).run();
    await auditar(c, c.get("usuario").id, "CATALOGO_CREAR", v.nombre);
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e) {
    if (esUnico(e)) return falla(c, 409, "Ya existe algo con ese código.");
    throw e;
  }
});

catalogo.put("/:id", async (c) => {
  const id = idParam(c), v = validar(await leerJson(c));
  if (typeof v === "string") return falla(c, 400, v);
  try {
    const r = await c.env.DB.prepare(
      `UPDATE catalogo SET codigo = ?, nombre = ?, tipo = ?, costo_centavos = ?, precio_centavos = ?, alicuota_iva = ?, activo = ? WHERE id = ?`
    ).bind(v.codigo, v.nombre, v.tipo, v.costo, v.precio, v.iva, v.activo, id).run();
    if (!r.meta.changes) return falla(c, 404, "No encontrado.");
    await auditar(c, c.get("usuario").id, "CATALOGO_EDITAR", `${id} ${v.nombre}`);
    return c.json({ ok: true });
  } catch (e) {
    if (esUnico(e)) return falla(c, 409, "Ya existe otra cosa con ese código.");
    throw e;
  }
});

catalogo.delete("/:id", async (c) => {
  const id = idParam(c);
  try {
    const r = await c.env.DB.prepare(`DELETE FROM catalogo WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) return falla(c, 404, "No encontrado.");
    await auditar(c, c.get("usuario").id, "CATALOGO_ELIMINAR", String(id));
    return c.json({ ok: true });
  } catch (e) {
    if (esForanea(e)) return falla(c, 409, "Ya se usó en documentos o en la bodega: desactívalo en lugar de eliminarlo.");
    throw e;
  }
});

export default catalogo;
