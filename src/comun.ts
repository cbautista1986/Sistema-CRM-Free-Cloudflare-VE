// Piezas compartidas por todos los módulos del servidor.
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { sha256 } from "./seguridad";

export type Usuario = { id: number; nombre: string; email: string; rol: string };
export type Env = { Bindings: { DB: D1Database }; Variables: { usuario: Usuario } };
export type Ctx = Context<Env>;
export type Estado = 400 | 401 | 403 | 404 | 409 | 429;

export const RIF = /^[VEJGPC]-?\d{6,9}(-?\d)?$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ahora = () => Math.floor(Date.now() / 1000);
export const falla = (c: Ctx, estado: Estado, error: string) => c.json({ ok: false, error }, estado);
export const ip = (c: Ctx) => c.req.header("CF-Connecting-IP") ?? "local";
export const leerJson = async (c: Ctx) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
export const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
export const idParam = (c: Ctx) => { const n = Number(c.req.param("id")); return Number.isInteger(n) && n > 0 ? n : 0; };
export const comodin = (q: string) => q.replace(/[\\%_]/g, "\\$&"); // para búsquedas LIKE ... ESCAPE '\'
export const esUnico = (e: unknown) => String(e).includes("UNIQUE");
export const esForanea = (e: unknown) => String(e).includes("FOREIGN KEY");

// El dinero se guarda en centavos enteros (nunca decimales). "12,50" o "12.5" -> 1250.
// Devuelve null si está vacío y NaN si no es un monto válido.
export function aCentavos(v: unknown): number | null {
  const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return NaN;
  const [entero, decimales = ""] = t.split(".");
  return Number(entero) * 100 + Number(decimales.padEnd(2, "0"));
}

export async function auditar(c: Ctx, usuarioId: number | null, accion: string, detalle = "") {
  await c.env.DB.prepare(`INSERT INTO auditoria (usuario_id, accion, detalle, ip) VALUES (?, ?, ?, ?)`)
    .bind(usuarioId, accion, detalle.slice(0, 300), ip(c)).run();
}

export async function usuarioActual(c: Ctx) {
  const token = getCookie(c, "sid");
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.nombre, u.email, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ? AND s.expira_en > ?`
  ).bind(await sha256(token), ahora()).first<Usuario>();
}

// Úsalo en cada módulo nuevo: router.use("*", requiereSesion)
export const requiereSesion = createMiddleware<Env>(async (c, next) => {
  const u = await usuarioActual(c);
  if (!u) return falla(c, 401, "Inicia sesión para continuar.");
  c.set("usuario", u);
  await next();
});
