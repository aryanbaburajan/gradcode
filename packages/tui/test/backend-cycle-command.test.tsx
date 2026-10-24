import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { TextareaRenderable } from "@opentui/core"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import type { AccountManagementInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json, worktree } from "./fixture/tui-client"

// Exercise the real command registry and composer, with only provider HTTP replaced.
for (const extended of [false, true]) {
  test(`backend shortcuts and /cycle-backend work with extended keyboard support ${extended}`, async () => {
    const location = { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } }
    const providers = ["alpha", "beta"].map((id) => Provider.Info.empty(Provider.ID.make(id)))
    const models = providers.map((provider) => Model.Info.default(provider.id, Model.ID.make("model")))
    let accounts: AccountManagementInfo[] = ["one", "two"].map((id) => ({
      id,
      integrationID: "alpha",
      label: id,
      method: "key",
      authentication: "key",
      active: id === "one",
      status: "ready",
      policy: { enabled: true, priority: 0, health: "healthy" },
    }))
    const writes: string[] = []
    const terminal = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: extended })
    await terminal.renderer.setupTerminal()
    await using setup = await createAppFixture({
      setup: terminal,
      args: { model: "alpha/model" },
      fetch: async (url, request) => {
        if (url.pathname === "/api/location") return json(location)
        if (url.pathname === "/api/agent") return json({ location, data: [Agent.Info.default(Agent.ID.make("build"))] })
        if (url.pathname === "/api/model") return json({ location, data: models })
        if (url.pathname === "/api/provider") return json({ location, data: providers })
        if (url.pathname === "/api/integration")
          return json({
            location,
            data: [
              {
                id: "alpha",
                name: "Alpha",
                methods: [{ type: "key" }],
                connections: accounts.map((account) => ({
                  type: "credential",
                  id: account.id,
                  label: account.label,
                  method: "key",
                })),
              },
              { id: "beta", name: "Beta", methods: [], connections: [{ type: "env", name: "BETA_KEY" }] },
            ],
          })
        if (url.pathname === "/api/credential/accounts") return json({ data: accounts })
        if (request.method !== "GET" && url.pathname.startsWith("/api/credential/")) {
          writes.push(`${request.method} ${url.pathname}`)
          const id = url.pathname.split("/")[3]
          if (url.pathname.endsWith("/activate"))
            accounts = accounts.map((account) => ({ ...account, active: account.id === id }))
          if (url.pathname.endsWith("/account")) {
            expect(await request.json()).toEqual({ selected: true })
            accounts = accounts.map((account) => ({ ...account, pinned: account.id === id }))
          }
          return new Response(null, { status: 204 })
        }
        if (request.method === "POST" && url.pathname.includes("/prompt"))
          throw new Error("Cycling must not run inference")
        return undefined
      },
    })
    await setup.ready
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressKey("p")
    await setup.waitForFrame((frame) => frame.includes("Switched backend to alpha · two"))
    expect(writes).toEqual(["POST /api/credential/two/activate", "PATCH /api/credential/two/account"])
    await setup.mockInput.typeText("/cycle-backend")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Switched backend to beta"))
    expect(writes).toHaveLength(2)
    if (extended) setup.mockInput.pressKey("b", { ctrl: true, shift: true })
    else {
      setup.mockInput.pressKey("x", { ctrl: true })
      setup.mockInput.pressKey("p")
    }
    await setup.waitForFrame((frame) => frame.includes("Switched backend to alpha · one"))
    expect(writes.slice(2)).toEqual(["POST /api/credential/one/activate", "PATCH /api/credential/one/account"])
  })
}
