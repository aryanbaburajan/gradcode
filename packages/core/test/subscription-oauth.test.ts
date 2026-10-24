import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Credential } from "../src/credential"
import { Integration } from "../src/integration"
import { it } from "./lib/effect"
import { callbackCode, pkce, token } from "../src/plugin/provider/subscription-oauth"

test("PKCE attempts have independent verifier, challenge, and state", () => {
  const first = pkce()
  const second = pkce()
  expect(first.verifier).not.toBe(second.verifier)
  expect(first.state).not.toBe(second.state)
  expect(first.challenge).toBe(new Bun.CryptoHasher("sha256").update(first.verifier).digest("base64url"))
})

test("manual OAuth callbacks must match the pending state", () => {
  expect(callbackCode("code#expected", "expected")).toBe("code")
  expect(callbackCode("https://example.com/callback?code=code&state=expected", "expected")).toBe("code")
  for (const input of [
    "code",
    "code#other",
    "#expected",
    "https://example.com/callback?error=access_denied&state=expected",
  ])
    expect(() => callbackCode(input, "expected")).toThrow("Invalid OAuth callback or state")
})

for (const [status, code, terminal] of [
  [400, "invalid_grant", true],
  [503, "temporarily_unavailable", false],
] as const) {
  it.effect(`OAuth token error ${code} has sanitized terminal state`, () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(request, Response.json({ error: code, detail: "private-token" }, { status })),
        ),
      )
      const error = yield* token({
        endpoint: "https://example.com/token",
        clientID: "public",
        methodID: "test",
        fields: { grant_type: "refresh_token" },
      }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.flip)
      expect(error.terminal).toBe(terminal)
      expect(error.message).not.toContain("private-token")
    }),
  )
}

it.effect("OAuth refresh preserves an omitted refresh token and rejects missing required identity", () =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(request, Response.json({ access_token: "new-access", expires_in: 3600 })),
      ),
    )
    const previous = Credential.OAuth.make({
      type: "oauth",
      methodID: Integration.MethodID.make("test"),
      access: "old-access",
      refresh: "retained-refresh",
      expires: 0,
      metadata: { accountID: "identity" },
    })
    const input = {
      endpoint: "https://example.com/token",
      clientID: "public",
      methodID: "test",
      previous,
      fields: { grant_type: "refresh_token" },
    }
    const value = yield* token(input).pipe(Effect.provideService(HttpClient.HttpClient, http))
    expect(value).toMatchObject({
      access: "new-access",
      refresh: "retained-refresh",
      metadata: { accountID: "identity" },
    })
    const failure = yield* token({ ...input, requireIdentity: true }).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.flip,
    )
    expect(failure.message).not.toContain("retained-refresh")
  }),
)
