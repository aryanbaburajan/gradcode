import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { FetchHttpClient } from "effect/http"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Global } from "@opencode/util/global"
import { RoutingRuntime } from "../src/routing-runtime"
import { KV } from "../src/kv"
import { tempGlobalLayer } from "./fixture/global"
import { it } from "./lib/effect"

for (const failure of [false, true]) {
  it.live(
    `local Laya ${failure ? "installation failure never enables management" : "requires consent, installs pinned package and reuses running server"}`,
    () =>
      Effect.gen(function* () {
        const commands: ChildProcess.Command[] = []
        const spawned: ChildProcess.Command[] = []
        const stages: number[] = []
        let snapshot: () => Effect.Effect<void> = () => Effect.void
        let running = false
        let stopped = false
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () =>
            Response.json(
              { status: running ? "ok" : "starting", loaded: running ? ["english"] : [] },
              { status: running ? 200 : 503 },
            ),
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
        const spawner = ChildProcessSpawner.make((command) =>
          Effect.gen(function* () {
            yield* snapshot()
            spawned.push(command)
            running = true
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                stopped = true
                running = false
              }),
            )
            return makeHandle({
              pid: ProcessId(1),
              exitCode: Effect.never,
              isRunning: Effect.succeed(true),
              kill: () =>
                Effect.sync(() => {
                  running = false
                }),
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            })
          }),
        )
        const processes = AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            snapshot().pipe(
              Effect.andThen(
                Effect.sync(() => {
                  commands.push(command)
                  return {
                    command: "fixture",
                    exitCode: failure ? 1 : 0,
                    stdout: Buffer.alloc(0),
                    stderr: Buffer.alloc(0),
                    stdoutTruncated: false,
                    stderrTruncated: false,
                  }
                }),
              ),
            ),
          runStream: () => Stream.empty,
        })
        const layer = LayerNode.compile(LayerNode.group([RoutingRuntime.node, KV.node, Global.node]), {
          replacements: [
            Global.node.replace(tempGlobalLayer),
            AppProcess.node.replace(Layer.succeed(AppProcess.Service, processes)),
          ],
        })
        yield* Effect.gen(function* () {
          const runtime = yield* RoutingRuntime.Service
          snapshot = () =>
            runtime.progress().pipe(
              Effect.tap((value) =>
                Effect.sync(() => {
                  stages.push(value.completed)
                }),
              ),
              Effect.asVoid,
            )
          const kv = yield* KV.Service
          yield* runtime.ensure()
          expect(commands).toHaveLength(0)
          expect(spawned).toHaveLength(0)
          if (failure) {
            const error = yield* runtime.install().pipe(Effect.flip)
            expect(error.message).toContain("installation failed")
            expect(yield* kv.get("routing:laya-managed")).toBeUndefined()
            expect(spawned).toHaveLength(0)
            expect(yield* runtime.progress()).toEqual({ completed: 0, stage: "Installation stopped" })
            return
          }
          yield* runtime.install()
          expect(stages).toEqual([0, 1, 2, 3])
          expect(yield* runtime.progress()).toEqual({ completed: 4, stage: "Laya is ready" })
          expect(yield* kv.get("routing:laya-managed")).toBe(true)
          expect(commands).toHaveLength(3)
          const global = yield* Global.Service
          const marker = path.join(global.data, "routing", `laya-${RoutingRuntime.version}`, "keep-model")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(marker), { recursive: true })
            await fs.writeFile(marker, "installed-model")
          })
          yield* runtime.reset()
          expect(running).toBe(false)
          expect(yield* kv.get("routing:laya-managed")).toBeUndefined()
          yield* runtime.ensure()
          expect(spawned).toHaveLength(1)
          expect(yield* Effect.promise(() => fs.readFile(marker, "utf8"))).toBe("installed-model")
          yield* runtime.install()
          const install = commands[2]
          expect(install?._tag === "StandardCommand" && install.args).toContain("laya[serve]==0.4.14")
          expect(spawned).toHaveLength(2)
          yield* Effect.all([runtime.ensure(), runtime.ensure()], { concurrency: "unbounded" })
          expect(spawned).toHaveLength(2)
          const command = spawned[1]
          expect(command?._tag === "StandardCommand" && command.options.env).toMatchObject({
            LAYA_HOST: "127.0.0.1",
            LAYA_PORT: "8000",
            LAYA_DEVICE: "cpu",
          })
          running = false
          yield* runtime.ensure()
          expect(spawned).toHaveLength(3)
          expect(commands).toHaveLength(6)
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(
            FetchHttpClient.Fetch,
            Object.assign((_input: string | URL | Request, init?: RequestInit) => fetch(server.url, init), {
              preconnect: fetch.preconnect,
            }),
          ),
        )
        if (!failure) expect(stopped).toBe(true)
      }),
  )
}
