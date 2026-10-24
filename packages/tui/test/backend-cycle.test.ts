import { expect, test } from "bun:test"
import type { AccountManagementInfo } from "@opencode/client"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { backendOptions, nextBackend } from "../src/util/backend-cycle"
import { TuiKeybind } from "../src/config/keybind"

const providers = ["alpha", "beta"].map((id) => Provider.Info.empty(Provider.ID.make(id)))
const models = providers.map((provider) => Model.Info.default(provider.id, Model.ID.make("model")))
const account = (id: string, integrationID = "alpha"): AccountManagementInfo => ({
  id,
  integrationID,
  label: id,
  method: "oauth",
  authentication: "oauth",
  active: id === "one",
  status: "ready",
  policy: { enabled: true, priority: 0, health: "healthy" },
})
const input = {
  accounts: [account("one"), account("two")],
  providers,
  models,
  integrations: [{ id: "beta", name: "Beta", methods: [], connections: [{ type: "env" as const, name: "BETA_KEY" }] }],
  now: 1000,
}

test("cycles accounts and other connected backends in stable order and wraps", () => {
  const options = backendOptions(input)
  expect(options.map((option) => option.id)).toEqual(["alpha:one", "alpha:two", "beta"])
  expect(nextBackend(options, "alpha")?.id).toBe("alpha:two")
  expect(
    nextBackend(
      backendOptions({ ...input, accounts: [account("one"), { ...account("two"), pinned: true }] }),
      "alpha",
      "alpha:two",
    )?.id,
  ).toBe("beta")
  expect(nextBackend(options, "beta", "beta")?.id).toBe("alpha:one")
  expect(nextBackend([], "alpha")).toBeUndefined()
})

test("pins take precedence over an older active credential", () => {
  const options = backendOptions({ ...input, accounts: [account("one"), { ...account("two"), pinned: true }] })
  expect(nextBackend(options, "alpha")?.id).toBe("beta")
})

test("skips disabled, revoked, cooling down and exhausted accounts", () => {
  for (const patch of [
    { status: "disabled" as const },
    { policy: { ...account("one").policy, enabled: false } },
    { status: "reauthenticate" as const },
    { policy: { ...account("one").policy, health: "revoked" as const } },
    { policy: { ...account("one").policy, cooldown: 2000 } },
    { policy: { ...account("one").policy, quota: { remaining: 0, reset: 2000, scope: "account", unit: "requests" } } },
  ])
    expect(
      backendOptions({ ...input, accounts: [{ ...account("one"), ...patch }] }).map((option) => option.id),
    ).toEqual(["beta"])
})

test("never cycles another allowance when an integration has a shared or unknown limit", () => {
  for (const reason of ["rate-limit", "quota"] as const) {
    expect(
      backendOptions({
        ...input,
        accounts: [{ ...account("one"), policy: { ...account("one").policy, reason } }, account("two")],
      }).map((option) => option.id),
    ).toEqual(["beta"])
  }
})

test("keeps refreshable OAuth sessions and excludes disabled providers and nontext models", () => {
  expect(backendOptions({ ...input, accounts: [{ ...account("one"), status: "expired" }] })[0]?.id).toBe("alpha:one")
  expect(
    backendOptions({ ...input, providers: providers.map((provider) => ({ ...provider, activation: "disabled" })) }),
  ).toEqual([])
  expect(
    backendOptions({
      ...input,
      models: models.map((model) => ({ ...model, capabilities: { ...model.capabilities, input: ["audio"] } })),
    }),
  ).toEqual([])
})

test("binds backend cycling to a portable leader sequence and Ctrl+Shift+B", () => {
  expect(TuiKeybind.Definitions["backend.cycle"].default).toBe("<leader>p,ctrl+shift+b")
})
