import { expect } from "bun:test"
import { LLM } from "@opencode/ai"
import { Headers } from "effect/http"
import { Effect, Layer } from "effect"
import { AccountManagement } from "../src/account-management"
import { AISDK } from "../src/aisdk"
import { Config } from "../src/config"
import { Credential } from "../src/credential"
import { OAuthError } from "../src/credential/oauth-error"
import { Integration } from "../src/integration"
import { Model } from "../src/model"
import { ModelResolver } from "../src/model-resolver"
import { Provider } from "../src/provider"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Document, Info } from "@opencode/schema/config"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Npm } from "@opencode/util/npm"
import { testEffect } from "./lib/effect"

const integrationID = Integration.ID.make("cycling")
const providerID = Provider.ID.make("cycling")
const methodID = Integration.MethodID.make("browser")
const selected = Model.Info.make({
  ...Model.Info.default(providerID, Model.ID.make("test-model")),
  package: "@opencode/ai/providers/openai",
})

for (const mode of ["automatic", "pinned", "disabled", "transient"] as const) {
  const it = testEffect(
    AppNodeBuilder.build(
      LayerNode.group([ModelResolver.node, Integration.node, Credential.node, AccountManagement.node]),
      [
        Provider.node.replace(
          Layer.mock(Provider.Service, {
            get: () => Effect.succeed({ ...Provider.Info.empty(providerID), integrationID }),
          }),
        ),
        Model.node.replace(Layer.mock(Model.Service, {})),
        Npm.node.replace(Layer.mock(Npm.Service, {})),
        AISDK.node.replace(
          Layer.mock(AISDK.Service, {
            hook: { sdk: () => Effect.die("unused"), language: () => Effect.die("unused") },
          }),
        ),
        Config.node.replace(
          Config.testLayer([
            new Document({ type: "document", info: new Info({ accounts: { failover: mode !== "disabled" } }) }),
          ]),
        ),
      ],
    ),
  )
  it.effect(`credential refresh account cycling: ${mode}`, () =>
    Effect.gen(function* () {
      const accounts = yield* AccountManagement.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const resolver = yield* ModelResolver.Service
      const saved = yield* Effect.forEach(["first", "second"], (accountID) =>
        credentials.create({
          integrationID,
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: `old-${accountID}`,
            refresh: `refresh-${accountID}`,
            expires: 0,
            metadata: { accountID },
          }),
        }),
      )
      yield* accounts.update(saved[0].id, { priority: 10, ...(mode === "pinned" ? { selected: true } : {}) })
      const refreshed: string[] = []
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { type: "oauth", id: methodID, label: "Browser" },
          authorize: () => Effect.die("unused"),
          refresh: (previous) =>
            Effect.gen(function* () {
              refreshed.push(String(previous.metadata?.accountID))
              if (previous.metadata?.accountID === "first")
                return yield* Effect.fail(new OAuthError(mode !== "transient"))
              return { ...previous, access: "new-second", expires: 9999999999999 }
            }),
        }),
      )
      const result = yield* resolver.resolveModel(selected).pipe(Effect.result)
      if (mode === "automatic") {
        expect(result._tag).toBe("Success")
        if (result._tag !== "Success") return
        expect(result.success.accountID).toBe(saved[1].id)
        expect(refreshed).toEqual(["first", "second"])
        const headers = yield* result.success.model.route.auth.apply({
          request: LLM.request({ model: result.success.model, prompt: "Hi" }),
          headers: Headers.empty,
          body: "",
          method: "POST",
          url: "https://provider.test",
        })
        expect(headers.authorization).toBe("Bearer new-second")
      } else {
        expect(result._tag).toBe("Failure")
        expect(refreshed).toEqual(["first"])
      }
      expect((yield* accounts.list()).find((account) => account.id === saved[0].id)?.policy.health).toBe(
        mode === "transient" ? "unknown" : "reauthenticate",
      )
      expect((yield* credentials.get(saved[0].id))?.value).toMatchObject({ refresh: "refresh-first" })
    }),
  )
}
