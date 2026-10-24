export * as RoutingRuntime from "./routing-runtime.js"

import path from "node:path"
import { Context, Effect, Layer, Ref, Schema, Scope, Semaphore } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { EffectFlock } from "@opencode/util/effect-flock"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "./kv.js"
import { Routing } from "@opencode/schema/routing"

export const version = "0.4.14"
export const endpoint = "http://127.0.0.1:8000/v1/systemone"

export interface Interface {
  readonly install: () => Effect.Effect<void, Error>
  readonly ensure: () => Effect.Effect<void, Error>
  readonly reset: () => Effect.Effect<void, Error>
  readonly progress: () => Effect.Effect<Routing.InstallProgress>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/RoutingRuntime") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const processes = yield* AppProcess.Service
    const fetcher = yield* FetchHttpClient.Fetch
    const kv = yield* KV.Service
    const lock = yield* EffectFlock.Service
    const scope = yield* Effect.scope
    const gate = Semaphore.makeUnsafe(1)
    const stop = yield* Ref.make<Effect.Effect<void>>(Effect.void)
    const progress = yield* Ref.make<Routing.InstallProgress>({ completed: 0, stage: "Preparing…" })
    const directory = path.join(global.data, "routing", `laya-${version}`)
    const python = path.join(directory, "bin", "python")
    const healthy = () =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetcher("http://127.0.0.1:8000/health", { signal, redirect: "error" })
          if (!response.ok) return false
          const body = Schema.decodeUnknownSync(
            Schema.Struct({ status: Schema.String, loaded: Schema.Array(Schema.String) }),
          )(await response.json())
          return body.status === "ok"
        },
        catch: () => new Error("Local Laya is not ready"),
      }).pipe(
        Effect.timeout("1 second"),
        Effect.orElseSucceed(() => false),
      )
    const run = (command: string, args: string[]) =>
      processes
        .run(
          ChildProcess.make(command, args, {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            extendEnv: true,
          }),
          { timeout: "20 minutes" },
        )
        .pipe(
          Effect.flatMap((result) =>
            result.exitCode === 0
              ? Effect.void
              : Effect.fail(
                  new Error(
                    "Local Laya installation failed. Check Python 3.10+, python3-venv, disk space, and network access.",
                  ),
                ),
          ),
          Effect.mapError(
            () =>
              new Error(
                "Local Laya installation failed. Check Python 3.10+, python3-venv, disk space, and network access.",
              ),
          ),
        )
    // The server process belongs to OpenCode's lifetime, rather than the setup HTTP request.
    const start = Effect.fn(function* () {
      if (yield* healthy()) return
      const child = yield* processes
        .spawn(
          ChildProcess.make(python, ["-m", "laya.serve"], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            extendEnv: true,
            env: {
              LAYA_HOST: "127.0.0.1",
              LAYA_PORT: "8000",
              LAYA_DEVICE: "cpu",
              LAYA_THREADS: process.env.LAYA_THREADS ?? "4",
              LAYA_PRELOAD: "1",
              LAYA_MODELS: "english",
              LAYA_DEFAULT_MODEL: "english",
              LAYA_API_KEY: "",
              LAYA_LOG_LEVEL: "error",
              LAYA_TOURNAMENT_GROUP: "64",
              HF_XET_HIGH_PERFORMANCE: process.env.HF_XET_HIGH_PERFORMANCE ?? "1",
            },
          }),
        )
        .pipe(
          Scope.provide(scope),
          Effect.mapError(() => new Error("Cannot start local Laya; run routing setup to install it.")),
        )
      const wait = Effect.gen(function* () {
        while (!(yield* healthy())) yield* Effect.sleep("1 second")
      })
      yield* Ref.set(stop, child.kill().pipe(Effect.ignore))
      yield* Effect.raceFirst(
        wait,
        child.exitCode.pipe(
          Effect.flatMap(() => Effect.fail(new Error("Local Laya exited before becoming ready."))),
          Effect.mapError(() => new Error("Local Laya exited before becoming ready.")),
        ),
      ).pipe(
        Effect.timeout("60 minutes"),
        Effect.mapError((error) =>
          error instanceof Error && error.message.includes("exited")
            ? error
            : new Error("Local Laya did not become ready within 60 minutes. Downloaded files are kept; retry setup."),
        ),
        Effect.onError(() => child.kill().pipe(Effect.ignore)),
      )
    })
    const ensure = () =>
      gate.withPermit(
        lock.withLock(
          Effect.gen(function* () {
            if (yield* kv.get("routing:laya-managed")) yield* start()
          }),
          "routing-laya-install",
        ),
      )
    return Service.of({
      progress: () => Ref.get(progress),
      reset: () =>
        gate.withPermit(
          lock.withLock(
            Effect.gen(function* () {
              yield* kv.remove("routing:laya-managed")
              const shutdown = yield* Ref.get(stop)
              yield* shutdown
              yield* Ref.set(stop, Effect.void)
            }),
            "routing-laya-install",
          ),
        ),
      ensure: () =>
        ensure().pipe(
          Effect.mapError(() => new Error("Local Laya could not be started. Run /routing to set it up again.")),
        ),
      install: () =>
        gate.withPermit(
          lock.withLock(
            Effect.gen(function* () {
              if (yield* kv.get("routing:laya-managed")) {
                yield* start()
                yield* Ref.set(progress, { completed: 4, stage: "Laya is ready" })
                return
              }
              yield* Ref.set(progress, { completed: 0, stage: "Preparing…" })
              yield* run("python3", ["-m", "venv", directory])
              yield* Ref.set(progress, { completed: 1, stage: "Installing dependencies…" })
              yield* run(python, [
                "-m",
                "pip",
                "install",
                "--index-url",
                "https://download.pytorch.org/whl/cpu",
                "torch",
              ])
              yield* Ref.set(progress, { completed: 2, stage: "Installing Laya…" })
              yield* run(python, ["-m", "pip", "install", `laya[serve]==${version}`])
              yield* Ref.set(progress, { completed: 3, stage: "Downloading and loading model…" })
              yield* start()
              yield* kv.set("routing:laya-managed", true)
              yield* Ref.set(progress, { completed: 4, stage: "Laya is ready" })
            }).pipe(
              Effect.onError(() => Ref.update(progress, (value) => ({ ...value, stage: "Installation stopped" }))),
            ),
            "routing-laya-install",
          ),
        ),
    })
  }),
)
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Global.node, AppProcess.node, KV.node, EffectFlock.node],
})
