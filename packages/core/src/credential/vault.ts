export * as Vault from "./vault.js"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { Schema } from "effect"

export const Envelope = Schema.Struct({
  version: Schema.Literal(1),
  algorithm: Schema.Literal("aes-256-gcm"),
  nonce: Schema.String,
  ciphertext: Schema.String,
  tag: Schema.String,
  metadata: Schema.optional(
    Schema.Struct({
      type: Schema.Literals(["key", "oauth", "external"]),
      methodID: Schema.optional(Schema.String),
      expires: Schema.optional(Schema.Number),
    }),
  ),
})
export type Envelope = typeof Envelope.Type

export class Locked extends Error {
  constructor() {
    super(
      "Credential vault is locked. Unlock Linux Secret Service or configure OPENCODE_VAULT_KEY_FILE with an owner-only 32-byte key.",
    )
    this.name = "VaultLocked"
  }
}

/** Headless storage is opt-in. No key or plaintext fallback is ever created here. */
export function key() {
  const file = process.env.OPENCODE_VAULT_KEY_FILE
  if (file) {
    const fd = (() => {
      try {
        return openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      } catch {
        throw new Locked()
      }
    })()
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Locked()
      const value = readFileSync(fd)
      if (value.length !== 32) throw new Locked()
      return value
    } finally {
      closeSync(fd)
    }
  }
  const result = spawnSync("secret-tool", ["lookup", "application", "opencode", "purpose", "credential-vault"], {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (result.status !== 0 || !/^[0-9a-f]{64}$/i.test(result.stdout.trim())) throw new Locked()
  return Buffer.from(result.stdout.trim(), "hex")
}

export function seal(value: unknown, key: Uint8Array, id: string, integration: string): Envelope {
  const metadata = Schema.decodeUnknownSync(
    Schema.Struct({
      type: Schema.Literals(["key", "oauth", "external"]),
      methodID: Schema.optional(Schema.String),
      expires: Schema.optional(Schema.Number),
    }),
  )(value)
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(Buffer.from(JSON.stringify([1, id, integration])))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()])
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    metadata,
  }
}

export function open(value: Envelope, key: Uint8Array, id: string, integration: string): unknown {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.nonce, "base64"))
    decipher.setAAD(Buffer.from(JSON.stringify([1, id, integration])))
    decipher.setAuthTag(Buffer.from(value.tag, "base64"))
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8"),
    )
  } catch {
    throw new Error("Credential vault integrity check failed")
  }
}
