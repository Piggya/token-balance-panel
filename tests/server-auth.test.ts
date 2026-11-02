import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAuthRouter,
  createPanelAuth,
  hashPassword,
  readSessionCookie,
  verifyPassword,
  type PanelAuth,
} from "../server/auth.ts";

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "panel-auth-"));
}

async function makeAuth(
  seed: { username?: string; password?: string } = { username: "admin", password: "correct-horse" },
): Promise<{ auth: PanelAuth; dataDir: string }> {
  const dataDir = await tempDir();
  const auth = await createPanelAuth(dataDir, seed);
  return { auth, dataDir };
}

function router(
  auth: PanelAuth,
  dataDir: string,
  now: () => number = Date.now,
) {
  return createAuthRouter(auth, { dataDir, now });
}

function loginRequest(url: string, payload: unknown): { request: Request; body: Buffer } {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    request: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
    }),
    body,
  };
}

function cookieFrom(response: Response): string | null {
  return response.headers.get("set-cookie");
}

test("hashPassword / verifyPassword roundtrip", () => {
  const stored = hashPassword("s3cret-password");
  assert.ok(verifyPassword("s3cret-password", stored));
  assert.equal(verifyPassword("wrong", stored), false);
  assert.equal(verifyPassword("s3cret-password", "garbage"), false);
  assert.equal(verifyPassword("s3cret-password", "scrypt$zz$zz"), false);
});

