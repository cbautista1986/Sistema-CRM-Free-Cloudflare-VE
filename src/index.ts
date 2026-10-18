import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { migrar } from "./migraciones";
import { CLAVE_FALSA, hashClave, sha256, tokenAleatorio, verificarClave } from "./seguridad";

type Usuario = { id: number; nombre: string; email: string; rol: string };
type Env = { Bindings: { DB: D1Database } };
type Ctx = Context<Env>;
type Estado = 400 | 401 | 403 | 404 | 409 | 429;

const app = new Hono<Env>();
const SESION_SEGUNDOS = 60 * 60 * 24 * 7;
const ESPECIALIDADES = ["SERVICIOS_EQUIPOS", "SOLO_SERVICIOS", "MINIMERCADO"];
const RIF = /^[VEJGPC]-?\d{6,9}(-?\d)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Campos del negocio que el administrador puede editar (lista blanca: nada más se puede tocar)
const OBLIGATORIOS = ["nombre_razon_social", "rif", "direccion_fiscal"];
const OPCIONALES = ["telefono", "email", "datos_pago_movil", "datos_transferencia", "datos_zelle", "datos_binance", "datos_paypal"];
const COLUMNAS_NEGOCIO = [...OBLIGATORIOS, ...OPCIONALES, "especialidad", "tasa_bcv", "tasa_bcv_fecha"].join(", ");

const ahora = () => Math.floor(Date.now() / 1000);
const falla = (c: Ctx, estado: Estado, error: string) => c.json({ ok: false, error }, estado);
const ip = (c: Ctx) => c.req.header("CF-Connecting-IP") ?? "local";
const leerJson = async (c: Ctx) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

async function auditar(c: Ctx, usuarioId: number | null, accion: string, detalle = "") {
  await c.env.DB.prepare(`INSERT INTO auditoria (usuario_id, accion, detalle, ip) VALUES (?, ?, ?, ?)`)
    .bind(usuarioId, accion, detalle.slice(0, 300), ip(c)).run();
}

