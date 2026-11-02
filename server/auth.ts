// Self-host panel authentication: file-backed credentials (scrypt), HMAC-signed
// session cookie, and the /api/auth/* routes. Not part of the Qoder Sites build.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRateLimiter } from "../functions/rate-limit.ts";

const SESSION_COOKIE = "panel_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_LIMIT_PER_MINUTE = 10;
const LOGIN_WINDOW_MS = 60_000;
const MAX_AUTH_BODY_BYTES = 4_096;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export interface Credentials {
  username: string;
  passwordHash: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== 64) return false;
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function writeCredentials(dataDir: string, credentials: Credentials): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, "auth.json");
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify({ version: 1, ...credentials }), { mode: 0o600 });
  await rename(temp, file);
  await chmod(file, 0o600);
}

// Seeds auth.json on first boot from explicit options (server/index.ts passes
// env values); without a usable password it generates one and reports it once.
export async function ensureCredentials(
  dataDir: string,
  seed: { username?: string; password?: string },
): Promise<{ credentials: Credentials; generatedPassword?: string }> {
  const file = join(dataDir, "auth.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    if (
      typeof parsed?.username === "string" &&
      typeof parsed?.passwordHash === "string" &&
      parsed.username && parsed.passwordHash
    ) {
      return {
        credentials: { username: parsed.username, passwordHash: parsed.passwordHash },
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let generatedPassword: string | undefined;
  let password = typeof seed.password === "string" ? seed.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    generatedPassword = randomBytes(12).toString("base64url");
    password = generatedPassword;
  }
  const credentials: Credentials = {
    username: seed.username && seed.username.trim() ? seed.username.trim() : "tokenadmin",
    passwordHash: hashPassword(password),
  };
  await writeCredentials(dataDir, credentials);
  return { credentials, generatedPassword };
}

export interface Session {
  username: string;
}

export interface PanelAuth {
  credentials: Credentials;
  generatedPassword?: string;
  issue(username: string, now: number): string;
  verify(token: string | null | undefined, now: number): Session | null;
  cookieHeader(token: string, secure: boolean): string;
  clearCookieHeader(): string;
}

async function loadSessionSecret(dataDir: string): Promise<Buffer> {
  const file = join(dataDir, "session-secret");
  try {
    const hex = await readFile(file, "utf8");
    const secret = Buffer.from(hex.trim(), "hex");
    if (secret.length === 32) return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32);
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, secret.toString("hex"), { mode: 0o600 });
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export async function createPanelAuth(
  dataDir: string,
  seed: { username?: string; password?: string } = {},
): Promise<PanelAuth> {
  const { credentials, generatedPassword } = await ensureCredentials(dataDir, seed);
  const secret = await loadSessionSecret(dataDir);

  function sign(payload: string): string {
    return createHmac("sha256", secret).update(payload).digest("base64url");
  }

  return {
    credentials,
    ...(generatedPassword ? { generatedPassword } : {}),
    issue(username, now) {
      const payload = base64url(
        JSON.stringify({ u: username, e: now + SESSION_TTL_MS }),
      );
      return `${payload}.${sign(payload)}`;
    },
    verify(token, now) {
      if (!token) return null;
      const dot = token.indexOf(".");
      if (dot <= 0 || dot === token.length - 1) return null;
      const payload = token.slice(0, dot);
      const signature = Buffer.from(token.slice(dot + 1));
      const expected = Buffer.from(sign(payload));
      if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
        return null;
      }
      try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as
          | { u?: unknown; e?: unknown }
          | null;
        if (typeof parsed?.u !== "string" || typeof parsed?.e !== "number") return null;
        if (!Number.isFinite(parsed.e) || parsed.e <= now) return null;
        return { username: parsed.u };
      } catch {
        return null;
      }
    },
    cookieHeader(token, secure) {
      return [
        `${SESSION_COOKIE}=${token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
        ...(secure ? ["Secure"] : []),
      ].join("; ");
    },
    clearCookieHeader() {
      return [
        `${SESSION_COOKIE}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
      ].join("; ");
    },
  };
}

