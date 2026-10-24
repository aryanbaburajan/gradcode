import { describe, expect } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { Router } from "../src/routing"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Routing } from "@opencode/schema/routing"
import { it } from "./lib/effect"
import { withEnv } from "./fixture/env"

const model = Model.Info.default(Provider.ID.make("test"), Model.ID.make("model"))
const profile: Routing.Profile = {
  name: "balanced",
  model: Model.Ref.make({ providerID: model.providerID, id: model.id }),
  description: "General coding",
  capabilities: ["text", "tools", "image"],
  costPreference: "balanced",
}
const input: Router.Input = {
  config: { profiles: [profile] },
  available: [model],
  request: { request: "fix this", modalities: ["text"], tools: true, contextTokens: 10 },
}

function fixture(body: unknown, status = 200) {
  const requests: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(await request.json())
      return Response.json(body, { status })
    },
  })
  return { server, requests, endpoint: `http://127.0.0.1:${server.port}/v1/systemone` }
}

describe("model routing", () => {
  it.live("uses typed Choice and sends only bounded request data", () =>
    Effect.gen(function* () {
      const http = fixture({ answers: { route: { type: "choice", choice: "balanced" } } })
      yield* Effect.addFinalizer(() => Effect.sync(() => http.server.stop(true)))
      const result = yield* Router.preview({
        ...input,
        config: { ...input.config, laya: { endpoint: http.endpoint }, requestCharacters: 4, contextCharacters: 2 },
        request: { ...input.request, request: "123456789", context: "abcdef" },
      }).pipe((effect) => withEnv({ TYPESAFE_API_KEY: undefined }, () => effect))
      expect(result.backend).toBe("laya")
      expect(http.requests).toEqual([
        {
          model: "laya",
          state: { request: "1234", context: "ab", attachments: ["text"], tools: true },
          questions: {
            route: {
              type: "choice",
              instructions: expect.any(String),
              criteria: {
                balanced: { task: "General coding", capabilities: ["text", "tools", "image"], cost: "balanced" },
              },
            },
          },
        },
      ])
    }),
  )

  for (const body of [
    {},
    { answers: { route: { type: "choice", choice: "not-configured" } } },
    { answers: { route: { type: "noul", choice: "balanced" } } },
  ]) {
    it.live(`rejects invalid response ${JSON.stringify(body)}`, () =>
      Effect.gen(function* () {
        const http = fixture(body)
        yield* Effect.addFinalizer(() => Effect.sync(() => http.server.stop(true)))
        const result = yield* Router.preview({
          ...input,
          config: { ...input.config, laya: { endpoint: http.endpoint } },
        }).pipe(Effect.flip, (effect) => withEnv({ TYPESAFE_API_KEY: undefined }, () => effect))
        expect(result).toBeInstanceOf(Router.Unavailable)
        expect(http.requests.length).toBe(1)
      }),
    )
  }

  it.live("falls from Jev failure to Laya with separate credentials", () =>
    Effect.gen(function* () {
      const jev = fixture({}, 500)
      const laya = fixture({ answers: { route: { type: "choice", choice: "balanced" } } })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          jev.server.stop(true)
          laya.server.stop(true)
        }),
      )
      const result = yield* Router.preview({
        ...input,
        config: { ...input.config, jev: { endpoint: jev.endpoint }, laya: { endpoint: laya.endpoint } },
      }).pipe((effect) => withEnv({ TYPESAFE_API_KEY: "fixture-jev", LAYA_API_KEY: "fixture-laya" }, () => effect))
      expect(result.backend).toBe("laya")
      expect(jev.requests.length).toBe(1)
      expect(laya.requests.length).toBe(1)
    }),
  )

  it.live("fails without selecting a model when both backends fail", () =>
    Effect.gen(function* () {
      const jev = fixture({}, 500)
      const laya = fixture({}, 503)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          jev.server.stop(true)
          laya.server.stop(true)
        }),
      )
      const error = yield* Router.preview({
        ...input,
        config: { ...input.config, jev: { endpoint: jev.endpoint }, laya: { endpoint: laya.endpoint } },
      }).pipe(Effect.flip, (effect) => withEnv({ TYPESAFE_API_KEY: "fixture-jev" }, () => effect))
      expect(error).toBeInstanceOf(Router.Unavailable)
      expect(error.message).toContain("jev: HTTP 500")
      expect(error.message).toContain("laya: HTTP 503")
      expect(error.setupRequired).toBeUndefined()
      expect(jev.requests.length).toBe(1)
      expect(laya.requests.length).toBe(1)
    }),
  )

  it.effect("filters unavailable models, modalities, context and unsupported effort", () =>
    Effect.gen(function* () {
      expect(Router.eligible({ ...input, available: [] })).toEqual([])
      expect(Router.eligible({ ...input, config: { ...input.config, providerID: Provider.ID.make("other") } })).toEqual(
        [],
      )
      expect(Router.eligible({ ...input, request: { ...input.request, modalities: ["audio"] } })).toEqual([])
      expect(Router.eligible({ ...input, request: { ...input.request, contextTokens: 999_999 } })).toEqual([])
      expect(Router.eligible({ ...input, config: { profiles: [{ ...profile, reasoningEffort: "high" }] } })).toEqual([])
      const exit = yield* Router.preview({ ...input, available: [] }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})

it.live("bounds backend timeout without retrying", () =>
  Effect.gen(function* () {
    const requests: string[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(request.url)
        return new Promise<Response>(() => {})
      },
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
    const result = yield* Router.preview({
      ...input,
      config: { ...input.config, laya: { endpoint: `http://127.0.0.1:${server.port}`, timeoutMs: 50 } },
    }).pipe(Effect.flip, (effect) => withEnv({ TYPESAFE_API_KEY: undefined }, () => effect))
    expect(result).toBeInstanceOf(Router.Unavailable)
    expect(requests.length).toBe(1)
    expect(result.message).toContain("laya: timed out after 50 ms")
    expect(result.setupRequired).toBeUndefined()
  }),
)

it.effect("formats routing notices with model, effort, source, and selection change", () =>
  Effect.sync(() => {
    const decision: Routing.Decision = {
      selectedModel: { ...profile.model, variant: Model.VariantID.make("high") },
      reasoningEffort: "high",
      profile: "complex",
      backend: "jev",
      rationale: "DO NOT LOG RAW RATIONALE",
    }
    expect(Router.notice(decision, "Switched to")).toBe(
      "Switched to test/model · reasoning: high · profile: complex · jev matched the task to this profile",
    )
    expect(Router.notice(decision)).not.toContain(decision.rationale)
  }),
)

it.live("large Laya catalogs compare bounded groups and select only a group winner", () =>
  Effect.gen(function* () {
    const batches: string[][] = []
    const http = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = Schema.decodeUnknownSync(
          Schema.Struct({
            questions: Schema.Struct({
              route: Schema.Struct({ criteria: Schema.Record(Schema.String, Schema.Unknown) }),
            }),
          }),
        )(await request.json())
        const names = Object.keys(body.questions.route.criteria)
        batches.push(names)
        if (names.length > 100) return Response.json({}, { status: 413 })
        return Response.json({ answers: { route: { type: "choice", choice: names.at(-1) } } })
      },
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => http.stop(true)))
    const profiles = Array.from({ length: 130 }, (_, i) => ({ ...profile, name: "profile-" + i }))
    const result = yield* Router.preview({
      ...input,
      config: { profiles, laya: { endpoint: new URL("/v1/systemone", http.url).toString() } },
    }).pipe((effect) => withEnv({ TYPESAFE_API_KEY: undefined }, () => effect))
    expect(result.profile).toBe("profile-129")
    expect(batches.map((batch) => batch.length)).toEqual([64, 64, 2, 3])
    expect(batches.slice(0, 3).flat()).toEqual(profiles.map((profile) => profile.name))
    expect(batches[3]).toEqual(["profile-63", "profile-127", "profile-129"])
  }),
)