async function usuarioActual(c: Ctx) {
  const token = getCookie(c, "sid");
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.nombre, u.email, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ? AND s.expira_en > ?`
  ).bind(await sha256(token), ahora()).first<Usuario>();
}

async function abrirSesion(c: Ctx, usuarioId: number) {
  const token = tokenAleatorio();
  await c.env.DB.prepare(`INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)`)
    .bind(await sha256(token), usuarioId, ahora() + SESION_SEGUNDOS).run();
  setCookie(c, "sid", token, {
    httpOnly: true, sameSite: "Strict", path: "/", maxAge: SESION_SEGUNDOS,
    secure: new URL(c.req.url).protocol === "https:",
  });
}

// La base de datos se prepara sola en la primera petición (ver migraciones.ts)
let migrado = false;
app.use("/api/*", async (c, next) => {
  if (!migrado) { await migrar(c.env.DB); migrado = true; }
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});

app.get("/api/estado", async (c) => {
  const hayAdmin = await c.env.DB.prepare(`SELECT 1 AS x FROM usuarios LIMIT 1`).first();
  if (!hayAdmin) return c.json({ instalado: false });
  const usuario = await usuarioActual(c);
  if (!usuario) return c.json({ instalado: true, sesion: false });
  const negocio = await c.env.DB.prepare(`SELECT ${COLUMNAS_NEGOCIO} FROM perfil_emisor WHERE id = 1`).first();
  return c.json({ instalado: true, sesion: true, usuario, negocio });
});

// Instalador tipo WordPress: solo funciona UNA vez; después responde 409 (nadie puede crear otro admin).
app.post("/api/instalar", async (c) => {
  const db = c.env.DB;
  if (await db.prepare(`SELECT 1 FROM usuarios LIMIT 1`).first()) return falla(c, 409, "El sistema ya está instalado.");
  const b = await leerJson(c);
  const t = (k: string) => String(b[k] ?? "").trim();
  const nombre = t("nombre").slice(0, 120), rif = t("rif").toUpperCase(), direccion = t("direccion").slice(0, 200);
  const telefono = t("telefono").slice(0, 40) || null, email = t("email").toLowerCase();
  const clave = String(b.clave ?? ""), especialidad = t("especialidad") || ESPECIALIDADES[0];
  if (nombre.length < 2) return falla(c, 400, "Escribe el nombre del negocio.");
  if (!RIF.test(rif)) return falla(c, 400, "RIF o cédula no válido (ejemplo: J-12345678-9).");
  if (direccion.length < 5) return falla(c, 400, "Escribe la dirección fiscal.");
  if (!EMAIL.test(email)) return falla(c, 400, "El correo no es válido.");
  if (clave.length < 10) return falla(c, 400, "La contraseña debe tener al menos 10 caracteres.");
  if (!ESPECIALIDADES.includes(especialidad)) return falla(c, 400, "Especialidad no válida.");

  const hash = await hashClave(clave);
  // Las dos inserciones llevan la misma condición: si dos personas instalan a la vez, solo gana una.
  const r = await db.batch([
    db.prepare(
      `INSERT OR REPLACE INTO perfil_emisor (id, instalado, especialidad, nombre_razon_social, rif, direccion_fiscal, telefono, email, tasa_bcv)
       SELECT 1, 1, ?, ?, ?, ?, ?, ?, 0 WHERE NOT EXISTS (SELECT 1 FROM usuarios)`
    ).bind(especialidad, nombre, rif, direccion, telefono, email),
    db.prepare(
      `INSERT INTO usuarios (nombre, email, password_hash, rol) SELECT ?, ?, ?, 'ADMIN' WHERE NOT EXISTS (SELECT 1 FROM usuarios)`
    ).bind(nombre, email, hash),
  ]);
  if (!r[1].meta.changes) return falla(c, 409, "El sistema ya está instalado.");
  const id = Number(r[1].meta.last_row_id);
  await abrirSesion(c, id);
  await auditar(c, id, "INSTALAR", email);
  return c.json({ ok: true });
});

app.post("/api/login", async (c) => {
  const db = c.env.DB;
  const b = await leerJson(c);
  const email = String(b.email ?? "").trim().toLowerCase(), clave = String(b.clave ?? "");
  if (!email || !clave) return falla(c, 400, "Escribe tu correo y tu contraseña.");
  const llave = `${email}|${ip(c)}`, t = ahora();

  const lim = await db.prepare(`SELECT fallos, bloqueado_hasta FROM intentos_login WHERE clave = ?`).bind(llave)
    .first<{ fallos: number; bloqueado_hasta: number }>();
  if (lim && lim.bloqueado_hasta > t) return falla(c, 429, "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.");

  const u = await db.prepare(`SELECT id, password_hash FROM usuarios WHERE email = ?`).bind(email)
    .first<{ id: number; password_hash: string }>();
  const ok = await verificarClave(clave, u?.password_hash ?? CLAVE_FALSA);
  if (!u || !ok) {
    const fallos = (lim?.fallos ?? 0) + 1, bloquear = fallos >= 5;
    await db.prepare(
      `INSERT INTO intentos_login (clave, fallos, bloqueado_hasta) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET fallos = excluded.fallos, bloqueado_hasta = excluded.bloqueado_hasta`
    ).bind(llave, bloquear ? 0 : fallos, bloquear ? t + 900 : 0).run();
    return falla(c, 401, "Correo o contraseña incorrectos.");
  }
  await db.batch([
    db.prepare(`DELETE FROM intentos_login WHERE clave = ?`).bind(llave),
    db.prepare(`DELETE FROM sesiones WHERE expira_en < ?`).bind(t),
  ]);
  await abrirSesion(c, u.id);
  await auditar(c, u.id, "LOGIN", email);
  return c.json({ ok: true });
});

app.post("/api/logout", async (c) => {
  const token = getCookie(c, "sid");
  if (token) await c.env.DB.prepare(`DELETE FROM sesiones WHERE token_hash = ?`).bind(await sha256(token)).run();
  deleteCookie(c, "sid", { path: "/" });
  return c.json({ ok: true });
});

app.put("/api/config", async (c) => {
  const usuario = await usuarioActual(c);
  if (!usuario) return falla(c, 401, "Inicia sesión para continuar.");
  if (usuario.rol !== "ADMIN") return falla(c, 403, "Solo el administrador puede cambiar la configuración.");
  const b = await leerJson(c);
  const sets: string[] = [], valores: unknown[] = [];

  for (const campo of OBLIGATORIOS) {
    if (!(campo in b)) continue;
    const v = String(b[campo] ?? "").trim().slice(0, 200);
    if (!v) return falla(c, 400, "Nombre, RIF y dirección fiscal no pueden quedar vacíos.");
    sets.push(`${campo} = ?`); valores.push(campo === "rif" ? v.toUpperCase() : v);
  }
  for (const campo of OPCIONALES) {
    if (!(campo in b)) continue;
    sets.push(`${campo} = ?`); valores.push(String(b[campo] ?? "").trim().slice(0, 300) || null);
  }
  if ("especialidad" in b) {
    const e = String(b.especialidad);
    if (!ESPECIALIDADES.includes(e)) return falla(c, 400, "Especialidad no válida.");
    sets.push("especialidad = ?"); valores.push(e);
  }
  if ("tasa_bcv" in b) {
    const tasa = Number(String(b.tasa_bcv).replace(",", "."));
    if (!Number.isFinite(tasa) || tasa <= 0 || tasa > 1e9) return falla(c, 400, "La tasa BCV debe ser un número mayor que 0.");
    sets.push("tasa_bcv = ?", "tasa_bcv_fecha = datetime('now')"); valores.push(tasa);
  }
  if (!sets.length) return falla(c, 400, "No hay cambios que guardar.");

  await c.env.DB.prepare(`UPDATE perfil_emisor SET ${sets.join(", ")} WHERE id = 1`).bind(...valores).run();
  await auditar(c, usuario.id, "CONFIG", Object.keys(b).join(","));
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ ok: false, error: "No encontrado." }, 404));
app.onError((e, c) => {
  console.error(e);
  return c.json({ ok: false, error: "Error interno del servidor." }, 500);
});

export default app;
