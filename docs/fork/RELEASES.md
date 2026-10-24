# Gradcode releases

Gradcode preserves the upstream OpenCode v2.1.4 history recorded in `UPSTREAM.json`.
The fork's publication branch is `gradcode`; `dev` retains the fork's original upstream history.
Release tags point to commits on `gradcode`. Gradcode release numbering is independent of the inherited workspace package versions.

## v0.1.0

Build with Bun 1.4.4:

```sh
OPENCODE_VERSION=0.1.0 OPENCODE_CHANNEL=gradcode bun run --cwd packages/cli script/build.ts --target=gradcode-linux-x64 --skip-install
```

Install the locked dependencies before building. Omit `--skip-install` if native build dependencies need installation. A comma-separated `--target` list selects multiple platforms. `--reuse-app-archive` reuses the embedded web UI archive from a previous build of the same source; do not use it after frontend changes.

Release archives contain the compiled `gradcode` executable and the upstream MIT license. `SHA256SUMS` records archive checksums. The `gradcode` channel disables the upstream automatic updater and rejects upstream upgrade attempts. Download new versions from this fork's GitHub releases.

Validation for the initial release includes 30 core account/routing tests, 5 server tests, 15 TUI tests, 2 Antigravity protocol tests, CLI regression tests, TypeScript checking of the CLI dependency graph, the embedded web UI production build, and Linux executable smoke checks. Cross-compiled binaries are architecture-verified by the build script; macOS and Windows runtime testing requires their native systems.

The existing full-workspace check limitation (website packages missing Workerd) is documented in `VERIFICATION.md`; this release does not claim a passing whole-workspace check. Live provider OAuth and cross-provider account cycling require further real-account testing.
