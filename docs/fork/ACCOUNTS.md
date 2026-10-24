# Provider accounts

Gradcode supports direct subscription adapters and a delegated native Antigravity CLI backend. Connect with
`/connect` and manage saved connections with `/accounts`. Adding an account creates
a separate credential. Reauthenticate updates the chosen credential in place and
rejects a different known account identity. Remove deletes local credentials; it
does not cancel a subscription or guarantee remote access revocation.

| Provider                   | Login and inference                                                                                                 | Limitations                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT                    | Existing OpenAI token-sharing OAuth, PKCE, verified ID-token issuer/audience/nonce/subject; native OpenAI inference | Requires token-sharing permission and eligible account. Distinct registration per added account; reauthentication retains its registration. Provider policy errors stop retries.                                                              |
| Anthropic                  | Unofficial direct Claude OAuth authorization-code flow with PKCE; native Anthropic bearer authentication            | Compatibility integration, not a claim of Anthropic endorsement. No CLI identity spoofing or prompt rewriting. Provider may reject third-party inference. Reauthentication identity is checked when the token endpoint supplies account UUID. |
| Antigravity native CLI     | Official installed `agy` Google login and native agent inference                                                    | Linux isolation dependencies; text, plan mode and sandboxing; see native CLI setup below.                                                                                                                                                     |
| Existing API-key providers | Existing login/key adapters and native transports                                                                   | Quota and subscription eligibility stay provider-specific.                                                                                                                                                                                    |

The direct compatibility paths have local protocol tests, but their live subscription
login and inference have not been verified. Native Antigravity inference was verified
separately as described below. A successful OAuth
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
method, provider-supplied login email when available, selection/pin state, priority,
status, expiry, and normalized limit state. Connected-account rows distinguish API
keys, login accounts and external credential sources. API keys have no inferable
owner identity. Rows without an email show only the account type; reauthenticate
older login records to record a provider-supplied email. Native Antigravity snapshots can also use their saved login email.
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

## Protocol references

The Claude compatibility adapter was implemented against protocol behavior inspected
in `@ex-machina/opencode-anthropic-auth@2.0.0-next.6`, which is not a runtime
dependency. Claude's installed-client identifier is public OAuth registration
data, not a secret. Compatibility endpoints can change independently of Gradcode
releases.

## Native Antigravity CLI accounts (Linux)

Select **Antigravity → Google login with Antigravity CLI** in `/connect` (or add an
account in `/accounts`). Gradcode launches `agy`, selects its Google OAuth option,
and presents its browser login URL. After approving Google login, paste the code
shown by the browser into Gradcode’s authorization-code field. Antigravity owns OAuth, PKCE, browser callback,
and token refresh. No Google client ID or secret is needed for this method.
The former unofficial custom Google OAuth client flow has been removed. Existing
accounts from that flow must be reconnected through the CLI; saved credentials
are not automatically converted or deleted.
Repeat Add account to connect a second Google account. Each login starts with an
empty, private keyring; your desktop Antigravity login is not signed out.

Install `agy`, `dbus-run-session`, `gnome-keyring-daemon`, `secret-tool`, and the
util-linux `script` command. Set `OPENCODE_ANTIGRAVITY_CLI` to an executable path if
`agy` is not on the server's PATH. This implementation currently supports Linux
Secret Service isolation. Login must be completed on the machine running the
server, or with browser/loopback forwarding arranged by the operator.

The native keyring snapshot and a small allowlist of Antigravity profile files are
stored in the encrypted credential vault. Each operation reconstructs them in a
private temporary HOME and D-Bus session, with a randomly unlocked encrypted
keyring. Operations for the same account are serialized within the Gradcode
process. Refreshed credentials are saved and temporary state is removed on normal
completion or cancellation. Abrupt process termination can leave a private temp
directory; its native keyring is encrypted with a password that was not persisted.
Do not run multiple Gradcode server processes against the same native account.
Local logout clears the saved native keyring as well as access and refresh tokens;
remote revocation must be performed in Google account settings.

Available model IDs come from `agy models`. No quota endpoint or independent
per-account rate allowance is assumed. Priority, enable/disable, pins and existing
account selection apply. Revoked/expired authentication detected before native
inference can select another eligible native account. Rate or subscription limits
do not cause allowance cycling. Once native inference begins, failure stops the
turn rather than replaying possible native tool actions on another account.

Inference delegates a text conversation to Antigravity's own agent loop in the
session's working directory. The initial integration uses native **plan mode and
sandboxing**: it does not grant unattended editing permissions or bridge native
tool approvals into Gradcode. Host tool definitions are not forwarded, and native
tool calls are never replayed by Gradcode. Responses and token usage arrive after
the native turn completes; native tool progress, media input, persistent native
conversation resume, host generation controls and reasoning-effort overrides are
not yet supported. This is a delegated backend, not an API-key-equivalent adapter.

Verified locally with `agy 1.4.6`: isolated model listing, refreshed credential
capture, and a successful isolated Gemini inference. Automated tests cover private
keyrings, native login handoff, signed-out accounts and lock cancellation. A real
second-account browser consent and two-account live failover still require user
login and have not been completed by the test suite.

The native transport follows Google's [headless CLI protocol](https://www.antigravity.google/docs/cli/headless/).
Conversation input is sent over stdin as a documented `user` event, rather than
included in process arguments. Gradcode consumes the final `result` event.

## Cycle backends for a demo

Press **Ctrl+X, then P** (or **Ctrl+Shift+B** with extended keyboard support), run **`/cycle-backend`**, or choose **Cycle connected backend** in the
command palette. Cycling visits connected providers and their saved accounts in a
stable order, then wraps. It retains the current model when available on that
provider, otherwise chooses an available text model. Environment-based and
explicitly enabled keyless backends are included too.

The switch applies to subsequent model calls; it does not run an inference request
or restart a running turn. A toast identifies the provider, account and model, and
an existing chat records a backend-switch notice. Selecting a saved account also
activates and **pins** it for its provider. Restore automatic selection from
`/accounts` → account → **Use automatic selection** when the demo is over. Account
activation and pins are shared by sessions on that server.

Disabled, locked, revoked, unavailable and cooling-down accounts are skipped.
Expired OAuth sessions can refresh through their usual login adapter on use.
Recorded rate/quota restrictions exclude the provider from demo cycling; the
command does not clear restrictions or consume another account's allowance.
Change the shortcut in TUI configuration with:

```json
{ "keybinds": { "backend.cycle": "<leader>p,ctrl+shift+b" } }
```
