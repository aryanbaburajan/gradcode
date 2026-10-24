import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { callbackCode, pkce, token } from "./subscription-oauth.js"

// Public installed-client identifier, not a client secret. Protocol reference: docs/fork/ACCOUNTS.md.
const clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const methodID = "anthropic-subscription"
const redirect = "https://platform.claude.com/oauth/code/callback"
const endpoint = "https://platform.claude.com/v1/oauth/token"

export const AnthropicSubscriptionPlugin = define({
  id: "gradcode.provider.anthropic-subscription",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const request = (input: Parameters<typeof token>[0]) =>
      token(input).pipe(Effect.provideService(HttpClient.HttpClient, http))
    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: "anthropic",
        method: { type: "oauth", id: methodID, label: "Claude subscription (unofficial)" },
        authorize: (_answer, saved) =>
          Effect.sync(() => {
            const proof = pkce()
            const url = new URL("https://claude.ai/oauth/authorize")
            url.search = new URLSearchParams({
              client_id: clientID,
              response_type: "code",
              redirect_uri: redirect,
              scope: "user:profile user:inference user:sessions:claude_code",
              code_challenge: proof.challenge,
              code_challenge_method: "S256",
              state: proof.state,
            }).toString()
            return {
              mode: "code" as const,
              url: url.toString(),
              instructions:
                "Sign in to Claude and paste the callback URL or code#state. This direct integration is unofficial.",
              callback: (code: string) =>
                Effect.try(() => callbackCode(code, proof.state)).pipe(
                  Effect.flatMap((code) =>
                    request({
                      endpoint,
                      clientID,
                      methodID,
                      json: true,
                      requireIdentity: true,
                      previous: saved,
                      fields: {
                        grant_type: "authorization_code",
                        code,
                        state: proof.state,
                        redirect_uri: redirect,
                        code_verifier: proof.verifier,
                      },
                    }),
                  ),
                ),
            }
          }),
        refresh: (previous) =>
          request({
            endpoint,
            clientID,
            methodID,
            json: true,
            previous,
            fields: { grant_type: "refresh_token", refresh_token: previous.refresh },
          }),
      })
    })
  }),
})
