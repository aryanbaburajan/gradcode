import { expect, test } from "bun:test"
import { AIError, AuthenticationError, RateLimitError, QuotaExceededError } from "@opencode/ai"
import { failurePolicy, order } from "../src/account-management"
import { AccountManagement } from "@opencode/schema/account-management"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"

function account(id: string, policy: Partial<AccountManagement.Policy> = {}): AccountManagement.Info {
  return {
    id: Credential.ID.make(id),
    integrationID: Integration.ID.make("test"),
    label: id,
    method: "key",
    authentication: "key",
    active: false,
    policy: { enabled: true, priority: 0, health: "unknown", ...policy },
  }
}

test("selection is stable and excludes disabled, revoked, and cooling accounts", () => {
  const accounts = [
    account("b"),
    account("a"),
    account("disabled", { enabled: false }),
    account("revoked", { health: "revoked" }),
    account("cooldown", { cooldown: 20 }),
  ]
  expect(order(accounts, 10).map((account) => String(account.id))).toEqual(["a", "b"])
  expect(order(accounts, 10, Credential.ID.make("b")).map((account) => String(account.id))).toEqual(["b"])
  expect(order(accounts, 10, Credential.ID.make("disabled"))).toEqual([])
})

test("quota is comparable only within one documented scope and window", () => {
  const quota = { remaining: 10, unit: "requests", scope: "project-a", reset: 50 }
  expect(
    order([account("a", { quota }), account("b", { quota: { ...quota, remaining: 20 } })], 10)[0]?.id?.toString(),
  ).toBe("b")
  expect(order([account("a"), account("b", { quota })], 10)[0]?.id?.toString()).toBe("a")
  expect(
    order(
      [account("a", { quota }), account("b", { quota: { ...quota, scope: "project-b", remaining: 20 } })],
      10,
    )[0]?.id?.toString(),
  ).toBe("a")
  expect(order([account("a", { quota: { ...quota, remaining: 0 } })], 10)).toEqual([])
})

test("only rejected authentication changes authentication health", () => {
  const policy = account("fixture").policy
  const error = (status: number) =>
    new AIError({
      reason: new AuthenticationError({
        message: "redacted",
        http: { url: "https://example.com", status, headers: {} },
      }),
    })
  expect(failurePolicy(policy, error(401), 10)?.health).toBe("reauthenticate")
  expect(failurePolicy(policy, error(403), 10)).toBeUndefined()
})

test("rate limits use documented retry delays and quota errors do not invent a reset", () => {
  const policy = account("fixture").policy
  expect(
    failurePolicy(policy, new AIError({ reason: new RateLimitError({ message: "limited", retryAfterMs: 500 }) }), 10)
      ?.cooldown,
  ).toBe(510)
  expect(
    failurePolicy(policy, new AIError({ reason: new RateLimitError({ message: "limited" }) }), 10)?.cooldown,
  ).toBeUndefined()
  expect(
    failurePolicy(policy, new AIError({ reason: new QuotaExceededError({ message: "exhausted" }) }), 10),
  ).toMatchObject({ health: "unavailable", reason: "quota" })
})
