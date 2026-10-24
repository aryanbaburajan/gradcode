import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber, Layer } from "effect"
import { LLM } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { AntigravityCLI } from "../src/credential/antigravity-cli"
import { AntigravityModel } from "../src/credential/antigravity-model"
import { it } from "./lib/effect"

const raw = JSON.stringify({
  id_token_email: "fixture@example.test",
  token: { access_token: "fixture-access", refresh_token: "fixture-refresh", expiry: "2099-01-01T00:00:00Z" },
})
const saved = AntigravityCLI.credential(raw, {}, ["gemini-fixture"])
const native =
  process.platform === "linux" &&
  ["dbus-run-session", "gnome-keyring-daemon", "secret-tool", "script"].every((name) => Bun.which(name))

test("native credential snapshots preserve expiry and identity inside the encrypted payload", () => {
  expect(saved.methodID).toBe(AntigravityCLI.methodID)
  expect(saved.expires).toBe(Date.parse("2099-01-01T00:00:00Z"))
  expect(saved.metadata?.accountID).toBe("fixture@example.test")
  expect(saved.metadata?.nativeKeyring).toBe(raw)
  expect(
    AntigravityCLI.parseModels(
      "Fetching available models...\ngemini-fixture\tGemini\nclaude-test\tClaude\ngemini-fixture\tAgain\n",
    ),
  ).toEqual(["gemini-fixture", "claude-test"])
})

// Real private D-Bus/keyring; the fixture replaces only the external inference executable.
test.skipIf(!native)("native sessions isolate HOME/keyring and capture credentials without printing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "gradcode-agy-test-"))
  try {
    const executable = join(root, "agy")
    await writeFile(
      executable,
      '#!/bin/sh\nset -eu\n[ "$HOME" != "' +
        root +
        '" ]\n[ "$XDG_RUNTIME_DIR" = "$HOME/runtime" ]\nsecret-tool lookup service gemini username antigravity >/dev/null\nprintf \'gemini-fixture\\tGemini\\n\'\n',
      { mode: 0o700 },
    )
    const process = await AntigravityCLI.start({ saved, cwd: root, args: ["models"], executable })
    try {
      const result = await process.result
      expect(result.output).toBe("gemini-fixture\tGemini\n")
      expect(result.value.access).toBe(saved.access)
      expect(result.output).not.toContain(saved.access)
    } finally {
      await process.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.skipIf(!native)("native login forwards the browser code and saves a separate account", async () => {
  const root = await mkdtemp(join(tmpdir(), "gradcode-agy-login-test-"))
  try {
    const executable = join(root, "agy")
    await writeFile(
      executable,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = models ]; then printf 'gemini-fixture\\tGemini\\n'; exit 0; fi
printf 'Select login method'
read -r choice
xdg-open 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture'
printf 'Paste authorization code:'
read -r code
[ "$code" = fixture-browser-code ]
printf '%s' '${raw}' | secret-tool store --label fixture service gemini username antigravity
sleep 60
`,
      { mode: 0o700 },
    )
    const process = await AntigravityCLI.start({ cwd: root, login: true, executable })
    try {
      expect(new URL(await process.url()).hostname).toBe("accounts.google.com")
      await expect(process.submitCode("invalid\nsecond-line")).rejects.toThrow("Authentication temporarily unavailable")
      await process.submitCode("  fixture-browser-code  ")
      const result = await process.result
      expect(result.output).not.toContain("fixture-browser-code")
      expect(result.value.metadata?.modelIDs).toEqual(["gemini-fixture"])
      expect(result.value.metadata?.accountID).toBe(saved.metadata?.accountID)
    } finally {
      await process.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.effect("signed-out native accounts fail before starting inference", () =>
  Effect.gen(function* () {
    const runtime = AntigravityModel.model("gemini-fixture", saved, "/nonexistent", () => Effect.void, Effect.undefined)
    const error = yield* LLMClient.generate(LLM.request({ model: runtime, prompt: "hello" })).pipe(
      Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer))),
      Effect.flip,
    )
    expect(error.reason._tag).toBe("Authentication")
    expect(error.reason.http?.status).toBe(401)
  }),
)

it.effect("native account locks serialize operations and release on cancellation", () =>
  Effect.gen(function* () {
    const first = yield* AntigravityCLI.withAccount("lock-fixture", Effect.never).pipe(
      Effect.forkChild({ startImmediately: true }),
    )
    yield* Fiber.interrupt(first)
    expect(yield* AntigravityCLI.withAccount("lock-fixture", Effect.succeed("released"))).toBe("released")
  }),
)

for (const rejected of [false, true]) {
  test.skipIf(!native)(
    `native model ${rejected ? "rejects expired authentication before inference" : "returns native text and usage without host tool calls"}`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gradcode-agy-model-test-"))
      try {
        const executable = join(root, "agy")
        await writeFile(
          executable,
          `#!/bin/sh
set -eu
if [ "$1" = models ]; then
  ${rejected ? "printf 'Please sign in to view available models' >&2; exit 1" : "printf 'gemini-fixture\\tGemini\\n'; exit 0"}
fi
printf '%s' '{"event":"result","result":{"status":"SUCCESS","response":"native answer","usage":{"input_tokens":12,"output_tokens":3}}}'
`,
          { mode: 0o700 },
        )
        const persisted: string[] = []
        const runtime = AntigravityModel.model(
          "gemini-fixture",
          saved,
          root,
          (value) =>
            Effect.sync(() => {
              persisted.push(value.access)
            }),
          Effect.succeed(saved),
          executable,
        )
        const result = await Effect.runPromise(
          LLMClient.generate(LLM.request({ model: runtime, prompt: "hello" })).pipe(
            Effect.result,
            Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer))),
          ),
        )
        if (rejected) {
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(result.failure.reason._tag).toBe("Authentication")
          expect(persisted).toHaveLength(0)
        } else {
          expect(result._tag).toBe("Success")
          if (result._tag === "Success") {
            expect(result.success.text).toBe("native answer")
            expect(result.success.usage?.inputTokens).toBe(12)
            expect(result.success.toolCalls).toHaveLength(0)
          }
          expect(persisted).toHaveLength(2)
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}

test.skipIf(!native)("canceling native login terminates its private terminal process", async () => {
  const root = await mkdtemp(join(tmpdir(), "gradcode-agy-cancel-test-"))
  try {
    const executable = join(root, "agy")
    await writeFile(
      executable,
      `#!/bin/sh
printf 'Select login method'
read -r choice
printf '%s' "$$" > '${root}/pid'
xdg-open 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture'
exec sleep 60
`,
      { mode: 0o700 },
    )
    const session = await AntigravityCLI.start({ cwd: root, login: true, executable })
    try {
      await session.url()
      const pid = Number(await readFile(join(root, "pid"), "utf8"))
      await session.close()
      await session.result.catch(() => undefined)
      // kill(pid, 0) also succeeds for an already terminated child awaiting OS reaping.
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined)
      const state = stat?.slice(stat.lastIndexOf(") ") + 2).split(" ")[0]
      expect(state === undefined || state === "Z" || state === "X").toBe(true)
    } finally {
      await session.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
