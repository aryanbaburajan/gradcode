# Gradcode

A terminal coding agent with automatic model and reasoning-effort routing through
Jev or local Laya, multiple provider accounts, and an encrypted credential vault.

Run from source with `bun run dev`, or `./gradcode` from this checkout.
See [setup and configuration](docs/fork/README.md).

Download the [Gradcode v0.1.0 binary](https://github.com/aryanbaburajan/gradcode/releases/tag/gradcode-v0.1.0)
for Linux x64 (glibc, AVX2). The release includes archive checksums. Other platform binaries are not available yet.

The fork's default branch is `gradcode`; OpenCode's original `dev` history is retained separately.
See the [routing benchmark](docs/fork/ROUTING-BENCHMARK-EXPANDED.md) for measured cost and task-success results.

Based on OpenCode v2.1.4 (`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`).
Upstream provenance and license notices are preserved. Upstream upgrades require
an explicit decision; see [UPSTREAM.json](UPSTREAM.json).

The fork retains OpenCode config filenames, storage paths, `OPENCODE_*`
environment variables, package namespaces, and provider identifiers for compatibility
with existing accounts, sessions, plugins, and configuration.

## Development

```sh
bun install
bun run dev
```