export function readSessionCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return part.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

function parseBody(body: Buffer | undefined): Record<string, unknown> | null {
  if (!body || body.byteLength === 0 || body.byteLength > MAX_AUTH_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fail(code: string, status: number): Response {
  return Response.json({ ok: false, error: code }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Handles /api/auth/* (with or without the function-host prefix). Returns null
// when the path is not an auth route so the caller can fall through.
export function createAuthRouter(
  auth: PanelAuth,
  options: { dataDir: string; now?: () => number },
): (request: Request, body: Buffer | undefined) => Promise<Response | null> {
  const now = options.now ?? Date.now;
  const loginLimiter = createRateLimiter({
    limit: LOGIN_LIMIT_PER_MINUTE,
    windowMs: LOGIN_WINDOW_MS,
    now,
    maxKeys: 10_000,
  });
  const AUTH_PATH = /^\/(?:functions\/v1\/)?app\/api\/auth\/(login|logout|status|password)$/;
  // Plain "/api/auth/..." also accepted for direct host testing.
  const DIRECT_PATH = /^\/api\/auth\/(login|logout|status|password)$/;

  return async (request, body) => {
    const url = new URL(request.url);
    const match = url.pathname.match(AUTH_PATH) ?? url.pathname.match(DIRECT_PATH);
    if (!match) return null;
    const action = match[1];
    const method = request.method;
    const secure = url.protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https";
    const token = readSessionCookie(request.headers.get("cookie"));
    const clientKey = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();

    if (action === "status" && method === "GET") {
      const session = auth.verify(token, now());
      return Response.json(
        {
          ok: true,
          authenticated: session !== null,
          ...(session ? { username: session.username } : {}),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action === "login" && method === "POST") {
      const limited = loginLimiter.check(`login:${clientKey}`);
      if (!limited.allowed) {
        return Response.json(
          { ok: false, error: "rate_limited" },
          {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": String(limited.retryAfterSec),
            },
          },
        );
      }
      const parsed = parseBody(body);
      const username = typeof parsed?.username === "string" ? parsed.username : "";
      const password = typeof parsed?.password === "string" ? parsed.password : "";
      const session = auth.verify(token, now());
      if (
        session?.username === auth.credentials.username ||
        (username === auth.credentials.username && verifyPassword(password, auth.credentials.passwordHash))
      ) {
        const response = Response.json(
          { ok: true, username: auth.credentials.username },
          { headers: { "Cache-Control": "no-store" } },
        );
        response.headers.append(
          "Set-Cookie",
          auth.cookieHeader(auth.issue(auth.credentials.username, now()), secure),
        );
        return response;
      }
      return fail("invalid_credentials", 401);
    }

    if (action === "logout" && method === "POST") {
      const response = Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.headers.append("Set-Cookie", auth.clearCookieHeader());
      return response;
    }

    if (action === "password" && method === "POST") {
      const session = auth.verify(token, now());
      if (!session) return fail("login_required", 401);
      const parsed = parseBody(body);
      const currentPassword = typeof parsed?.currentPassword === "string"
        ? parsed.currentPassword
        : "";
      const newPassword = typeof parsed?.newPassword === "string" ? parsed.newPassword : "";
      if (!verifyPassword(currentPassword, auth.credentials.passwordHash)) {
        return fail("wrong_password", 403);
      }
      if (
        newPassword.length < MIN_PASSWORD_LENGTH ||
        newPassword.length > MAX_PASSWORD_LENGTH
      ) {
        return fail("weak_password", 400);
      }
      auth.credentials = {
        username: auth.credentials.username,
        passwordHash: hashPassword(newPassword),
      };
      await writeCredentials(options.dataDir, auth.credentials);
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return fail("method_not_allowed", 405);
  };
}
