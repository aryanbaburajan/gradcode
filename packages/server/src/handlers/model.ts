import { Router } from "@opencode/core/routing"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Model } from "@opencode/core/model"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "model.routingProgress",
        Effect.fn(function* () {
          const router = yield* Router.Service
          return yield* response(router.progress())
        }),
      )
      .handle(
        "model.routingSetup",
        Effect.fn(function* (ctx) {
          if (ctx.payload.type === "auto") yield* awaitPlugins
          const router = yield* Router.Service
          yield* router
            .setup(ctx.payload)
            .pipe(
              Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "routing" })),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "model.preview",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const router = yield* Router.Service
          const models = yield* Model.Service
          const config = yield* router.configuration()
          if (!config?.profiles.length)
            return yield* new ServiceUnavailableError({
              message: "Select Auto once to discover available models before preview",
              service: "routing",
            })
          return yield* response(
            router
              .preview({
                config,
                request: ctx.payload,
                available: yield* models.available(),
              })
              .pipe(
                Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "routing" })),
              ),
          )
        }),
      )
      .handle(
        "model.list",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.available())
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.default())
        }),
      )
  }),
)
