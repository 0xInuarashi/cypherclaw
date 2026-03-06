// tools/secrets-utils.ts
// ----------------------
// Shared utilities for the secrets tool family.
//
// Key management:
//   - The encryption key lives at .cypherclaw/secrets.key (32 raw bytes, hex-encoded).
//   - If the file doesn't exist on first use, a new key is generated automatically
//     and written with mode 0o600. No user interaction required.
//
// Storage:
//   - Secrets are kept in .cypherclaw/secrets/store.enc as an AES-256-GCM
//     encrypted JSON blob: { iv, authTag, ciphertext } (all hex strings).
//   - The plaintext is a flat JSON object mapping secret names to string values.
//
// Path traversal and empty-name inputs are rejected at the tool layer.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";

export function resolveSecretsDir(): string {
  return path.join(process.cwd(), ".cypherclaw", "secrets");
}

export function resolveKeyPath(): string {
  return path.join(process.cwd(), ".cypherclaw", "secrets.key");
}

export function resolveStorePath(): string {
  return path.join(resolveSecretsDir(), "store.enc");
}

async function loadOrCreateKey(): Promise<Buffer> {
  const keyPath = resolveKeyPath();

  try {
    const hex = await fs.readFile(keyPath, "utf-8");
    return Buffer.from(hex.trim(), "hex");
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code !== "ENOENT") throw err;
  }

  const key = crypto.randomBytes(32);
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, key.toString("hex"), { encoding: "utf-8", mode: 0o600 });
  return key;
}

type EncryptedStore = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

function encrypt(plaintext: string, key: Buffer): EncryptedStore {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

function decrypt(store: EncryptedStore, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(store.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(store.authTag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(store.ciphertext, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf-8");
}

export async function readSecrets(): Promise<Record<string, string>> {
  const key = await loadOrCreateKey();
  const storePath = resolveStorePath();

  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const store: EncryptedStore = JSON.parse(raw);
    const plaintext = decrypt(store, key);
    return JSON.parse(plaintext) as Record<string, string>;
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return {};
    throw err;
  }
}

export async function writeSecrets(secrets: Record<string, string>): Promise<void> {
  const key = await loadOrCreateKey();
  const storePath = resolveStorePath();
  const plaintext = JSON.stringify(secrets);
  const store = encrypt(plaintext, key);

  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store), { encoding: "utf-8", mode: 0o600 });
}
