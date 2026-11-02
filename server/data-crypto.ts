import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const AAD = Buffer.from("token-panel:credential:v1");
const PAYLOAD_PREFIX = "v1";
const KEY_BYTES = 32;

export class DataKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataKeyError";
  }
}

function parseKey(text: string): Buffer {
  const key = Buffer.from(text.trim(), "hex");
  if (key.length !== KEY_BYTES) throw new DataKeyError("invalid_data_key");
  return key;
}

// PANEL_DATA_KEY wins over data/data-key so operators can keep the key outside
// the data directory; otherwise the first boot generates and persists one.
export async function loadDataKey(dataDir: string): Promise<Buffer> {
  const fromEnv = process.env.PANEL_DATA_KEY?.trim();
  if (fromEnv) return parseKey(fromEnv);
  const file = join(dataDir, "data-key");
  try {
    return parseKey(await readFile(file, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  const key = randomBytes(KEY_BYTES);
  await mkdir(dataDir, { recursive: true });
  try {
    await writeFile(file, key.toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return parseKey(await readFile(file, "utf8"));
    throw error;
  }
  return key;
}

export interface DataCipher {
  encrypt(value: unknown): string;
  decrypt(payload: string): unknown;
}

export function createDataCipher(key: Buffer): DataCipher {
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return [
        PAYLOAD_PREFIX,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },
    decrypt(payload) {
      const parts = payload.split(".");
      if (parts.length !== 4 || parts[0] !== PAYLOAD_PREFIX) throw new DataKeyError("invalid_payload");
      const [, iv, tag, ciphertext] = parts;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAAD(AAD);
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        const text = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        return JSON.parse(text) as unknown;
      } catch {
        throw new DataKeyError("decrypt_failed");
      }
    },
  };
}
