# Gradcode

A terminal coding agent with automatic model and reasoning-effort routing through
Jev or local Laya, multiple provider accounts, and an encrypted credential vault.

Run from source with `bun run dev`, or `./gradcode` from this checkout.
See [setup and configuration](docs/fork/README.md).

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
