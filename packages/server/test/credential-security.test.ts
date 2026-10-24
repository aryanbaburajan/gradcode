import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { withEnv } from "../../core/test/fixture/env"
import fs from "node:fs/promises"
import path from "node:path"

it.live("API key connection reports a locked vault without leaking the submitted key", () =>
  withEnv({ OPENCODE_VAULT_KEY_FILE: "/nonexistent/gradcode-vault-test.key" }, () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-locked-connect-")))
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(directory.path, "opencode.json"),
          JSON.stringify({
            providers: { fixture: { package: "aisdk:@ai-sdk/openai-compatible", models: { chat: {} } } },
          }),
        ),
      )
      const server = yield* startServer(directory.path)
      const query = `?directory=${encodeURIComponent(directory.path)}`
      const integrations = yield* Effect.promise(() =>
        fetch(new URL(`/api/integration${query}`, server.base), { headers: server.headers }),
      )
      expect(integrations.status).toBe(200)
      expect(yield* Effect.promise(() => integrations.text())).toContain("fixture")
      const response = yield* Effect.promise(() =>
        fetch(new URL(`/api/integration/fixture/connect/key${query}`, server.base), {
          method: "POST",
          headers: { ...server.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ key: "fixture-must-not-leak" }),
        }),
      )
      expect(response.status).toBe(400)
      const body = yield* Effect.promise(() => response.text())
      expect(body).toContain("Credential vault is locked")
      expect(body).not.toContain("fixture-must-not-leak")
    }),
  ),
)

it.live("credential create, list, and account mutations never return secret values", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-credential-security-")))
    const server = yield* startServer(directory.path)
    const create = yield* Effect.promise(() =>
      fetch(new URL("/api/credential", server.base), {
        method: "POST",
        headers: { ...server.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "cred_fixture",
          integrationID: "fixture",
          value: { type: "key", key: "fixture-do-not-disclose" },
        }),
      }),
    )
    expect(create.status).toBe(200)
    expect(yield* Effect.promise(() => create.text())).not.toContain("fixture-do-not-disclose")
    for (const path of ["/api/credential", "/api/credential/accounts"]) {
      const response = yield* Effect.promise(() => fetch(new URL(path, server.base), { headers: server.headers }))
      expect(response.status).toBe(200)
      const body = yield* Effect.promise(() => response.text())
      expect(body).not.toContain("fixture-do-not-disclose")
      expect(body).toContain("cred_fixture")
    }
    const update = yield* Effect.promise(() =>
      fetch(new URL("/api/credential/cred_fixture/account", server.base), {
        method: "PATCH",
        headers: { ...server.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
    )
    expect(update.status).toBe(204)
    expect(yield* Effect.promise(() => update.text())).toBe("")
  }),
)
