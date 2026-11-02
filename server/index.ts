// Production function host for self-hosted deployment. Not used by the Qoder
// Site build; it serves the same routes.ts application over plain HTTP with a
// file-backed store, and is expected to run on a private Docker network behind
// an authenticating reverse proxy.
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { application } from "../functions/routes.ts";
import { createAuthRouter, createPanelAuth, readSessionCookie } from "./auth.ts";
import { createDataCipher, DataKeyError, loadDataKey } from "./data-crypto.ts";
import { createAccountStore, createSettingsStore } from "./file-store.ts";

const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? "0.0.0.0";
const dataDir = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), ".data");
// Hard cap on buffered request bodies. The largest legitimate payload is a
// 32 KiB account write; anything bigger is rejected before it reaches memory.
const MAX_REQUEST_BYTES = 64 * 1024;

const dataKey = await loadDataKey(dataDir).catch((error: unknown) => {
  const message = error instanceof DataKeyError ? error.message : "data_key_unavailable";
  console.error(`cannot initialise credential key: ${message}`);
  console.error("set PANEL_DATA_KEY (64 hex chars) or restore data/data-key from backup");
  process.exit(1);
});
const cipher = createDataCipher(dataKey);

const store = createAccountStore(dataDir, cipher);
const settingsStore = createSettingsStore(dataDir);

const auth = await createPanelAuth(dataDir, {
  username: process.env.PANEL_USERNAME,
  password: process.env.PANEL_PASSWORD,
});
if (auth.generatedPassword) {
  console.log(`no PANEL_PASSWORD configured; generated panel password: ${auth.generatedPassword}`);
  console.log("it is stored hashed in auth.json; this line is printed once");
}
const authRouter = createAuthRouter(auth, { dataDir });

const handle = application({
  createStore: () => store,
  createSettingsStore: () => settingsStore,
  requireUser: (request) => {
    const session = auth.verify(readSessionCookie(request.headers.get("cookie")), Date.now());
    if (!session) {
      const error = new Error("login_required") as Error & { code: string; status: number };
      error.code = "login_required";
      error.status = 401;
      throw error;
    }
    return { user_id: "selfhosted" };
  },
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_REQUEST_BYTES) {
      tooLarge = true;
      break;
    }
    chunks.push(chunk as Buffer);
  }
  if (tooLarge) {
    res.writeHead(413, {
      "content-type": "application/json",
      connection: "close",
    });
    res.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
    return;
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  try {
    const authResponse = await authRouter(
      new Request(url, { method: req.method ?? "GET", headers }),
      body,
    );
    if (authResponse) {
      res.writeHead(authResponse.status, Object.fromEntries(authResponse.headers.entries()));
      res.end(Buffer.from(await authResponse.arrayBuffer()));
      return;
    }
    const response = await handle(new Request(url, {
      method: req.method ?? "GET",
      headers,
      ...(body && req.method !== "GET" && req.method !== "HEAD" ? { body } : {}),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.error(`function host failed: ${name}`);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "local_host_failed" }));
  }
});

server.listen(port, host, () => {
  console.log(`function host listening on http://${host}:${port}`);
});
