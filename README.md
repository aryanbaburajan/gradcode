# Gradcode

**An AI coding agent for students who need to make their model budget go further.**

[GitHub repository](https://github.com/aryanbaburajan/gradcode) · [Website](https://gradcode.vercel.app/) · [Download](https://github.com/aryanbaburajan/gradcode/releases/tag/gradcode-v0.1.0)

## Overview

Gradcode helps students build projects, debug code, and work through programming tasks from their terminal. It extends OpenCode's existing agent, tools, and session system with automatic model selection and management of multiple provider accounts.

Using an expensive model with high reasoning effort for every request can make a limited budget disappear quickly. Switching models and managing separate API keys or subscription accounts also interrupts the work. Gradcode brings those choices into the agent: select **Auto** to route requests to an available model and reasoning variant, and manage saved accounts in one place.

The goal is to reduce unnecessary inference spending while keeping more capable models available when needed. The current benchmark measures estimated model cost and task success; it does not establish a reduction in token usage or equivalent answer quality.

## Product demo

[Visit the hosted Gradcode site](https://gradcode.vercel.app/) for an introduction to the prototype, a terminal screenshot, installation instructions, and benchmark results. The coding agent itself runs locally in your terminal.

### Screen recording

*Demo video coming soon.*

<!-- Replace the placeholder above with the uploaded screen recording or a video link showing Gradcode in action. -->

## The idea and what we built

### Automatic model and reasoning selection

Auto discovers eligible models and their supported reasoning variants from connected providers. It filters candidates for tool support, input modalities, and context capacity, then asks a classifier to choose a profile for the request.

The routing backends are **Jev**, a hosted classifier, and **Laya**, a local CPU-based classifier. The terminal setup flow can save a Jev key or install and manage Laya in a private Python environment. Routing tries Jev when configured, then Laya. If neither returns a valid choice, Gradcode reports an error; users can select a model explicitly.

The classifier receives bounded, redacted request text and candidate descriptions. Session routing does not send the full conversation, file contents, or tool output to the classifier. Decisions are saved per user message and reused across subsequent tool steps, and the terminal displays the selected model and reasoning variant.

### Multiple accounts and controlled recovery

The `/accounts` interface and `gradcode accounts` commands let users inspect, label, enable, disable, prioritize, pin, and remove saved provider accounts. The implementation supports API-key credentials and OAuth integrations, including ChatGPT. Direct Claude subscription and Antigravity compatibility adapters are also present, but their live subscription login and inference paths remain unverified.

Account selection respects the active authentication method, account health, explicit pins, and known limits. Recovery can switch eligible accounts after a rejected authentication attempt, before response output begins. Cross-provider fallback uses explicitly configured models. It does not silently rotate accounts to bypass quota, billing, permission, or policy denials. Unknown quota stays unknown.

### Encrypted credentials

Credential payloads are encrypted with **AES-256-GCM**. The vault uses Linux Secret Service or an explicitly provisioned, owner-only key file. Account APIs expose management metadata without returning access or refresh tokens. Token refresh uses account locks and persists rotated credentials. Secret export requires an explicit local, standalone operation.

### Terminal experience and distribution

The fork adds Gradcode branding, a red terminal theme, Auto setup and selection controls, account dialogs, routing previews, and routing notices. A GitHub Actions workflow builds tagged Linux binaries with the inherited web UI embedded, smoke-tests the executable, and publishes release archives and SHA-256 checksums. Upstream OpenCode automatic upgrades are disabled for Gradcode releases.

## Technology stack and tools

| Area | Technologies and role |
| --- | --- |
| Application and runtime | TypeScript and Bun; workspace packages separate the CLI, core agent, schemas, API, and clients. |
| Services and APIs | Effect services, layers, Schema validation, and typed HTTP APIs with generated clients. |
| User interfaces | SolidJS and OpenTUI for the terminal; the inherited SolidJS/Vite web UI is embedded in release binaries. |
| Routing | Jev's hosted classification API and the locally managed Python `laya[serve]` service. |
| Persistence and credentials | SQLite, Drizzle ORM, Node.js cryptography, Linux Secret Service, and cross-process file locks. |
| Verification and delivery | Bun tests, TypeScript checks, Python benchmark runners, Bun executable compilation, and GitHub Actions. |

The routing and account-management changes are integrated into OpenCode's existing execution loop. The inherited coding tools, provider infrastructure, session engine, and web UI come from OpenCode.

## Benchmark results

### Capped history cost estimate

**$16.71 per $100 all-Astra: 83.29% lower estimated token cost**, modelling cache misses on the first call after each model switch. This capped analysis covers **898 historical calls** and **177 classified turns**. It holds recorded token counts fixed when repricing models; these are **fixed-token estimates, not measured savings from replaying requests**. Answer quality was not evaluated.

Read the [method and limitations](docs/fork/ROUTING-BENCHMARK-CAPPED.md) and [statistic JSON](docs/fork/expanded-results/capped-stat.json).

### Separate coding-task evaluation

In an adapted Aider Polyglot evaluation of **34 Python tasks**, with two attempts per condition, Auto–Laya used **71.9% less estimated model cost** than fixed GPT-6-Astra/high on **65 paired attempts with complete usage records** (130 runs).

Across **all 136 runs**, task success was **55.9% for Auto–Laya (38/68)** and **83.8% for Astra/high (57/68)**. This is a measured cost–quality trade-off, not an equivalent-quality result. The benchmark used a specific six-profile OpenAI pool; it does not establish performance for every provider or the default candidate pool.

Five calls lacked usage records. Full-run billed savings are unknown. Costs are catalog-based estimates and exclude local CPU, tools, setup, and pilot runs.

Read the [full methodology and results](docs/fork/ROUTING-BENCHMARK-EXPANDED.md), [machine-readable statistics](docs/fork/expanded-results/landing-stat.json), and [raw execution records](docs/fork/expanded-results/results.json).

## Getting started

The [v0.1.0 release](https://github.com/aryanbaburajan/gradcode/releases/tag/gradcode-v0.1.0) provides a Linux x64 binary requiring glibc and AVX2. Download the archive, verify it against `SHA256SUMS`, extract it, and run `./gradcode`. Other platform binaries are not published yet.

To run from source, use **Bun 1.4.4**; release build tooling also uses **Node.js 24**:

```sh
git clone --branch gradcode https://github.com/aryanbaburajan/gradcode.git
cd gradcode
bun install
bun run dev
```

Before saving credentials, follow the [Linux vault setup](docs/fork/README.md#linux-credential-vault). Connect providers with `/connect`, manage them with `/accounts`, and select **Auto** in the model picker to configure routing. Local Laya setup requires Python 3.10+, virtual-environment support, and a model download.

Useful commands once running from an installed binary:

```sh
gradcode accounts list
gradcode route 'Explain this error'
```

The routing preview selects a profile without executing model inference. See [setup and configuration](docs/fork/README.md), [provider accounts](docs/fork/ACCOUNTS.md), [routing backends](docs/fork/JEV.md), and [verification notes](docs/fork/VERIFICATION.md) for details and current limitations.

## OpenCode foundation and license

Gradcode is a fork of **OpenCode v2.1.4**, based on commit `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`. The fork's default branch is `gradcode`; upstream history is retained separately. [UPSTREAM.json](UPSTREAM.json) records the base, and upstream upgrades require an explicit decision.

OpenCode configuration filenames, storage paths, `OPENCODE_*` environment variables, package namespaces, and provider identifiers are retained for compatibility with existing sessions, accounts, and plugins.

The project retains the upstream [MIT license](LICENSE) and attribution. See [OpenCode](https://github.com/anomalyco/opencode) for the original project.
