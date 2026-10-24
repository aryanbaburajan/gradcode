export * as Routing from "./routing.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { optional, PositiveInt } from "./schema.js"

export const Profile = Schema.Struct({
  name: Schema.String,
  model: Model.Ref,
  reasoningEffort: Schema.String.pipe(optional),
  description: Schema.String,
  capabilities: Schema.Array(Schema.String),
  costPreference: Schema.Literals(["economy", "balanced", "quality"]),
}).annotate({ identifier: "Routing.Profile" })
export interface Profile extends Schema.Schema.Type<typeof Profile> {}

export const Backend = Schema.Struct({
  endpoint: Schema.String.pipe(optional),
  model: Schema.String.pipe(optional),
  timeoutMs: PositiveInt.pipe(optional),
  keyEnvironment: Schema.String.pipe(optional),
}).annotate({ identifier: "Routing.Backend" })
export interface Backend extends Schema.Schema.Type<typeof Backend> {}

export const Config = Schema.Struct({
  providerID: Provider.ID.pipe(optional),
  enabled: Schema.Boolean.pipe(optional),
  profiles: Schema.Array(Profile),
  jev: Backend.pipe(optional),
  laya: Backend.pipe(optional),
  requestCharacters: PositiveInt.pipe(optional),
  contextCharacters: PositiveInt.pipe(optional),
}).annotate({ identifier: "Routing.Config" })
export interface Config extends Schema.Schema.Type<typeof Config> {}

export const Request = Schema.Struct({
  request: Schema.String,
  context: Schema.String.pipe(optional),
  modalities: Schema.Array(Schema.String),
  tools: Schema.Boolean,
  contextTokens: PositiveInt,
}).annotate({ identifier: "Routing.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Decision = Schema.Struct({
  selectedModel: Model.Ref,
  reasoningEffort: Schema.String.pipe(optional),
  rationale: Schema.String,
  profile: Schema.String,
  backend: Schema.Literals(["jev", "laya"]),
}).annotate({ identifier: "Routing.Decision" })
export interface Decision extends Schema.Schema.Type<typeof Decision> {}

export const InstallProgress = Schema.Struct({
  completed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  stage: Schema.String,
}).annotate({ identifier: "Routing.InstallProgress" })
export interface InstallProgress extends Schema.Schema.Type<typeof InstallProgress> {}

export const Setup = Schema.Union([
  Schema.Struct({ type: Schema.Literal("reset"), backend: Schema.Literals(["jev", "laya", "all"]) }),
  Schema.Struct({ type: Schema.Literal("auto"), providerID: Provider.ID.pipe(optional) }),
  Schema.Struct({ type: Schema.Literal("configuration"), config: Config }),
  Schema.Struct({ type: Schema.Literal("jev"), key: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal("laya") }),
]).annotate({ identifier: "Routing.Setup" })
export type Setup = typeof Setup.Type
