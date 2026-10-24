import { Routing } from "@opencode/schema/routing"
import { Model } from "@opencode/schema/model"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ModelGroup = HttpApiGroup.make("server.model")
  .add(
    HttpApiEndpoint.get("model.routingProgress", "/api/model/routing/progress", {
      query: LocationQuery,
      success: Location.response(Routing.InstallProgress),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "model.routingProgress", summary: "Get Laya installation progress" }),
      ),
  )
  .add(
    HttpApiEndpoint.post("model.routingSetup", "/api/model/routing/setup", {
      query: LocationQuery,
      payload: Routing.Setup,
      success: HttpApiSchema.NoContent,
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "model.routingSetup",
          summary: "Configure Jev credentials or install and start local Laya",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("model.preview", "/api/model/preview", {
      query: LocationQuery,
      payload: Routing.Request,
      success: Location.response(Routing.Decision),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "model.preview",
          summary: "Preview automatic model routing without inference",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("model.list", "/api/model", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "model.list",
          summary: "List models",
          description:
            "Retrieve the current snapshot of available models ordered by release date. The snapshot may precede initial plugin settlement.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("model.default", "/api/model/default", {
      query: LocationQuery,
      success: Location.response(Schema.UndefinedOr(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "model.default",
          summary: "Get default model",
          description: "Retrieve the model used when a session has no explicit model selection.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "model",
      description: "Experimental model routes.",
    }),
  )
