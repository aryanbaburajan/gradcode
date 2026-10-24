/** Direct OAuth compatibility primitives. No credential discovery or external token stores. */
import { OAuthError } from "../../credential/oauth-error.js"
import { Clock, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"

const Tokens = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optional(Schema.NonEmptyString),
  expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
  account: Schema.optional(Schema.Struct({ uuid: Schema.String })),
})
const Failure = Schema.Struct({ error: Schema.optional(Schema.String) })

export function pkce() {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  return {
    verifier,
    challenge: new Bun.CryptoHasher("sha256").update(verifier).digest("base64url"),
    state: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
  }
}

export function callbackCode(input: string, expected: string) {
  const url = URL.canParse(input) ? new URL(input) : undefined
  const parts = input.trim().split("#")
  const code = url ? url.searchParams.get("code") : parts[0]
  const state = url ? url.searchParams.get("state") : parts[1]
  if (!code || code.length > 8192 || state !== expected) throw new Error("Invalid OAuth callback or state")
  return code
}

export const token = Effect.fn("SubscriptionOAuth.token")(function* (input: {
  endpoint: string
  clientID: string
  methodID: string
  fields: Record<string, string>
  json?: boolean
  requireIdentity?: boolean
  previous?: Credential.OAuth
  metadata?: Record<string, unknown>
}) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(input.endpoint)
  const response = yield* http
    .execute(
      input.json
        ? yield* HttpClientRequest.bodyJson(request, { client_id: input.clientID, ...input.fields }).pipe(
            Effect.mapError(() => new OAuthError(false)),
          )
        : HttpClientRequest.bodyUrlParams(request, { client_id: input.clientID, ...input.fields }),
    )
    .pipe(
      Effect.timeout("30 seconds"),
      Effect.mapError(() => new OAuthError(false)),
    )
  const body = yield* response.json.pipe(Effect.mapError(() => new OAuthError(false)))
  if (response.status < 200 || response.status >= 300) {
    const error = Schema.decodeUnknownOption(Failure)(body)
    const code = error._tag === "Some" ? error.value.error : undefined
    return yield* Effect.fail(
      new OAuthError(
        ["invalid_grant", "invalid_refresh_token", "refresh_token_expired", "refresh_token_reused"].includes(
          code ?? "",
        ),
      ),
    )
  }
  const tokens = yield* Schema.decodeUnknownEffect(Tokens)(body).pipe(Effect.mapError(() => new OAuthError(false)))
  if (input.requireIdentity && !tokens.account?.uuid) return yield* Effect.fail(new OAuthError(false))
  const refresh = tokens.refresh_token ?? input.previous?.refresh
  if (!refresh) return yield* Effect.fail(new OAuthError(false))
  const now = yield* Clock.currentTimeMillis
  return Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make(input.methodID),
    access: tokens.access_token,
    refresh,
    expires: now + tokens.expires_in * 1000,
    metadata: {
      ...input.previous?.metadata,
      ...input.metadata,
      clientID: input.clientID,
      ...(tokens.account ? { accountID: tokens.account.uuid } : {}),
    },
  })
})
