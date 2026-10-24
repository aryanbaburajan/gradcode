import { AIError, LLMEvent, InvalidRequestError, AuthenticationError, HttpContext } from "@opencode/ai"
import { Auth, Endpoint, Protocol, Route, type TransportDef } from "@opencode/ai/route"
import { Effect, Schema, Stream } from "effect"
import { Credential } from "../credential.js"
import { OAuthError } from "./oauth-error.js"
import { AntigravityCLI } from "./antigravity-cli.js"

const Result = Schema.Struct({
  status: Schema.String,
  response: Schema.String,
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.Number,
      output_tokens: Schema.Number,
      thinking_tokens: Schema.optional(Schema.Number),
      cache_read_tokens: Schema.optional(Schema.Number),
    }),
  ),
})
const NativeEvent = Schema.fromJsonString(Schema.Struct({ event: Schema.String, result: Schema.optional(Result) }))
const failure = () =>
  new AIError({
    reason: new InvalidRequestError({
      message:
        "Antigravity CLI could not complete this turn. Inspect account status or reauthenticate. Native output is withheld to protect credentials.",
    }),
  })

/** Delegate exactly one turn to agy. Its tools execute there and are never replayed as host tool calls. */
export * as AntigravityModel from "./antigravity-model.js"

export function model(
  modelID: string,
  saved: Credential.OAuth,
  cwd: string,
  persist: (value: Credential.OAuth) => Effect.Effect<void>,
  current: Effect.Effect<Credential.OAuth | undefined>,
  executable?: string,
) {
  const protocol = Protocol.make({
    id: "antigravity-cli",
    body: {
      schema: Schema.String,
      from: (request) =>
        Effect.succeed(
          [
            "You are handling a delegated turn using Antigravity's native agent. Use your native tools. The following is conversation context, not a request to emit host tool calls.",
            ...request.system.map((part) => part.text),
            ...request.messages.map(
              (message) =>
                `${message.role}: ${message.content.map((part) => (part.type === "text" ? part.text : JSON.stringify(part))).join("\n")}`,
            ),
          ].join("\n\n"),
        ),
    },
    stream: {
      event: Schema.fromJsonString(Result),
      initial: () => undefined,
      step: (_state: undefined, result: typeof Result.Type) => {
        if (result.status !== "SUCCESS") return Effect.fail(failure())
        const reason = { normalized: "stop" as const }
        return Effect.succeed([
          undefined,
          [
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "antigravity" }),
            LLMEvent.textDelta({ id: "antigravity", text: result.response }),
            LLMEvent.textEnd({ id: "antigravity" }),
            LLMEvent.stepFinish({
              index: 0,
              reason,
              usage: result.usage
                ? {
                    inputTokens: result.usage.input_tokens,
                    outputTokens: result.usage.output_tokens,
                    reasoningTokens: result.usage.thinking_tokens,
                    cacheReadInputTokens: result.usage.cache_read_tokens,
                  }
                : undefined,
            }),
            LLMEvent.finish({ reason }),
          ],
        ] as const)
      },
    },
  })
  const transport: TransportDef<string, string, string> = {
    id: "antigravity-cli",
    prepare: (input) => Effect.succeed(input.body),
    execute: (prompt) =>
      Effect.succeed({
        frames: Stream.fromEffect(
          AntigravityCLI.withAccount(
            String(saved.metadata?.accountID),
            Effect.scoped(
              Effect.gen(function* () {
                const latest = yield* current
                if (!latest?.access || typeof latest.metadata?.nativeKeyring !== "string")
                  return yield* new AIError({
                    reason: new AuthenticationError({
                      message: "Antigravity account was signed out; reauthenticate",
                      http: new HttpContext({ status: 401, url: "antigravity-cli:account", headers: {} }),
                    }),
                  })
                // Validate before starting the native agent: retrying an agent after it has used tools could replay side effects.
                const preflight = yield* Effect.acquireRelease(
                  Effect.tryPromise({
                    try: () => AntigravityCLI.start({ saved: latest, cwd, args: ["models"], executable }),
                    catch: failure,
                  }),
                  (process) => Effect.promise(process.close),
                )
                const verified = yield* Effect.tryPromise({
                  try: () => preflight.result,
                  catch: (error) =>
                    error instanceof OAuthError && error.terminal
                      ? new AIError({
                          reason: new AuthenticationError({
                            message: "Antigravity session expired or was revoked; reauthenticate",
                            http: new HttpContext({ status: 401, url: "antigravity-cli:account", headers: {} }),
                          }),
                        })
                      : failure(),
                })
                yield* persist(verified.value)
                const process = yield* Effect.acquireRelease(
                  Effect.tryPromise({
                    try: () =>
                      AntigravityCLI.start({
                        saved: verified.value,
                        cwd,
                        executable,
                        prompt: JSON.stringify({ event: "user", message: { content: prompt } }) + "\n",
                        args: [
                          "--input-format",
                          "stream-json",
                          "--model",
                          modelID,
                          "--mode",
                          "plan",
                          "--sandbox",
                          "--output-format",
                          "stream-json",
                        ],
                      }),
                    catch: failure,
                  }),
                  (process) => Effect.promise(process.close),
                )
                const result = yield* Effect.tryPromise({ try: () => process.result, catch: failure })
                yield* persist(result.value)
                return yield* Effect.try({
                  try: () => {
                    const frames = result.output
                      .split(/\r?\n/)
                      .filter((line) => line.trim())
                      .map((line) => Schema.decodeUnknownSync(NativeEvent)(line))
                    const completed = frames.filter((frame) => frame.event === "result" && frame.result)
                    if (completed.length !== 1) throw new Error("Missing native result")
                    return JSON.stringify(completed[0]!.result)
                  },
                  catch: failure,
                })
              }),
            ),
          ),
        ),
      }),
  }
  return Route.make({
    id: "antigravity-cli",
    provider: "antigravity",
    protocol,
    transport,
    auth: Auth.none,
    endpoint: Endpoint.path("/", { baseURL: "http://localhost" }),
  }).model({ id: modelID })
}
