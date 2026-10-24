# Gradcode

This working branch starts at OpenCode **v2.1.4**, commit
`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`. `UPSTREAM.json` is the upgrade record.
Do not rebase, merge upstream, or replace this fork with an upstream binary without
an explicit upgrade decision. The workspace gateway and diagnostics projects were
removed; OpenCode's language-server diagnostics remain intact.

## Routing

Select **Auto** in the model picker. If Jev or Laya is already configured, Auto
activates immediately. Otherwise, choose **Set up Jev API key** or **Install and
run Laya locally**. Setup activates Auto on completion. Models and supported
reasoning variants are discovered automatically; there is no profile editor or
separate enable/save step. Selecting an explicit model turns Auto off for that
session.

See [Jev setup and routing notices](JEV.md) for key setup, exact classifier inputs,
and how to verify Jev is answering. Select Auto to enable routing for a session;
selecting an explicit model disables it. Each new Auto prompt reports the decision
in a TUI notice and server info log.

Auto generates routing candidates only from the provider of the model selected
before enabling Auto, including its supported reasoning variants. To change the
provider, select one of its models and then select Auto again. The provider scope
is saved as `routing.providerID`; it is reused when Auto is already selected.
Without a prior selection, setup uses the first eligible provider. For advanced backend settings,
`routing` can still be edited in an OpenCode-compatible configuration document.
The following is an internal configuration example; Auto refreshes `profiles` automatically:

```json
{
  "routing": {
    "enabled": true,
    "jev": {
      "model": "jev-latest",
      "timeoutMs": 5000,
      "keyEnvironment": "TYPESAFE_API_KEY"
    },
    "laya": {
      "endpoint": "http://127.0.0.1:8000/v1/systemone",
      "model": "laya",
      "timeoutMs": 5000,
      "keyEnvironment": "LAYA_API_KEY"
    },
    "requestCharacters": 12000,
    "contextCharacters": 2000,
    "profiles": [
      {
        "name": "coding",
        "model": { "providerID": "openai", "id": "gpt-6-sol", "variant": "high" },
        "reasoningEffort": "high",
        "description": "Implementation, debugging, and repository changes",
        "capabilities": ["text", "image", "tools"],
        "costPreference": "balanced"
      }
    ]
  }
}
```

Replace model and variant names with values from `gradcode models`. An effort is
an explicit mapping to the profile's model variant; no provider variant names are
guessed. Unsupported variants, disabled/deprecated models, insufficient context
capacity, missing tools, and unsupported modalities exclude a profile.

Run `gradcode route 'Explain this error'` to preview a decision. Preview does not
execute model inference. The shared endpoint is `POST /api/model/preview` with the
usual Location query and a Routing.Request payload. Select **Auto** in the TUI
model picker to route each newly active user message. Explicit models override
routing. The reserved model reference `auto/auto` represents this selection.

Auto enables routing and generates eligible candidates within its selected provider. Missing
`TYPESAFE_API_KEY` skips Jev. Each backend gets one attempt; error, timeout, malformed
output, or an unrecognized Choice advances Jev → Laya. If neither backend returns
an eligible configured profile, routing reports an unavailable error and does not
execute inference. Select a model explicitly to proceed without a classifier.
There is no deterministic or default-model fallback. Laya compares catalogs larger
than 64 eligible profiles in groups of 64, then compares group winners; each
question stays within its 100-choice limit. The timeout covers all rounds.

