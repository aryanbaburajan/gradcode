/** Unofficial Cloud Code Assist envelope over the shared Gemini protocol. */
import { Effect, Schema, Stream } from "effect"
import { Gemini } from "../protocols/gemini.js"
import { Auth, Endpoint, Route } from "../route/index.js"
import { HttpTransport, type Transport } from "../route/transport/index.js"
import { AIError, InvalidProviderOutputError, ProviderConfigurationError, ProviderID } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"

export const id = ProviderID.make("antigravity")
const Json = Schema.fromJsonString(Schema.Unknown)
const Envelope = Schema.fromJsonString(Schema.Struct({ response: Schema.Unknown }))
const sse = HttpTransport.sseJson.with<Gemini.GeminiBody>()
type Prepared = Effect.Success<ReturnType<typeof sse.prepare>>

export type Settings = ProviderPackage.Settings &
  Gemini.ProviderOptionsInput & {
    readonly apiKey?: string
    readonly projectID?: string
    readonly baseURL?: string
  }

export const model: ProviderPackage.Definition<Settings, Gemini.ProviderOptionsInput>["model"] = (
  modelID,
  { apiKey, projectID, baseURL, headers, body, ...providerOptions },
) => {
  if (!apiKey || !projectID)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Antigravity requires a connected Google account and its authorized project ID",
    })
  const transport: Transport<Gemini.GeminiBody, Prepared, unknown> = {
    id: "antigravity-sse",
    prepare: (input) =>
      sse.prepare({
        ...input,
        request: { ...input.request, http: { ...input.request.http, body: undefined } },
        encodeBody: (request) =>
          Schema.encodeSync(Json)({
            project: projectID,
            model: input.request.model.id,
            request: { ...request, ...input.request.http?.body },
            requestType: "agent",
            userAgent: "gradcode",
            requestId: `agent-${crypto.randomUUID()}`,
          }),
      }),
    execute: (prepared, request, runtime) =>
      sse.execute(prepared, request, runtime).pipe(
        Effect.map((execution) => ({
          ...execution,
          frames: execution.frames.pipe(
            Stream.mapEffect((frame) =>
              Schema.decodeUnknownEffect(Envelope)(frame).pipe(
                Effect.map((envelope) => envelope.response),
                Effect.mapError(
                  () =>
                    new AIError({
                      reason: new InvalidProviderOutputError({
                        route: "antigravity",
                        message: "Invalid Antigravity response envelope",
                      }),
                    }),
                ),
              ),
            ),
          ),
          body: undefined,
        })),
      ),
  }
  return Route.make({
    id: "antigravity-generate",
    provider: id,
    providerMetadataKey: "google",
    protocol: Gemini.protocol,
    auth: Auth.bearer(apiKey),
    transport,
    endpoint: Endpoint.path("/v1internal:streamGenerateContent?alt=sse", {
      baseURL: baseURL ?? "https://daily-cloudcode-pa.googleapis.com",
    }),
    defaults: { headers, providerOptions, ...(body ? { http: { body } } : {}) },
  }).model({ id: modelID })
}
