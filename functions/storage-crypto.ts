// WebCrypto AES-256-GCM for credentials stored in Qoder Sites Storage.
// The payload layout ("v1.<iv>.<tag>.<ciphertext>", same AAD) is identical to
// server/data-crypto.ts so encrypted data stays portable between deployment
// shapes. Runs in both Deno (Sites Functions) and Node (tests).
const AAD = new TextEncoder().encode("token-panel:credential:v1");
const PAYLOAD_PREFIX = "v1";
const KEY_HEX = /^[0-9a-fA-F]{64}$/;
const TAG_BYTES = 16;
const IV_BYTES = 12;

export interface StorageCipher {
  encrypt(value: unknown): Promise<string>;
  decrypt(payload: string): Promise<unknown>;
}

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageKeyError";
  }
}

function b64uEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64uDecode(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// A missing or malformed key fails closed: every credential operation throws
// until PANEL_DATA_KEY (64 hex chars) is configured for the site.
export function createStorageCipher(keyHex: string | null | undefined): StorageCipher {
  const hex = (keyHex ?? "").trim();
  if (!KEY_HEX.test(hex)) {
    const unavailable = (): Promise<never> =>
      Promise.reject(new StorageKeyError("data_key_unavailable"));
    return { encrypt: unavailable, decrypt: unavailable };
  }
  const keyBytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < keyBytes.length; index += 1) {
    keyBytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  const key = crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: AAD },
          await key,
          new TextEncoder().encode(JSON.stringify(value)),
        ),
      );
      const ciphertext = sealed.slice(0, sealed.length - TAG_BYTES);
      const tag = sealed.slice(sealed.length - TAG_BYTES);
      return [PAYLOAD_PREFIX, b64uEncode(iv), b64uEncode(tag), b64uEncode(ciphertext)].join(".");
    },
    async decrypt(payload) {
      const parts = payload.split(".");
      if (parts.length !== 4 || parts[0] !== PAYLOAD_PREFIX) {
        throw new StorageKeyError("invalid_payload");
      }
      try {
        const [, iv, tag, ciphertext] = parts;
        const sealedCiphertext = b64uDecode(ciphertext);
        const sealed = new Uint8Array(sealedCiphertext.length + TAG_BYTES);
        sealed.set(sealedCiphertext);
        sealed.set(b64uDecode(tag), sealedCiphertext.length);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: b64uDecode(iv), additionalData: AAD },
          await key,
          sealed,
        );
        return JSON.parse(new TextDecoder().decode(plain)) as unknown;
      } catch {
        throw new StorageKeyError("decrypt_failed");
      }
    },
  };
}