test("ensureCredentials seeds once then reuses auth.json", async () => {
  const dataDir = await tempDir();
  try {
    const first = await createPanelAuth(dataDir, { username: "boss", password: "long-enough" });
    assert.equal(first.generatedPassword, undefined);
    assert.equal(first.credentials.username, "boss");
    const second = await createPanelAuth(dataDir, { username: "other", password: "different-one" });
    assert.equal(second.credentials.username, "boss");
    assert.equal(second.credentials.passwordHash, first.credentials.passwordHash);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("ensureCredentials generates a password when none is usable", async () => {
  const dataDir = await tempDir();
  try {
    const created = await createPanelAuth(dataDir, {});
    assert.ok(created.generatedPassword && created.generatedPassword.length >= 8);
    assert.ok(verifyPassword(created.generatedPassword!, created.credentials.passwordHash));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("session token roundtrip, expiry and tamper rejection", async () => {
  const { auth } = await makeAuth();
  const token = auth.issue("admin", 1_000_000);
  assert.deepEqual(auth.verify(token, 1_000_000 + 1000), { username: "admin" });
  assert.equal(auth.verify(token, 1_000_000 + 7 * 24 * 60 * 60 * 1000 + 1), null);
  assert.equal(auth.verify(`${token}x`, 1_000_100), null);
  assert.equal(auth.verify(null, 1_000_100), null);
  assert.equal(readSessionCookie("a=1; panel_session=abc; b=2"), "abc");
  assert.equal(readSessionCookie("nothing"), null);
});

test("auth router: status, login, logout", async () => {
  const { auth, dataDir } = await makeAuth();
  const handle = router(auth, dataDir);

  const anon = await handle(
    new Request("http://x/api/auth/status"),
    undefined,
  );
  assert.equal(anon?.status, 200);
  assert.deepEqual(await anon?.json(), { ok: true, authenticated: false });

  const bad = loginRequest("http://x/api/auth/login", { username: "admin", password: "nope" });
  const badResponse = await handle(bad.request, bad.body);
  assert.equal(badResponse?.status, 401);
  assert.equal((await badResponse?.json())?.error, "invalid_credentials");

  const good = loginRequest("http://x/api/auth/login", { username: "admin", password: "correct-horse" });
  const goodResponse = await handle(good.request, good.body);
  assert.equal(goodResponse?.status, 200);
  const setCookie = cookieFrom(goodResponse!);
  assert.ok(setCookie?.startsWith("panel_session="));
  assert.match(setCookie!, /HttpOnly/);
  assert.match(setCookie!, /SameSite=Lax/);
  assert.doesNotMatch(setCookie!, /Secure/);

  const token = readSessionCookie(setCookie);
  const authed = await handle(
    new Request("http://x/api/auth/status", { headers: { cookie: `panel_session=${token}` } }),
    undefined,
  );
  assert.deepEqual(await authed?.json(), { ok: true, authenticated: true, username: "admin" });

  const out = await handle(
    new Request("http://x/api/auth/logout", { method: "POST", headers: { cookie: `panel_session=${token}` } }),
    undefined,
  );
  assert.equal(out?.status, 200);
  assert.match(cookieFrom(out!)!, /Max-Age=0/);
});

test("auth router: prefixed function-host path works", async () => {
  const { auth, dataDir } = await makeAuth();
  const handle = router(auth, dataDir);
  const status = await handle(
    new Request("http://x/functions/v1/app/api/auth/status"),
    undefined,
  );
  assert.equal(status?.status, 200);
  const login = loginRequest("http://x/functions/v1/app/api/auth/login", {
    username: "admin",
    password: "correct-horse",
  });
  assert.equal((await handle(login.request, login.body))?.status, 200);
});

test("auth router: login rate limited after 10 attempts", async () => {
  const { auth, dataDir } = await makeAuth();
  let time = 0;
  const handle = router(auth, dataDir, () => time);
  for (let i = 0; i < 10; i += 1) {
    const attempt = loginRequest("http://x/api/auth/login", { username: "admin", password: "nope" });
    const response = await handle(attempt.request, attempt.body);
    assert.equal(response?.status, 401, `attempt ${i}`);
  }
  const blocked = loginRequest("http://x/api/auth/login", { username: "admin", password: "correct-horse" });
  const blockedResponse = await handle(blocked.request, blocked.body);
  assert.equal(blockedResponse?.status, 429);
  assert.match(blockedResponse?.headers.get("retry-after") ?? "", /\d+/);
  time = 61_000;
  const after = loginRequest("http://x/api/auth/login", { username: "admin", password: "correct-horse" });
  assert.equal((await handle(after.request, after.body))?.status, 200);
});

test("auth router: change password flow", async () => {
  const { auth, dataDir } = await makeAuth();
  const handle = router(auth, dataDir);
  const login = loginRequest("http://x/api/auth/login", { username: "admin", password: "correct-horse" });
  const loginResponse = await handle(login.request, login.body);
  const token = readSessionCookie(cookieFrom(loginResponse!));
  const cookie = { cookie: `panel_session=${token}` };

  const anon = loginRequest("http://x/api/auth/password", {
    currentPassword: "correct-horse",
    newPassword: "brand-new-pw",
  });
  assert.equal((await handle(anon.request, anon.body))?.status, 401);

  const wrongCurrent = loginRequest("http://x/api/auth/password", {
    currentPassword: "wrong",
    newPassword: "brand-new-pw",
  });
  const wrongResponse = await handle(
    new Request("http://x/api/auth/password", { method: "POST", headers: { "content-type": "application/json", ...cookie } }),
    wrongCurrent.body,
  );
  assert.equal(wrongResponse?.status, 403);
  assert.equal((await wrongResponse?.json())?.error, "wrong_password");

  const weak = loginRequest("http://x/api/auth/password", {
    currentPassword: "correct-horse",
    newPassword: "short",
  });
  const weakResponse = await handle(
    new Request("http://x/api/auth/password", { method: "POST", headers: { "content-type": "application/json", ...cookie } }),
    weak.body,
  );
  assert.equal(weakResponse?.status, 400);
  assert.equal((await weakResponse?.json())?.error, "weak_password");

  const change = loginRequest("http://x/api/auth/password", {
    currentPassword: "correct-horse",
    newPassword: "brand-new-pw",
  });
  const changeResponse = await handle(
    new Request("http://x/api/auth/password", { method: "POST", headers: { "content-type": "application/json", ...cookie } }),
    change.body,
  );
  assert.equal(changeResponse?.status, 200);
  assert.equal(verifyPassword("correct-horse", auth.credentials.passwordHash), false);
  assert.ok(verifyPassword("brand-new-pw", auth.credentials.passwordHash));

  const relogin = loginRequest("http://x/api/auth/login", { username: "admin", password: "brand-new-pw" });
  assert.equal((await handle(relogin.request, relogin.body))?.status, 200);
});

test("auth router: non-auth path falls through, wrong method rejected", async () => {
  const { auth, dataDir } = await makeAuth();
  const handle = router(auth, dataDir);
  assert.equal(await handle(new Request("http://x/api/dashboard"), undefined), null);
  const wrong = await handle(new Request("http://x/api/auth/login"), undefined);
  assert.equal(wrong?.status, 405);
});
