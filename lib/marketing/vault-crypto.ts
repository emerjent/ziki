import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cleanEnv } from "@/lib/env-clean";

/**
 * Sealing for marketing credentials (docs/marketing-notes-and-vault.md).
 *
 * Differences from lib/secret-box.ts, which this deliberately does not reuse:
 *  - It has its own key (MARKETING_VAULT_KEY), so rotating or leaking the login
 *    secret does not expose client credentials, and the reverse.
 *  - Every sealed value names the key that made it, so the key can be rotated
 *    (MARKETING_VAULT_KEY_PREVIOUS keeps old rows readable until they are re-sealed).
 *  - The ciphertext is bound to the credential's id (GCM additional data), so a
 *    sealed value copied onto another row, project or organisation will not open.
 *  - It fails closed. With no key set there is no fallback to another secret.
 *
 * Format: "v1.<keyId>.<iv hex>.<tag hex>.<ciphertext hex>"
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

export class VaultKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultKeyError";
  }
}

type VaultKey = { id: string; key: Buffer };

function deriveKey(secret: string): VaultKey {
  const key = createHash("sha256").update(`ziki-marketing-vault:${secret}`, "utf8").digest();
  // The id is a fingerprint of the key, so it can sit next to the ciphertext without revealing the key.
  const id = createHash("sha256").update(key).update("id").digest("hex").slice(0, 8);
  return { id, key };
}

function readSecret(name: string): string | undefined {
  const value = cleanEnv(process.env[name]);
  return value && value.length >= 32 ? value : undefined;
}

function currentKey(): VaultKey {
  const secret = readSecret("MARKETING_VAULT_KEY");
  if (!secret) {
    throw new VaultKeyError("MARKETING_VAULT_KEY must be set (at least 32 characters) before marketing credentials can be stored.");
  }
  return deriveKey(secret);
}

function keyById(id: string): VaultKey {
  const keys = [readSecret("MARKETING_VAULT_KEY"), readSecret("MARKETING_VAULT_KEY_PREVIOUS")]
    .filter((secret): secret is string => Boolean(secret))
    .map(deriveKey);
  const found = keys.find((candidate) => candidate.id === id);
  if (!found) throw new VaultKeyError("This credential was sealed with a key that is no longer configured.");
  return found;
}

/** Seals `plain`, binding it to `credentialId`. */
export function sealCredential(plain: string, credentialId: string): string {
  const { id, key } = currentKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(credentialId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, id, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(".");
}

/** Opens a sealed value. Throws if it was tampered with or belongs to another credential. */
export function openCredential(sealed: string, credentialId: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new VaultKeyError("Unrecognised sealed credential.");
  const [, keyId, ivHex, tagHex, ciphertextHex] = parts;
  const { key } = keyById(keyId);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAAD(Buffer.from(credentialId, "utf8"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    // Same message for every failure so it says nothing about why.
    throw new VaultKeyError("This credential could not be opened.");
  }
}

/** True when the value was sealed with a key other than the current one (re-seal it). */
export function needsReseal(sealed: string): boolean {
  const keyId = sealed.split(".")[1];
  return keyId !== currentKey().id;
}
