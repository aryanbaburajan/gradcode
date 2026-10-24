import fs from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { withEnv } from "../../core/test/fixture/env"

it.live("Jev setup saves and replaces the encrypted key without returning secrets", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-routing-setup-")))
    const keyFile = path.join(directory.path, "vault.key")
    yield* Effect.promise(() => fs.writeFile(keyFile, randomBytes(32), { mode: 0o600 }))
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env.OPENCODE_VAULT_KEY_FILE
        process.env.OPENCODE_VAULT_KEY_FILE = keyFile
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.OPENCODE_VAULT_KEY_FILE
          else process.env.OPENCODE_VAULT_KEY_FILE = previous
        }),
    )
    const authorization: string[] = []
    const jev = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        authorization.push(request.headers.get("Authorization") ?? "")
        return Response.json({ answers: { route: { type: "choice", choice: "coding" } } })
      },
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => jev.stop(true)))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(directory.path, "opencode.json"),
        JSON.stringify({
          providers: {
            custom: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { apiKey: "fixture-provider-key" },
              models: {
                chat: { variants: [{ id: "low" }, { id: "high" }] },
                noTools: { capabilities: { tools: false } },
              },
            },
          },
          routing: {
            enabled: true,
            jev: { endpoint: `http://127.0.0.1:${jev.port}/v1/systemone` },
            profiles: [
              {
                name: "coding",
                model: { providerID: "custom", id: "chat" },
                description: "Coding",
                capabilities: ["text", "tools"],
                costPreference: "balanced",
              },
            ],
          },
        }),
      ),
    )
    const server = yield* startServer(directory.path)
    const progressURL = new URL("/api/model/routing/progress", server.base)
    progressURL.searchParams.set("location[directory]", directory.path)
    const progress = yield* Effect.promise(() => fetch(progressURL, { headers: server.headers }))
    expect(progress.status).toBe(200)
    expect(yield* Effect.promise(() => progress.json())).toMatchObject({ data: { completed: 0, stage: "Preparing…" } })
    const url = new URL("/api/model/routing/setup", server.base)
    url.searchParams.set("location[directory]", directory.path)
    for (const key of ["fixture-routing-first", "fixture-routing-rotated"]) {
      const response = yield* Effect.promise(() =>
        fetch(url, {
          method: "POST",
          headers: { ...server.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "jev", key }),
        }),
      )
      expect(response.status).toBe(204)
      expect(yield* Effect.promise(() => response.text())).toBe("")
    }
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/credential", server.base), { headers: server.headers }),
    )
    const body = yield* Effect.promise(() => response.text())
    expect(response.status).toBe(200)
    expect(body).toContain("cred_routing_jev")
    expect(body).not.toContain("fixture-routing-first")
    expect(body).not.toContain("fixture-routing-rotated")
    const previewURL = new URL("/api/model/preview", server.base)
    previewURL.searchParams.set("location[directory]", directory.path)
    const preview = yield* Effect.promise(() =>
      fetch(previewURL, {
        method: "POST",
        headers: { ...server.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ request: "Explain a variable", modalities: ["text"], tools: true, contextTokens: 10 }),
      }),
    )
    const previewBody = yield* Effect.promise(() => preview.text())
    expect(preview.status, previewBody).toBe(200)
    expect(previewBody).toContain('"backend":"jev"')
    expect(authorization).toEqual(["Bearer fixture-routing-rotated"])
    const automatic = yield* Effect.promise(() =>
      fetch(url, {
        method: "POST",
        headers: { ...server.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "auto" }),
      }),
    )
    expect(automatic.status, yield* Effect.promise(() => automatic.text())).toBe(204)
    const saved = yield* Effect.promise(() => fs.readFile(path.join(directory.path, "opencode.json"), "utf8"))
    expect(saved).toContain('"enabled": true')
    expect(saved).toContain('"name": "custom/chat/default"')
    expect(saved).toContain('"name": "custom/chat/high"')
    expect(saved).toContain('"reasoningEffort": "high"')
    expect(saved).not.toContain('"name": "custom/noTools/default"')
    expect(saved).not.toContain("fixture-routing-rotated")
    const reset = yield* Effect.promise(() =>
      fetch(url, {
        method: "POST",
        headers: { ...server.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reset", backend: "jev" }),
      }),
    )
    expect(reset.status).toBe(204)
    const remaining = yield* Effect.promise(() =>
      fetch(new URL("/api/credential", server.base), { headers: server.headers }),
    )
    expect(yield* Effect.promise(() => remaining.text())).not.toContain("cred_routing_jev")
  }),
)

