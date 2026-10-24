import { expect } from "bun:test"
import { AIError, AuthenticationError, RateLimitError } from "@opencode/ai"
import { Effect, Exit } from "effect"
import { AccountManagement } from "../src/account-management"
import { Credential } from "../src/credential"
import { Integration } from "@opencode/schema/integration"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([AccountManagement.node, Credential.node])))

it.effect("automatic ordering and account pins do not mutate global activation", () =>
  Effect.gen(function* () {
    const accounts = yield* AccountManagement.Service
    const credentials = yield* Credential.Service
    const integrationID = Integration.ID.make("fixture")
    const first = yield* credentials.create({
      integrationID,
      value: Credential.Key.make({ type: "key", key: "fixture-first" }),
    })
    const second = yield* credentials.create({
      integrationID,
      value: Credential.Key.make({ type: "key", key: "fixture-second" }),
    })
    yield* accounts.update(first.id, { priority: 10 })
    expect((yield* accounts.select(integrationID)).id).toBe(first.id)
    expect((yield* credentials.list(integrationID)).at(-1)?.id).toBe(second.id)
    yield* accounts.update(second.id, { selected: true })
    expect((yield* accounts.select(integrationID)).id).toBe(second.id)
    yield* accounts.update(second.id, { enabled: false })
    expect(Exit.isFailure(yield* accounts.select(integrationID).pipe(Effect.exit))).toBe(true)
    yield* accounts.update(second.id, { selected: false })
    expect((yield* accounts.select(integrationID)).id).toBe(first.id)
    expect(JSON.stringify(yield* accounts.list())).not.toContain("fixture-first")
    expect(JSON.stringify(yield* accounts.list())).not.toContain("fixture-second")
  }),
)

it.effect("authentication failure selects an eligible alternate but unknown rate limits never rotate accounts", () =>
  Effect.gen(function* () {
    const accounts = yield* AccountManagement.Service
    const credentials = yield* Credential.Service
    const integrationID = Integration.ID.make("failover-fixture")
    const first = yield* credentials.create({ integrationID, value: Credential.Key.make({ type: "key", key: "one" }) })
    const second = yield* credentials.create({ integrationID, value: Credential.Key.make({ type: "key", key: "two" }) })
    yield* accounts.update(first.id, { priority: 100 })
    expect(
      yield* accounts.failure(
        first.id,
        new AIError({
          reason: new AuthenticationError({
            message: "expired",
            http: { url: "https://example.com", status: 401, headers: {} },
          }),
        }),
      ),
    ).toBe(true)
    expect((yield* accounts.select(integrationID)).id).toBe(second.id)
    expect(
      yield* accounts.failure(second.id, new AIError({ reason: new RateLimitError({ message: "limited" }) })),
    ).toBe(false)
    yield* accounts.report(first.id, { enabled: true, priority: 100, health: "healthy" })
    expect((yield* accounts.select(integrationID)).id).toBe(second.id)
  }),
)

it.effect("selection honors discovered per-account model eligibility", () =>
  Effect.gen(function* () {
    const accounts = yield* AccountManagement.Service
    const credentials = yield* Credential.Service
    const integrationID = Integration.ID.make("model-fixture")
    const first = yield* credentials.create({
      integrationID,
      value: Credential.Key.make({ type: "key", key: "one", metadata: { modelIDs: ["model-a"] } }),
    })
    const second = yield* credentials.create({
      integrationID,
      value: Credential.Key.make({ type: "key", key: "two", metadata: { modelIDs: ["model-b"] } }),
    })
    yield* accounts.update(first.id, { priority: 100 })
    expect((yield* accounts.select(integrationID, undefined, undefined, "model-b")).id).toBe(second.id)
    expect(
      Exit.isFailure(yield* accounts.select(integrationID, first.id, undefined, "model-b").pipe(Effect.exit)),
    ).toBe(true)
  }),
)

it.effect("account listings expose only the safe login email and authentication kind", () =>
  Effect.gen(function* () {
    const accounts = yield* AccountManagement.Service
    const credentials = yield* Credential.Service
    const saved = yield* credentials.create({
      integrationID: Integration.ID.make("identity-fixture"),
      value: Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("browser"),
        access: "secret-access",
        refresh: "secret-refresh",
        expires: Number.MAX_SAFE_INTEGER,
        metadata: {
          email: "owner@example.test",
          idToken: "secret-id-token",
          nativeKeyring: "secret-native-snapshot",
          clientSecret: "secret-client",
        },
      }),
    })
    const view = (yield* accounts.list()).find((account) => account.id === saved.id)
    expect(view).toMatchObject({ authentication: "oauth", email: "owner@example.test" })
    for (const secret of [
      "secret-access",
      "secret-refresh",
      "secret-id-token",
      "secret-native-snapshot",
      "secret-client",
    ])
      expect(JSON.stringify(view)).not.toContain(secret)
  }),
)
