import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
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
      ["antigravity", "antigravity-google"],
    ]) {
      const integration = body.data.find((item: { id: string }) => item.id === integrationID)
      expect(integration, integrationID).toBeDefined()
      expect(integration.methods).toContainEqual(expect.objectContaining({ id: methodID, type: "oauth" }))
    }
    expect(body.data.find((item: { id: string }) => item.id === "google").methods).toContainEqual({ type: "key" })
  }),
)
