import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { Vault } from "../src/credential/vault"

test("vault encrypts with unique nonces and authenticates account identity", () => {
  const key = randomBytes(32)
  const secret = { type: "key", key: "fixture-secret" }
  const first = Vault.seal(secret, key, "account-a", "provider")
  const second = Vault.seal(secret, key, "account-a", "provider")
  expect(first.nonce).not.toBe(second.nonce)
  expect(JSON.stringify(first)).not.toContain(secret.key)
  expect(Vault.open(first, key, "account-a", "provider")).toEqual(secret)
  expect(() => Vault.open(first, key, "account-b", "provider")).toThrow("integrity")
  expect(() => Vault.open(first, key, "account-a", "other-provider")).toThrow("integrity")
  expect(() => Vault.open(first, randomBytes(32), "account-a", "provider")).toThrow("integrity")
  expect(() => Vault.open({ ...first, ciphertext: second.ciphertext }, key, "account-a", "provider")).toThrow(
    "integrity",
  )
})

test("missing headless keys report a locked vault without creating a fallback", () => {
  const previous = process.env.OPENCODE_VAULT_KEY_FILE
  process.env.OPENCODE_VAULT_KEY_FILE = "/nonexistent-opencode-fixture-key"
  try {
    expect(() => Vault.key()).toThrow("vault is locked")
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_VAULT_KEY_FILE
    else process.env.OPENCODE_VAULT_KEY_FILE = previous
  }
})
