// Local Function host for environments without Deno. Not part of the published site.
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccountStoreError,
  parseStored,
  type AccountStore,
  type StoredAccount,
} from "../functions/accounts.ts";
import { application } from "../functions/routes.ts";
import {
  defaultSettings,
  parseStoredSettings,
  SettingsStoreError,
  type Settings,
  type SettingsStore,
} from "../functions/settings.ts";

const port = 8000;
const dataDir = join(dirname(fileURLToPath(import.meta.url)), ".data");
const dataFile = join(dataDir, "accounts.json");
const settingsFile = join(dataDir, "settings.json");

const store: AccountStore = {
  async read(): Promise<StoredAccount[]> {
    try {
      const text = await readFile(dataFile, "utf8");
      return parseStored(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AccountStoreError();
    }
  },
  async write(accounts: StoredAccount[]): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    const temp = `${dataFile}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, accounts }), "utf8");
    await rename(temp, dataFile);
  },
};

const settingsStore: SettingsStore = {
  async read(): Promise<Settings> {
    try {
      const text = await readFile(settingsFile, "utf8");
      return parseStoredSettings(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultSettings();
      if (error instanceof SettingsStoreError) throw error;
      throw new SettingsStoreError();
    }
  },
  async write(settings: Settings): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    const temp = `${settingsFile}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, settings }), "utf8");
    await rename(temp, settingsFile);
  },
};

const handle = application({
  createStore: () => store,
  createSettingsStore: () => settingsStore,
  requireUser: () => ({ user_id: "local" }),
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
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
    if (size > 64 * 1024) {
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
    const response = await handle(new Request(url, {
      method: req.method ?? "GET",
      headers,
      ...(body && req.method !== "GET" && req.method !== "HEAD" ? { body } : {}),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.error(`local function host failed: ${name}`);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "local_host_failed" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`function host listening on http://127.0.0.1:${port}`);
});
