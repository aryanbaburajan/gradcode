import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/index.js"
import { LLMClient } from "../src/route.js"
import { model } from "../src/providers/antigravity.js"
import { dynamicResponse } from "./lib/http.js"
import { it } from "./lib/effect.js"

it.effect("Antigravity wraps Gemini requests and unwraps streamed responses", () =>
  Effect.gen(function* () {
    const runtime = dynamicResponse((input) =>
      Effect.gen(function* () {
        const body = JSON.parse(input.text)
        expect(body).toMatchObject({
          project: "project-fixture",
          model: "gemini-fixture",
          requestType: "agent",
          request: { fixture: true },
        })
        expect(body.request.contents).toHaveLength(1)
        expect(body.requestId).toStartWith("agent-")
        expect(input.request.url).toContain("/v1internal:streamGenerateContent")
        const event = {
          response: {
            candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP", index: 0 }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
          },
        }
        return input.respond(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } })
      }),
    )
    const response = yield* LLMClient.generate(
      LLM.request({
        model: model("gemini-fixture", { apiKey: "test-access", projectID: "project-fixture" }),
        prompt: "Hi",
        http: { body: { fixture: true } },
      }),
    ).pipe(Effect.provide(runtime))
    expect(response.text).toBe("Hello")
  }),
)

it.effect("Antigravity fails closed on a malformed stream envelope", () =>
  Effect.gen(function* () {
    const runtime = dynamicResponse((input) =>
      Effect.succeed(input.respond('data: {"wrong":true}\n\n', { headers: { "content-type": "text/event-stream" } })),
    )
    const error = yield* LLMClient.generate(
      LLM.request({
        model: model("gemini-fixture", { apiKey: "test-access", projectID: "project-fixture" }),
        prompt: "Hi",
      }),
    ).pipe(Effect.provide(runtime), Effect.flip)
    expect(error.reason._tag).toBe("InvalidProviderOutput")
  }),
)
