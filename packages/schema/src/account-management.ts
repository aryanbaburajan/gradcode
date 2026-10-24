export * as AccountManagement from "./account-management.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { Credential } from "./credential.js"
import { IntegrationID } from "./integration-id.js"
import { optional, NonNegativeInt } from "./schema.js"

export const Health = Schema.Literals(["unknown", "healthy", "reauthenticate", "revoked", "unavailable"])
export const Quota = Schema.Struct({
  remaining: NonNegativeInt,
  unit: Schema.String,
  scope: Schema.String,
  reset: NonNegativeInt,
})
export const Policy = Schema.Struct({
  enabled: Schema.Boolean,
  priority: Schema.Int,
  health: Health,
  cooldown: NonNegativeInt.pipe(optional),
  quota: Quota.pipe(optional),
  observed: NonNegativeInt.pipe(optional),
  reason: Schema.Literals(["authentication", "quota", "rate-limit", "provider-unavailable"]).pipe(optional),
})
export interface Policy extends Schema.Schema.Type<typeof Policy> {}
export const Patch = Schema.Struct({
  selected: Schema.Boolean.pipe(optional),
  label: Schema.String.pipe(optional),
  enabled: Schema.Boolean.pipe(optional),
  priority: Schema.Int.pipe(optional),
})
export interface Patch extends Schema.Schema.Type<typeof Patch> {}
export const Info = Schema.Struct({
  id: Credential.ID,
  integrationID: IntegrationID,
  label: Schema.String,
  email: Schema.String.pipe(optional),
  method: Schema.String,
  authentication: Schema.Literals(["key", "oauth", "external"]),
  active: Schema.Boolean,
  pinned: Schema.Boolean.pipe(optional),
  status: Schema.Literals([
    "locked",
    "ready",
    "expired",
    "disabled",
    "reauthenticate",
    "revoked",
    "cooldown",
    "unavailable",
  ]).pipe(optional),
  expires: NonNegativeInt.pipe(optional),
  policy: Policy,
}).annotate({ identifier: "AccountManagement.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Cross-provider inference changes billing/data destination and is explicitly opt-in. */
export const Config = Schema.Struct({
  failover: Schema.Boolean.pipe(optional),
  providerPreference: Schema.Array(Provider.ID).pipe(optional),
  fallbacks: Schema.Array(Model.Ref).pipe(optional),
}).annotate({ identifier: "AccountManagement.Config" })
export interface Config extends Schema.Schema.Type<typeof Config> {}
