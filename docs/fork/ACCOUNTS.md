# Provider accounts

Gradcode resolves subscription credentials into the existing native inference adapters;
there is no second agent loop or dependency on a logged-in CLI process. Connect with
`/connect` and manage saved connections with `/accounts`. Adding an account creates
a separate credential. Reauthenticate updates the chosen credential in place and
rejects a different known account identity. Remove deletes local credentials; it
does not cancel a subscription or guarantee remote access revocation.

| Provider                   | Login and inference                                                                                                           | Limitations                                                                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT                    | Existing OpenAI token-sharing OAuth, PKCE, verified ID-token issuer/audience/nonce/subject; native OpenAI inference           | Requires token-sharing permission and eligible account. Distinct registration per added account; reauthentication retains its registration. Provider policy errors stop retries.                                                                                    |
| Anthropic                  | Unofficial direct Claude OAuth authorization-code flow with PKCE; native Anthropic bearer authentication                      | Compatibility integration, not a claim of Anthropic endorsement. No CLI identity spoofing or prompt rewriting. Provider may reject third-party inference. Reauthentication identity is checked when the token endpoint supplies account UUID.                       |
| Antigravity                | Unofficial Google OAuth with PKCE and loopback callback; Cloud Code Assist discovery and Gemini-compatible streaming envelope | Requires an authorized OAuth client and an already entitled project. No embedded Google client secret, automatic onboarding, or invented project. Non-Gemini protocol extensions, thought signatures, and special Claude model transformations are not implemented. |
| Existing API-key providers | Existing login/key adapters and native transports                                                                             | Quota and subscription eligibility stay provider-specific.                                                                                                                                                                                                          |

These direct compatibility paths have local protocol tests. Live subscription logins
and inference have not been verified in this implementation. A successful OAuth
authorization does not establish permission for every model or API operation.
Use only accounts and client registrations you are authorized to use. Provider
terms, subscription limits, account-sharing rules, and policy denials still apply.

## Storage and lifecycle

Follow [vault setup](README.md#linux-credential-vault) before saving credentials.
All credential payloads, including refresh tokens, ID tokens, OAuth client secrets,
and retained provider metadata, are encrypted with AES-256-GCM. The key lives in
Linux Secret Service or an explicitly provisioned owner-only raw 32-byte key file.
There is no automatic plaintext fallback. Back up the key independently.

The public account view exposes credential ID, label, provider integration, login
method, selection/pin state, priority, status, expiry, and normalized limit state.
It never exposes access/refresh/ID tokens or arbitrary provider metadata. OAuth
metadata is not merged into inference request bodies. Expired credentials refresh
under the existing cross-process account lock, then persist rotated tokens. A
terminal refresh failure requires reauthentication; transient failures preserve
credentials. An expired account without a refresh implementation is never used.

`gradcode accounts list` and `gradcode accounts inspect ACCOUNT_ID` show safe state.
Other actions are `rename`, `enable`, `disable`, `priority`, `select`, `unselect`,
`logout`, and `remove`. TUI account actions include reauthentication. `select` pins
that provider account strictly; `unselect` restores automatic selection. `logout`
attempts remote revocation when the adapter exposes it, clears local session tokens,
and reports when remote revocation cannot be confirmed. Disconnect the app in
provider settings for providers without a supported revocation implementation.

## Selection and recovery

Selection stays within the active provider authentication method. Disabled,
revoked, reauthentication-required, unavailable, cooling, and exhausted accounts
are excluded. Higher user priority wins, then larger remaining quota only when all
observations share a documented unit, scope, and reset window, then the active
account and stable ID. Unknown quota remains unknown; no subscription quota endpoint
is assumed and these adapters do not poll undocumented quota APIs.

A rejected authentication attempt (HTTP 401) can select an eligible account before
any response output. Pins prevent switching. Permission/billing/policy denials
never authorize account rotation. Unknown or shared-scope rate limits restrict
selection to the limited account, including after restart. Only a supplied retry
delay establishes a cooldown; no reset time is guessed. Quota exhaustion requires
operator/provider recovery and does not spend another account's allowance. There
is currently no provider adapter declaring an independently scoped rate-limit
allowance eligible for automatic rotation. Model switching is blocked after output
starts, including tool output; partial streams keep their original runtime model.

Cross-provider fallback is opt-in because it changes inference/data destination:

```json
{
  "accounts": {
    "failover": true,
    "providerPreference": ["anthropic", "openai"],
    "fallbacks": [{ "providerID": "anthropic", "id": "YOUR_AVAILABLE_MODEL_ID" }]
  }
}
```

Fallback candidates must already resolve, support the request's tools and input
modalities, and have sufficient context. Provider preferences order configured
fallbacks; they do not discover or authorize new providers. `failover: false`
disables automatic switching, including on terminal refresh failures. Existing
provider retry hooks can veto a retry. Fallback applies to inference failures;
initial catalog/credential resolution errors require selecting an eligible model.

For Antigravity, configure `OPENCODE_ANTIGRAVITY_CLIENT_ID` and
`OPENCODE_ANTIGRAVITY_CLIENT_SECRET` for your authorized Google OAuth client with
`http://localhost:51121/oauth-callback` registered. The browser and server must be
on the same machine (or you must explicitly arrange loopback forwarding). The
listener binds IPv4 loopback. No SSH login orchestration is provided. Available
model IDs come from the connected account's discovery response; availability can
change after discovery and provider denials remain authoritative.

## Protocol references

The direct adapters were implemented against protocol behavior inspected in
`@ex-machina/opencode-anthropic-auth@2.0.0-next.6` and
`opencode-antigravity-auth@2.1.1`. They are not runtime dependencies. The latter
package is MIT licensed, copyright 2025 Jens. No embedded OAuth client secrets,
identity cloaking, prompt filtering bypasses, or subscription-limit rotation from
those packages are included. Claude's installed-client identifier is public OAuth
registration data, not a secret. Compatibility endpoints can change independently
of Gradcode releases.
