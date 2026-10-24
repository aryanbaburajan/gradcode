import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Bus } from "../../bus.js"
import { OAuthError } from "../../credential/oauth-error.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { AntigravityCLI } from "../../credential/antigravity-cli.js"

export const AntigravityPlugin = define({
  id: "gradcode.provider.antigravity",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const credentials = yield* Credential.Service
    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: "antigravity",
        method: { type: "oauth", id: AntigravityCLI.methodID, label: "Google login with Antigravity CLI" },
        authorize: () =>
          Effect.gen(function* () {
            const process = yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () => AntigravityCLI.start({ cwd: processCwd(), login: true }),
                catch: () => new OAuthError(false, "antigravity-native"),
              }),
              (process) => Effect.promise(process.close),
            )
            return {
              mode: "code" as const,
              url: yield* Effect.tryPromise({
                try: process.url,
                catch: () => new OAuthError(false, "antigravity-native"),
              }),
              instructions:
                "Complete Google login, then paste the code from the browser here. This account is stored separately from your desktop login.",
              callback: (code) =>
                Effect.tryPromise({
                  try: async () => {
                    await process.submitCode(code)
                    return (await process.result).value
                  },
                  catch: () => new OAuthError(false, "antigravity-native"),
                }),
            }
          }),
        refresh: (saved) =>
          AntigravityCLI.withAccount(
            String(saved.metadata?.accountID),
            Effect.scoped(
              Effect.gen(function* () {
                if (!saved.access || typeof saved.metadata?.nativeKeyring !== "string")
                  return yield* Effect.fail(new OAuthError(true))
                const stored = yield* credentials.list(Integration.ID.make("antigravity"))
                const latest = stored.find(
                  (entry) =>
                    entry.value.type === "oauth" &&
                    entry.value.methodID === AntigravityCLI.methodID &&
                    entry.value.metadata?.accountID === saved.metadata?.accountID,
                )?.value
                if (latest?.type === "oauth") saved = latest
                if (!saved.access || typeof saved.metadata?.nativeKeyring !== "string")
                  return yield* Effect.fail(new OAuthError(true))
                const process = yield* Effect.acquireRelease(
                  Effect.tryPromise({
                    try: () => AntigravityCLI.start({ saved, cwd: processCwd(), args: ["models"] }),
                    catch: () => new OAuthError(false, "antigravity-native"),
                  }),
                  (process) => Effect.promise(process.close),
                )
                return yield* Effect.tryPromise({
                  try: () =>
                    process.result.then((result) => ({
                      ...result.value,
                      metadata: { ...result.value.metadata, modelIDs: AntigravityCLI.parseModels(result.output) },
                    })),
                  catch: (error) => (error instanceof OAuthError ? error : new OAuthError(false, "antigravity-native")),
                })
              }),
            ),
          ),
      })
      editor.update("antigravity", (integration) => {
        integration.name = "Antigravity"
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
        saved?.value.type === "oauth" &&
        saved.value.methodID === AntigravityCLI.methodID &&
        Array.isArray(saved.value.metadata?.modelIDs)
          ? saved.value.metadata.modelIDs.filter((id): id is string => typeof id === "string")
          : []
    })
    yield* load()
    yield* ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make("antigravity")),
          name: "Antigravity",
          integrationID: Integration.ID.make("antigravity"),
          package: "@opencode/core/antigravity-cli",
        },
        models: models.map((id) => ({
          ...Model.Info.default(Provider.ID.make("antigravity"), Model.ID.make(id)),
          capabilities: { tools: false, input: ["text"], output: ["text"] },
          package: "@opencode/core/antigravity-cli",
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

function processCwd() {
  return process.cwd()
}
