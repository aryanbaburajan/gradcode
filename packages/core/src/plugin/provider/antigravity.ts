import { define } from "@opencode/plugin/effect/plugin"
import { Deferred, Effect, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { pkce, token } from "./subscription-oauth.js"

const methodID = "antigravity-google"
const endpoint = "https://oauth2.googleapis.com/token"
const origin = "https://daily-cloudcode-pa.googleapis.com"
const Identity = Schema.Struct({ sub: Schema.NonEmptyString })
const Project = Schema.Struct({
  cloudaicompanionProject: Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]),
})
const Inventory = Schema.Struct({ models: Schema.Record(Schema.String, Schema.Unknown) })

export const AntigravityPlugin = define({
  id: "gradcode.provider.antigravity",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const bus = yield* Bus.Service
    const credentials = yield* Credential.Service
    const request = (input: Parameters<typeof token>[0]) =>
      token(input).pipe(Effect.provideService(HttpClient.HttpClient, http))
    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: "antigravity",
        method: { type: "oauth", id: methodID, label: "Google login for Antigravity (unofficial)" },
        authorize: (_answer, saved) =>
          Effect.gen(function* () {
            const clientID = saved?.metadata?.clientID ?? process.env.OPENCODE_ANTIGRAVITY_CLIENT_ID
            const clientSecret = saved?.metadata?.clientSecret ?? process.env.OPENCODE_ANTIGRAVITY_CLIENT_SECRET
            if (typeof clientID !== "string" || typeof clientSecret !== "string")
              return yield* Effect.fail(
                new Error(
                  "Configure OPENCODE_ANTIGRAVITY_CLIENT_ID and OPENCODE_ANTIGRAVITY_CLIENT_SECRET for an authorized OAuth client; no embedded client secret is supplied",
                ),
              )
            const proof = pkce()
            const received = yield* Deferred.make<string, Error>()
            const { createServer } = yield* Effect.promise(() => import("node:http"))
            const server = createServer((req, res) => {
              const url = new URL(req.url ?? "/", "http://localhost")
              if (url.pathname !== "/oauth-callback") {
                res.writeHead(404).end()
                return
              }
              if (url.searchParams.get("state") !== proof.state) {
                res.writeHead(400).end("Invalid OAuth state")
                return
              }
              const code = url.searchParams.get("code")
              if (!code || url.searchParams.has("error")) {
                Effect.runFork(Deferred.fail(received, new Error("Google authorization declined")))
                res.writeHead(400).end("Authorization declined")
                return
              }
              Effect.runFork(Deferred.succeed(received, code))
              res.writeHead(200, { "Content-Type": "text/plain" }).end("Authorization received. Return to Gradcode.")
            })
            yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
            yield* Effect.callback<void, Error>((resume) => {
              server.once("error", (error) => resume(Effect.fail(error)))
              server.listen(51121, "127.0.0.1", () => resume(Effect.void))
            })
            const redirect = "http://localhost:51121/oauth-callback"
            const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
            url.search = new URLSearchParams({
              client_id: clientID,
              redirect_uri: redirect,
              response_type: "code",
              access_type: "offline",
              prompt: "consent select_account",
              scope: "openid email profile https://www.googleapis.com/auth/cloud-platform",
              state: proof.state,
              code_challenge: proof.challenge,
              code_challenge_method: "S256",
            }).toString()
            return {
              mode: "auto" as const,
              url: url.toString(),
              instructions: "Complete Google login. This direct Antigravity adapter is unofficial.",
              callback: Effect.gen(function* () {
                const value = yield* request({
                  endpoint,
                  clientID,
                  methodID,
                  previous: saved,
                  fields: {
                    grant_type: "authorization_code",
                    code: yield* Deferred.await(received),
                    client_secret: clientSecret,
                    redirect_uri: redirect,
                    code_verifier: proof.verifier,
                  },
                  metadata: { clientSecret },
                })
                const identityResponse = yield* http.execute(
                  HttpClientRequest.get("https://openidconnect.googleapis.com/v1/userinfo").pipe(
                    HttpClientRequest.bearerToken(value.access),
                  ),
                )
                const identity = yield* identityResponse.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Identity)))
                const projectResponse = yield* http.execute(
                  yield* HttpClientRequest.bodyJson(
                    HttpClientRequest.post(`${origin}/v1internal:loadCodeAssist`).pipe(
                      HttpClientRequest.bearerToken(value.access),
                    ),
                    { metadata: { ideType: "ANTIGRAVITY" } },
                  ),
                )
                const project = yield* projectResponse.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Project)))
                const projectID =
                  typeof project.cloudaicompanionProject === "string"
                    ? project.cloudaicompanionProject
                    : project.cloudaicompanionProject.id
                const inventoryResponse = yield* http.execute(
                  yield* HttpClientRequest.bodyJson(
                    HttpClientRequest.post(`${origin}/v1internal:fetchAvailableModels`).pipe(
                      HttpClientRequest.bearerToken(value.access),
                    ),
                    { project: projectID },
                  ),
                )
                const inventory = yield* inventoryResponse.json.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Inventory)),
                )
                return Credential.OAuth.make({
                  ...value,
                  metadata: {
                    ...value.metadata,
                    accountID: identity.sub,
                    projectID,
                    modelIDs: Object.keys(inventory.models),
                  },
                })
              }).pipe(
                Effect.mapError(
                  () =>
                    new Error(
                      "Antigravity login or entitlement discovery failed; check OAuth client access and account eligibility",
                    ),
                ),
              ),
            }
          }),
        refresh: (previous) => {
          const clientID = previous.metadata?.clientID
          const clientSecret = previous.metadata?.clientSecret
          if (typeof clientID !== "string" || typeof clientSecret !== "string")
            return Effect.fail(new Error("Antigravity registration is incomplete; sign in again"))
          return request({
            endpoint,
            clientID,
            methodID,
            previous,
            fields: { grant_type: "refresh_token", refresh_token: previous.refresh, client_secret: clientSecret },
          })
        },
      })
      editor.update("antigravity", (integration) => {
        integration.name = "Antigravity (unofficial)"
      })
    })
    let source: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    let models: string[] = []
    const load = Effect.fn(function* () {
      source = yield* ctx.integration.connection.active("antigravity")
      const saved =
        source?.type === "credential"
          ? yield* credentials.get(Credential.ID.make(source.id)).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
      models =
        saved?.value.type === "oauth" && Array.isArray(saved.value.metadata?.modelIDs)
          ? saved.value.metadata.modelIDs.filter((id): id is string => typeof id === "string")
          : []
    })
    yield* load()
    yield* ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make("antigravity")),
          name: "Antigravity (unofficial)",
          integrationID: Integration.ID.make("antigravity"),
          package: "@opencode/ai/providers/antigravity",
        },
        models: models.map((id) => ({
          ...Model.Info.default(Provider.ID.make("antigravity"), Model.ID.make(id)),
          package: "@opencode/ai/providers/antigravity",
        })),
        sourceConnection: source,
      })
    })
    yield* bus.subscribe(Credential.Event.Updated).pipe(
      Stream.runForEach(() => load().pipe(Effect.andThen(ctx.provider.reload()))),
      Effect.forkScoped,
    )
  }),
})
