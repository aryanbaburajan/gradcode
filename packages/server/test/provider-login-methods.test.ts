import { randomBytes } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { withEnv } from "../../core/test/fixture/env"
import { startServer } from "./fixture/server"

it.live("fresh server exposes subscription login methods alongside API keys", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-login-methods-")))
    const server = yield* startServer(directory.path)
    const response = yield* Effect.promise(() =>
      fetch(new URL(`/api/integration?directory=${encodeURIComponent(directory.path)}`, server.base), {
        headers: server.headers,
      }),
    )
    expect(response.status).toBe(200)
    const body = yield* Effect.promise(() => response.json())
    for (const [integrationID, methodID] of [
      ["openai", "chatgpt-token-sharing"],
      ["anthropic", "anthropic-subscription"],
      ["antigravity", "antigravity-cli"],
    ]) {
      const integration = body.data.find((item: { id: string }) => item.id === integrationID)
      expect(integration, integrationID).toBeDefined()
      expect(integration.methods).toContainEqual(expect.objectContaining({ id: methodID, type: "oauth" }))
    }
    expect(body.data.find((item: { id: string }) => item.id === "antigravity").methods).toEqual([
      { type: "oauth", id: "antigravity-cli", label: "Google login with Antigravity CLI" },
    ])
    expect(body.data.find((item: { id: string }) => item.id === "google").methods).toContainEqual({ type: "key" })
  }),
)

it.live("public account and connection endpoints expose login email without credentials", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-account-identity-")))
    const key = join(directory.path, "vault-key")
    yield* Effect.promise(() => writeFile(key, randomBytes(32), { mode: 0o600 }))
    yield* withEnv({ OPENCODE_VAULT_KEY_FILE: key }, () =>
      Effect.gen(function* () {
        const server = yield* startServer(directory.path)
        const created = yield* Effect.promise(() =>
          fetch(new URL("/api/credential", server.base), {
            method: "POST",
            headers: { ...server.headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              integrationID: "openai",
              label: "Personal",
              value: {
                type: "oauth",
                methodID: "identity-fixture",
                access: "private-access",
                refresh: "private-refresh",
                expires: Number.MAX_SAFE_INTEGER,
                metadata: {
                  email: "owner@example.test",
                  idToken: "private-id-token",
                  nativeKeyring: "private-native-session",
                  clientSecret: "private-client-secret",
                },
              },
            }),
          }),
        )
        expect(created.status).toBe(200)
        for (const endpoint of [
          "/api/credential",
          "/api/credential/accounts",
          `/api/integration?directory=${encodeURIComponent(directory.path)}`,
        ]) {
          const response = yield* Effect.promise(() =>
            fetch(new URL(endpoint, server.base), { headers: server.headers }),
          )
          expect(response.status).toBe(200)
          const text = yield* Effect.promise(() => response.text())
          expect(text).toContain('"email":"owner@example.test"')
          for (const secret of [
            "private-access",
            "private-refresh",
            "private-id-token",
            "private-native-session",
            "private-client-secret",
          ])
            expect(text).not.toContain(secret)
        }
      }),
    )
  }),
)