Jev defaults to a five-second request timeout and local Laya to thirty seconds;
set `routing.jev.timeoutMs` or `routing.laya.timeoutMs` to override them. Request
failures report backend status or timeout without reopening installation. Selecting
Auto without a configured backend opens setup. You can also run
`/routing` to save a Jev key in the credential vault or install and start local
Laya. See [local hosting and key setup](JEV.md#managed-local-laya).
OpenCode installs the upstream `laya[serve]==0.4.14` package in a private virtual
environment, starts it on `127.0.0.1:8000`, and stops its child process on shutdown.
After successful setup, the preference is saved and local Laya starts when needed.
Repeating setup reuses the managed installation instead of reinstalling packages.
Custom external Laya endpoints remain supported; installation requires the default
loopback endpoint. Inference still uses the System One Choice protocol.

The classifier receives bounded latest-request text, optional explicitly supplied
context, modality names, tool requirements, and configured candidate descriptions.
It receives no transcript, file bytes, tool output, or credential-store values.
Recognizable bearer tokens, API keys, credential assignments, and callback query
fields are redacted. This is not a general-purpose secret detector: avoid putting
secrets in task descriptions or classifier inputs. Session execution supplies no
extra textual context. The local admission estimate examines history size without
transmitting history. Decisions are retained by session/user-message ID in SQLite
KV storage across tool steps and process restarts.

## Linux credential vault

Install your distribution's Secret Service implementation and `secret-tool`
(usually the `libsecret-tools` package). Provision one random key explicitly:

```sh
openssl rand -hex 32 | secret-tool store --label='OpenCode credential vault' application opencode purpose credential-vault
```

For a headless installation, explicitly select an owner-only raw key file:

```sh
install -d -m 700 "$HOME/.config/opencode"
(umask 077; openssl rand 32 > "$HOME/.config/opencode/vault.key")
export OPENCODE_VAULT_KEY_FILE="$HOME/.config/opencode/vault.key"
```

Protect and back up this key independently. Files must be regular, owned by the
current user, inaccessible to group/other users, exactly 32 bytes, and not symlinks.
There is no implicit key-file or plaintext fallback. A locked existing vault needs
unlocking and a server restart before credential use resumes. Public account
metadata remains readable while locked.

Credential payloads use AES-256-GCM with a fresh 96-bit nonce. Authenticated data
binds format version, credential ID, and integration ID. Ciphertext envelopes carry
only method/type/expiry metadata outside the encrypted payload. Raw provider
metadata and token values never appear in account or credential API responses.

When a key is available at startup, existing plaintext rows migrate in one SQLite
transaction. A durable compaction marker survives interruption between commit,
checkpoint, VACUUM, and final checkpoint. Older backup files and filesystem
snapshots may still contain plaintext; compaction cannot erase those copies.
Do not open the migrated database with an upstream or older binary. For a deliberate
transfer, use local secret export and import into a separate database.

Ordinary `gradcode auth export` returns redacted metadata. Deliberate secret export
requires **both** `--include-secrets --standalone`; it opens the local database
without starting or contacting a server. `--server` is rejected in that mode. No
remote secret-export endpoint exists. A redacted export is not a credential backup.

## Accounts

`/connect` retains upstream authentication methods. `/accounts` lists accounts and
provides add, rename, enable/disable, priority, pin, and remove actions. CLI examples:

```sh
opencode accounts list
opencode accounts rename cred_example Work
opencode accounts disable cred_example
opencode accounts enable cred_example
opencode accounts priority cred_example 10
opencode accounts select cred_example
opencode accounts remove cred_example
```

The shared metadata endpoints are `GET /api/credential/accounts` and
`PATCH /api/credential/:credentialID/account`. Patch supports `label`, `enabled`,
`priority`, and `selected`; `selected: false` clears that integration's pin.
Automatic ordering excludes disabled/unhealthy/cooling or exhausted accounts, then
uses priority, comparable quota, and stable ID. Missing quota stays unknown. Quota
comparison requires every eligible observation to share unit, scope, and reset time.
Account pins never silently switch when unavailable.

Runtime credentials are bound during model resolution without activating another
global credential. Selection currently stays within the active integration method,
because upstream provider plugins derive catalog compatibility from that method.
Account IDs partition session cache affinity. Refreshes use the existing cross-process
file-lock service; credentials are reread under the account lock and rotated tokens
are persisted atomically. Known account-ID changes are rejected during refresh.

## Subscription adapters and verification

See [provider accounts](ACCOUNTS.md) for the ChatGPT, direct Claude subscription,
and direct Antigravity integrations, configuration, recovery rules, protocol
references, and limitations. Direct compatibility adapters are locally tested;
live subscription login and inference remain unverified.
