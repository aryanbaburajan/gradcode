export * as AntigravityCLI from "./antigravity-cli.js"
/** Native agy sessions live in a private D-Bus/keyring, never the desktop keyring. */
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema, Semaphore } from "effect"
import { Integration } from "../integration.js"
import { Credential } from "../credential.js"
import { OAuthError } from "./oauth-error.js"

export const methodID = Integration.MethodID.make("antigravity-cli")
const files = ["installation_id", "jetski_state.pbtxt", "cache/onboarding.json", "cache/default_project_id.txt"]
const Snapshot = Schema.Struct({
  id_token_email: Schema.NonEmptyString,
  token: Schema.Struct({
    access_token: Schema.NonEmptyString,
    refresh_token: Schema.optional(Schema.String),
    expiry: Schema.NonEmptyString,
  }),
})
const script = `
set -eu
read -r password
read -r seed
printf '%s\\n' "$password" | gnome-keyring-daemon --foreground --unlock --components=secrets --control-directory "$HOME/control" >/dev/null 2>&1 &
daemon=$!
trap 'kill "$daemon" 2>/dev/null || true' EXIT
if [ -n "$seed" ]; then printf '%s' "$seed" | base64 -d | secret-tool store --label 'Gradcode private Antigravity session' service gemini username antigravity; fi
if [ "$1" = login ]; then
  exec 5<&0
  script -q -c 'echo $$ > "$HOME/native-pid"; exec "$AGY_EXECUTABLE"' /dev/null <&5 &
  cli=$!
  while kill -0 "$cli" 2>/dev/null; do
    saved=$(secret-tool lookup service gemini username antigravity 2>/dev/null || true)
    if [ -n "$saved" ]; then break; fi
    sleep 0.2
  done
  kill "$cli" 2>/dev/null || true
  "$AGY_EXECUTABLE" models >&4
else
  shift
  "$AGY_EXECUTABLE" "$@" >&4
fi
secret-tool lookup service gemini username antigravity >&3
`

export function credential(
  raw: string,
  profile: Record<string, string>,
  modelIDs: readonly string[],
): Credential.OAuth {
  const json = raw.startsWith("go-keyring-base64:") ? Buffer.from(raw.slice(18), "base64").toString() : raw
  const saved = Schema.decodeUnknownSync(Schema.fromJsonString(Snapshot))(json)
  const expires = Date.parse(saved.token.expiry)
  if (!Number.isFinite(expires)) throw new OAuthError(true)
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: saved.token.access_token,
    refresh: saved.token.refresh_token ?? "",
    expires,
    metadata: {
      email: saved.id_token_email,
      accountID: saved.id_token_email,
      nativeKeyring: raw,
      nativeProfile: profile,
      modelIDs,
    },
  })
}

