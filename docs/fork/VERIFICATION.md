# Verification

Branch: `routing-accounts`. Base: `v2.1.4` / `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`.
Runtime used: Bun 1.4.4 on Linux. No live provider credentials were used.

| Check                                                                                                        | Result                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Core affected suites: routing, account policy/selection, credentials, migration, integration, model resolver | 82 passed                                                                                                     |
| CLI auth suite                                                                                               | 13 passed                                                                                                     |
| TUI account interaction and existing command-selection suite                                                 | 4 passed                                                                                                      |
| TUI account suite repeated ten times                                                                         | 30 passed                                                                                                     |
| Server model readiness and credential response security                                                      | 2 passed                                                                                                      |
| `bun typecheck`: Core, Server, CLI, TUI, Client, Schema, Protocol, Plugin                                    | All passed                                                                                                    |
| Official `typecheck:tsc`: Core, Server, CLI, TUI                                                             | All passed                                                                                                    |
| Client `bun run generate`, repeated                                                                          | Passed; generated diffs identical                                                                             |
| CLI `--help` smoke                                                                                           | Passed; accounts and route commands registered                                                                |
| Secret export without `--standalone`                                                                         | Rejected before contacting a server                                                                           |
| `git diff --check`                                                                                           | Passed                                                                                                        |
| Root `bun run check`                                                                                         | Lint passed; workspace typecheck failed in website packages because `@cloudflare/workerd-linux-64` is missing |

Dependency installation encountered DNS failures, including platform binaries.
A retry was stopped after it stalled; lockfile-only resolution completed. The final
canonical check produced the missing-Workerd failure above. Earlier during
installation a full check also encountered Turbo SIGBUS. These are not reported as
successful full-workspace verification.

Terminal verification used the actual production account dialog and application
with local HTTP fixtures at 45 and 100 columns. No real OAuth login, refresh,
revocation, subscription access, Jev account, or Laya model server was exercised.

See README.md's acceptance status for the unimplemented portions of the plan.
These results validate the implemented subset, not the complete requested product.

## Routing notices and Auto picker follow-up

- Routing HTTP fixture/notice tests: 8 passed.
- Auto picker interaction tests: 2 passed; narrow (44 columns) and wide (100)
  rendering, search, setup guard, selection, and explicit-model override covered.
- Core and TUI official `typecheck:tsc`: passed.
- Canonical `bun run check`: lint completed; workspace typecheck failed on the
  existing missing Workerd Linux binary in posts/www, followed by a Turbo SIGSEGV.
- No live Jev call: `TYPESAFE_API_KEY` was absent in the implementation environment.
  See JEV.md for setup and explicit backend verification.

## Managed Laya and routing setup

- Added `/routing` and automatic setup dialog when Jev and Laya both fail.
- Core routing/runtime, config normalization, credential and vault suites: 57 passed.
- TUI setup/picker interaction suites: 6 passed, including masked key entry at
  44/100 columns, explicit install confirmation, cancellation, and event dispatch.
- Server setup/model suites: 2 passed. The setup fixture saves/rotates a key,
  verifies secret-free responses, and confirms the rotated key is used for a
  Jev preview against a local HTTP fixture.
- Fixed configuration normalization dropping the routing field, caught by the
  server preview test; added a focused regression test.
- Core, Server and TUI official `typecheck:tsc`: passed.
- Clients regenerated after Protocol changes. Formatting and diff checks passed.
- Canonical `bun run check`: lint passed with existing warnings; posts/www
  typechecks failed because the Workerd Linux binary is missing.
- Laya subprocess/install commands and health lifecycle tested with controlled
  fixtures. Real package installation, model downloads and live CPU inference
  have not been exercised; no models were installed during implementation.

## Renderer resize listener warning

- Replaced per-component dimension subscriptions with one reference-counted
  subscription per renderer, released when its last consumer unmounts.
- 24-reader mount/resize/unmount regression and repeated full-app Auto selection
  pass; the listener count returns to baseline after each dialog closes.
- Focused routing, setup, accounts and dimension tests: 11 passed.
- TUI official TypeScript check passed. Canonical check still fails on the
  existing missing Workerd Linux binary in www/posts.

## Interactive routing configuration

- Selecting unconfigured Auto opens setup instead of the configuration toast.
- Added profile add/edit/remove flow for model, supported variant, name, tasks,
  and cost; enable/disable and save/use Auto share the backend setup menu.
- TUI routing setup/picker suites: 10 passed, including full profile creation and
  Save and use Auto at 44/100 columns, plus listener lifecycle regression.
- Server routing setup suite: 2 passed, including comment/unrelated-setting
  preservation, synchronous reload, and rejection of enabled empty profiles.
- TUI official TypeScript check passed. Client generation completed. Canonical
  check remains blocked by the missing Workerd binary and a Turbo crash.

## Gradcode branding and simplified Auto

- App title, wordmark, CLI help, ACP identity, and launcher use Gradcode.
- OpenCode config/storage paths, package namespaces, provider IDs, and upstream
  license/provenance remain compatible.
- Auto detects configured Jev or healthy Laya, discovers enabled tool-capable
  models and supported variants, and saves candidates automatically.
- Setup menu has only Jev and Laya choices; completing setup selects Auto.
- TUI setup/picker/presentation: 11 passed. Core routing/runtime: 11 passed.
  Server setup/discovery: 3 passed. CLI mini/ACP: 17 passed; stats/pair: 17 passed.
- CLI, core, TUI, and server official TypeScript checks passed. Client generation
  completed. Canonical check fails on missing Workerd binaries in www/posts.
- CLI help/version smoke checks passed. Live Jev credentials and real Laya model
  installation/inference were not exercised.

## Laya installation progress

- Setup copy shortened; installation shows four server-reported stages for
  preparation, dependencies, Laya, and model loading. The bar counts completed
  stages rather than estimating download bytes or elapsed time.
- TUI setup: 6 passed, including live progress and cancellation at 44/100 columns.
  Runtime: 2 passed, including stage transitions and failure state. Server: 3
  passed, including the progress API response.
- Core, CLI, TUI, and server official TypeScript checks passed; client generation
  completed. Canonical check reaches typechecking but fails on missing Workerd
  and Turbo SIGSEGV. Real model downloads were not exercised.

## Live Laya installation verification (2026-10-24)

- Installed Laya 0.4.14 and completed the 842,609,210-byte English checkpoint
  download. Verified SHA-256
  `891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c`.
- Reused and validated an earlier partial download, retrieved remaining HTTP ranges,
  verified the complete artifact, and removed temporary chunks.
- Managed Laya health: status ok, English checkpoint loaded on CPU; installation
  progress reports 4/4. Revision: `7b928d828b7b0e022f929d9bd2e44165aa270148`.
- Two actual routing CLI previews returned backend `laya`, with different model
  selections, in 1.86s and 1.60s including CLI overhead. This verifies local
  classification, not provider inference or authentication.
- Fixed repeated routing-setup events replacing an active installer, retained the
  4/4 completion screen, and made failures persist with a retry action.
- Raised initial model startup allowance to 60 minutes. Managed CPU threads
  default to four; larger Choice pools use Laya tournament groups.
- Preserved Bun preload flags in child server commands and removed Bun's idle
  fetch deadline from the CLI API request path. This fixes actual background
  server startup and long-running installation requests.
- TUI routing setup/picker: 11 passed. CLI service/standalone: 26 passed. Runtime:
  2 passed. Affected official TypeScript checks passed. Canonical check still
  fails on missing Workerd and a Turbo crash.