it.live("routing settings preserve JSONC and other settings and reload before returning", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-routing-settings-")))
    const filepath = path.join(directory.path, "opencode.jsonc")
    yield* Effect.promise(() =>
      fs.writeFile(
        filepath,
        '{\n// Keep this comment\n"username": "Fixture",\n"shell": "/bin/bash",\n"routing": {"enabled": false, "profiles": []}\n}\n',
      ),
    )
    const server = yield* startServer(directory.path)
    const url = new URL("/api/model/routing/setup", server.base)
    url.searchParams.set("location[directory]", directory.path)
    const config = {
      enabled: true,
      profiles: [
        {
          name: "coding",
          model: { providerID: "fixture", id: "chat", variant: "high" },
          reasoningEffort: "high",
          description: "Complex coding",
          capabilities: ["text", "tools"],
          costPreference: "quality",
        },
      ],
    }
    const response = yield* Effect.promise(() =>
      fetch(url, {
        method: "POST",
        headers: { ...server.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "configuration", config }),
      }),
    )
    expect(response.status).toBe(204)
    const text = yield* Effect.promise(() => fs.readFile(filepath, "utf8"))
    expect(text).toContain("// Keep this comment")
    expect(text).toContain('"username": "Fixture"')
    expect(text).toContain('"shell": "/bin/bash"')
    const read = new URL("/api/config", server.base)
    read.searchParams.set("location[directory]", directory.path)
    const loaded = yield* Effect.promise(() =>
      fetch(read, { headers: server.headers }).then((response) => response.text()),
    )
    expect(loaded).toContain('"name":"coding"')
    expect(loaded).toContain('"enabled":true')
    const invalid = yield* Effect.promise(() =>
      fetch(url, {
        method: "POST",
        headers: { ...server.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "configuration", config: { enabled: true, profiles: [] } }),
      }),
    )
    expect(invalid.status).toBe(503)
    expect(yield* Effect.promise(() => fs.readFile(filepath, "utf8"))).toBe(text)
  }),
)

it.live("Auto detects local Laya and needs no manually configured profiles", () =>
  withEnv({ GRADCODE_FIXTURE_JEV_KEY: undefined }, () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("gradcode-auto-laya-")))
      let ready = false
      const laya = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => Response.json({ status: ready ? "ok" : "starting" }),
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => laya.stop(true)))
      const filepath = path.join(directory.path, "opencode.json")
      yield* Effect.promise(() =>
        fs.writeFile(
          filepath,
          JSON.stringify({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai-compatible",
                settings: { apiKey: "fixture-provider-key" },
                models: { chat: {} },
              },
            },
            routing: {
              profiles: [],
              jev: { keyEnvironment: "GRADCODE_FIXTURE_JEV_KEY" },
              laya: { endpoint: `http://127.0.0.1:${laya.port}/v1/systemone` },
            },
          }),
        ),
      )
      const server = yield* startServer(directory.path)
      const url = new URL("/api/model/routing/setup", server.base)
      url.searchParams.set("location[directory]", directory.path)
      const activate = () =>
        Effect.promise(() =>
          fetch(url, {
            method: "POST",
            headers: { ...server.headers, "Content-Type": "application/json" },
            body: JSON.stringify({ type: "auto" }),
          }),
        )
      const unavailable = yield* activate()
      expect(unavailable.status).toBe(503)
      expect(yield* Effect.promise(() => unavailable.text())).toContain("Set up Jev or local Laya")
      expect(yield* Effect.promise(() => fs.readFile(filepath, "utf8"))).not.toContain('"enabled": true')
      ready = true
      const enabled = yield* activate()
      expect(enabled.status, yield* Effect.promise(() => enabled.text())).toBe(204)
      const saved = yield* Effect.promise(() => fs.readFile(filepath, "utf8"))
      expect(saved).toContain('"enabled": true')
      expect(saved).toContain('"name": "custom/chat/default"')
    }),
  ),
)