export async function start(input: {
  saved?: Credential.OAuth
  cwd: string
  args?: string[]
  prompt?: string
  login?: boolean
  executable?: string
}) {
  if (process.platform !== "linux") throw new OAuthError(false, "antigravity-native")
  const root = await mkdtemp(join(tmpdir(), "gradcode-agy-"))
  const closeRoot = () => rm(root, { recursive: true, force: true })
  const processState: { pid?: number; exited?: Promise<void>; finished?: boolean; closed: boolean } = { closed: false }
  const close = async () => {
    if (processState.closed) return
    processState.closed = true
    const nativePID = Number(await readFile(join(root, "native-pid"), "utf8").catch(() => ""))
    if (nativePID > 0) {
      try {
        process.kill(nativePID, "SIGTERM")
      } catch {
        /* already exited */
      }
    }
    if (processState.pid) {
      try {
        process.kill(-processState.pid, "SIGTERM")
      } catch {
        /* already exited */
      }
      const timer: { value?: ReturnType<typeof setTimeout> } = {}
      await Promise.race([
        processState.exited,
        new Promise<void>((resolve) => {
          timer.value = setTimeout(resolve, 1000)
        }),
      ])
      clearTimeout(timer.value)
      try {
        process.kill(-processState.pid, "SIGKILL")
      } catch {
        /* already exited */
      }
    }
    await closeRoot()
  }
  try {
    await Promise.all(
      [
        "runtime",
        "control",
        "bin",
        ".local/share",
        ".config",
        ".cache",
        ".local/state",
        ".gemini/antigravity-cli/cache",
      ].map((dir) => mkdir(join(root, dir), { recursive: true, mode: 0o700 })),
    )
    await writeFile(join(root, "bin/xdg-open"), '#!/bin/sh\nprintf "%s\\n" "$1" > "$HOME/login-url"\n', { mode: 0o700 })
    const profile = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
      input.saved?.metadata?.nativeProfile ?? {},
    )
    for (const file of files) {
      const value = profile[file]
      if (typeof value === "string")
        await writeFile(join(root, ".gemini/antigravity-cli", file), value, { mode: 0o600 })
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      XDG_DATA_HOME: join(root, ".local/share"),
      XDG_CONFIG_HOME: join(root, ".config"),
      XDG_CACHE_HOME: join(root, ".cache"),
      XDG_STATE_HOME: join(root, ".local/state"),
      XDG_RUNTIME_DIR: join(root, "runtime"),
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      TERM: "xterm-256color",
      AGY_EXECUTABLE: input.executable ?? process.env.OPENCODE_ANTIGRAVITY_CLI ?? "agy",
    }
    for (const key of [
      "DBUS_SESSION_BUS_ADDRESS",
      "GNOME_KEYRING_CONTROL",
      "SSH_AUTH_SOCK",
      "ANTIGRAVITY_GEMINI_DIR",
      "ANTIGRAVITY_APP_DATA_DIR",
      "ANTIGRAVITY_CONFIG_REL_DIR",
      "ANTIGRAVITY_CREDENTIAL_SCOPE",
      "AGY_ACCOUNT",
    ])
      delete env[key]
    const child = spawn(
      "dbus-run-session",
      ["--", "sh", "-c", script, "gradcode-agy", input.login ? "login" : "run", ...(input.args ?? [])],
      { cwd: input.cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"] },
    )
    processState.pid = child.pid
    processState.exited = new Promise((resolve) => {
      child.once("exit", () => {
        processState.finished = true
        resolve()
      })
      child.once("error", () => {
        processState.finished = true
        resolve()
      })
    })
    const output: Buffer[] = []
    const snapshot: Buffer[] = []
    const inventory: Buffer[] = []
    let selected = false
    let screen = ""
    let diagnostic = ""
    child.stdout!.on("data", (data: Buffer) => {
      // The native CLI owns PKCE and the callback. Select its Google option only after it is ready.
      if (!input.login) return
      screen = (screen + data.toString()).slice(-4096)
      if (input.login && !selected && screen.includes("Select login method")) {
        selected = true
        child.stdin!.write("\r")
      }
    })
    child.stderr!.on("data", (data: Buffer) => {
      diagnostic = (diagnostic + data.toString()).slice(-4096)
    }) // Never log raw native diagnostics.
    const secret = child.stdio[3]
    const models = child.stdio[4]
    if (secret && "on" in secret) secret.on("data", (data: Buffer) => snapshot.push(data))
    if (models && "on" in models) models.on("data", (data: Buffer) => (input.login ? inventory : output).push(data))
    child.stdin!.write(
      `${randomBytes(32).toString("hex")}\n${typeof input.saved?.metadata?.nativeKeyring === "string" ? Buffer.from(input.saved.metadata.nativeKeyring).toString("base64") : ""}\n`,
    )
    if (!input.login) child.stdin!.end(input.prompt ?? "")
    const result = new Promise<{ output: string; value: Credential.OAuth }>((resolve, reject) => {
      child.once("error", () => reject(new OAuthError(false, "antigravity-native")))
      child.once("close", async (code) => {
        try {
          if (code !== 0) {
            const auth = /Please sign in to view available models|invalid_grant|reauthentication required/i.test(
              diagnostic,
            )
            throw new OAuthError(auth, auth ? undefined : "antigravity-native")
          }
          const profile: Record<string, string> = {}
          for (const file of files) {
            const value = await readFile(join(root, ".gemini/antigravity-cli", file), "utf8").catch(() => undefined)
            if (value !== undefined) profile[file] = value
          }
          const modelIDs = inventory.length
            ? parseModels(Buffer.concat(inventory).toString())
            : Schema.decodeUnknownSync(Schema.Array(Schema.String))(input.saved?.metadata?.modelIDs ?? [])
          resolve({
            output: Buffer.concat(output).toString(),
            value: credential(Buffer.concat(snapshot).toString().trim(), profile, modelIDs),
          })
        } catch (error) {
          reject(error instanceof OAuthError ? error : new OAuthError(false, "antigravity-native"))
        }
      })
    })
    // Attach immediately: cancellation or failure can precede the UI awaiting the callback.
    result.catch(() => undefined)
    const url = async () => {
      for (;;) {
        const value = await readFile(join(root, "login-url"), "utf8").catch(() => undefined)
        if (value) {
          const parsed = new URL(value.trim())
          if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") throw new OAuthError(false)
          return parsed.toString()
        }
        if (processState.finished || processState.closed) throw new OAuthError(false, "antigravity-native")
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    const submitCode = async (value: string) => {
      const code = value.trim()
      if (!input.login || processState.closed || processState.finished || !code || /[\x00-\x20\x7f]/.test(code))
        throw new OAuthError(false)
      // Send only a single line to the private PTY; never retain or log the authorization code.
      await new Promise<void>((resolve, reject) => {
        child.stdin!.write(code + "\r", (error) => {
          if (error) reject(new OAuthError(false, "antigravity-native"))
          else resolve()
        })
      })
    }
    return { result, url, close, submitCode }
  } catch (error) {
    await close()
    throw error instanceof OAuthError ? error : new OAuthError(false, "antigravity-native")
  }
}

export function parseModels(text: string) {
  return [
    ...new Set(
      text.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*([a-zA-Z0-9][a-zA-Z0-9._:/-]*)\t[^\t]+$/)
        return match ? [match[1]!] : []
      }),
    ),
  ]
}

const locks = new Map<string, Semaphore.Semaphore>()
export function withAccount<A, E, R>(identity: string, effect: Effect.Effect<A, E, R>) {
  const lock = locks.get(identity) ?? Semaphore.makeUnsafe(1)
  locks.set(identity, lock)
  return lock.withPermit(effect)
}
