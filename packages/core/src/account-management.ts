export * as AccountManagement from "./account-management.js"

import { Clock, Context, Effect, Layer, Schema, Semaphore } from "effect"
import { AccountManagement } from "@opencode/schema/account-management"
import { Integration } from "@opencode/schema/integration"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Credential } from "./credential.js"
import { Database } from "./database/database.js"
import { CredentialTable } from "./credential/sql.js"
import { asc } from "drizzle-orm"
import type { AIError } from "@opencode/ai"
import { KV } from "./kv.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("AccountManagement.Unavailable", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<AccountManagement.Info[]>
  readonly update: (id: Credential.ID, patch: AccountManagement.Patch) => Effect.Effect<void, Unavailable>
  readonly select: (
    integration: Integration.ID,
    pinned?: Credential.ID,
    method?: string,
    model?: string,
  ) => Effect.Effect<AccountManagement.Info, Unavailable>
  readonly failure: (id: Credential.ID, error: AIError) => Effect.Effect<boolean>
  readonly report: (id: Credential.ID, policy: AccountManagement.Policy) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/AccountManagement") {}

/** Quota only influences a pool whose observations describe the same unit, scope, and window. */
export function order(accounts: ReadonlyArray<AccountManagement.Info>, now: number, pinned?: Credential.ID) {
  const eligible = accounts.filter(
    (account) =>
      account.policy.enabled &&
      (!pinned || account.id === pinned) &&
      !["revoked", "reauthenticate", "unavailable"].includes(account.policy.health) &&
      (account.policy.cooldown ?? 0) <= now &&
      (!account.policy.quota || account.policy.quota.reset <= now || account.policy.quota.remaining > 0),
  )
  const first = eligible[0]?.policy.quota
  const comparable =
    first &&
    first.reset > now &&
    eligible.every((account) => {
      const quota = account.policy.quota
      return quota && quota.scope === first.scope && quota.unit === first.unit && quota.reset === first.reset
    })
  return eligible.toSorted(
    (a, b) =>
      b.policy.priority - a.policy.priority ||
      (comparable ? (b.policy.quota?.remaining ?? 0) - (a.policy.quota?.remaining ?? 0) : 0) ||
      Number(b.active) - Number(a.active) ||
      a.id.localeCompare(b.id),
  )
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const kv = yield* KV.Service
    const db = (yield* Database.Service).db
    const gate = Semaphore.makeUnsafe(1)
    const policy = (id: Credential.ID) =>
      kv
        .get(`account:${id}`)
        .pipe(
          Effect.map((value) =>
            value === undefined
              ? { enabled: true, priority: 0, health: "unknown" as const }
              : Schema.decodeUnknownSync(AccountManagement.Policy)(value),
          ),
        )
    const list = Effect.fn("AccountManagement.list")(function* () {
      const now = yield* Clock.currentTimeMillis
      const rows = yield* db
        .select()
        .from(CredentialTable)
        .orderBy(asc(CredentialTable.active), asc(CredentialTable.time_created), asc(CredentialTable.id))
        .all()
        .pipe(Effect.orDie)
      const selected = new Map(rows.map((row) => [row.integration_id, row.id]))
      return yield* Effect.forEach(
        rows.flatMap((row) => {
          if (!row.integration_id) return []
          const metadata = "version" in row.value ? row.value.metadata : row.value
          if (!metadata) return []
          return [{ row, metadata, integrationID: row.integration_id }]
        }),
        ({ row, metadata, integrationID }) =>
          Effect.gen(function* () {
            const current = yield* policy(row.id)
            const pin = yield* kv.get(`account-pin:${integrationID}`)
            return {
              id: row.id,
              integrationID,
              label: row.label,
              authentication: metadata.type,
              active: selected.get(integrationID) === row.id,
              method: metadata.type === "key" ? "key" : (metadata.methodID ?? "unknown"),
              ...(metadata.type === "oauth" && "expires" in metadata ? { expires: metadata.expires } : {}),
              pinned: pin === row.id,
              status: credentials.locked
                ? ("locked" as const)
                : !current.enabled
                  ? ("disabled" as const)
                  : ["reauthenticate", "revoked", "unavailable"].includes(current.health)
                    ? (current.health as "reauthenticate" | "revoked" | "unavailable")
                    : (current.cooldown ?? 0) > now
                      ? ("cooldown" as const)
                      : metadata.type === "oauth" && metadata.expires !== undefined && metadata.expires <= now
                        ? ("expired" as const)
                        : ("ready" as const),
              policy: current,
            }
          }),
      )
    })
    return Service.of({
      list,
      update: Effect.fn("AccountManagement.update")(function* (id, patch) {
        if (!(yield* list()).some((account) => account.id === id))
          return yield* new Unavailable({ message: `Account unavailable: ${id}` })
        if (patch.selected !== undefined) {
          const account = (yield* list()).find((account) => account.id === id)
          if (account) {
            if (patch.selected) yield* kv.set(`account-pin:${account.integrationID}`, id)
            else yield* kv.remove(`account-pin:${account.integrationID}`)
          }
        }
        const current = yield* policy(id)
        yield* kv.set(`account:${id}`, {
          ...current,
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
          ...(patch.priority === undefined ? {} : { priority: patch.priority }),
        })
        if (patch.label !== undefined) yield* credentials.update(id, { label: patch.label })
      }, gate.withPermit),
      select: Effect.fn("AccountManagement.select")(function* (integration, pinned, method, model) {
        if (credentials.locked)
          return yield* new Unavailable({ message: "Credential vault is locked; unlock it and restart the server" })
        const saved = yield* kv.get(`account-pin:${integration}`)
        const limit = yield* kv.get(`account-limit:${integration}`)
        const pin = pinned ?? (typeof saved === "string" ? Credential.ID.make(saved) : undefined)
        // Unknown/shared rate scopes stay on the limited account, never a fresh allowance.
        const restricted = typeof limit === "string" ? limit : undefined
        const candidates = order(
          (yield* list()).filter(
            (account) =>
              account.integrationID === integration &&
              (!restricted || account.id === restricted) &&
              (!method || account.method === method),
          ),
          yield* Clock.currentTimeMillis,
          pin,
        )
        for (const candidate of candidates) {
          const saved = model ? yield* credentials.get(candidate.id) : undefined
          const allowed = saved?.value.metadata?.modelIDs
          if (model && Array.isArray(allowed) && !allowed.includes(model)) continue
          return candidate
        }
        return yield* new Unavailable({
          message: `No eligible account for ${integration}${pinned ? ` (pinned ${pinned})` : ""}`,
        })
      }),
      failure: Effect.fn("AccountManagement.failure")(function* (id, error) {
        const account = (yield* list()).find((account) => account.id === id)
        if (!account) return false
        const now = yield* Clock.currentTimeMillis
        const next = failurePolicy(account.policy, error, now)
        if (!next) return false
        yield* kv.set(`account:${id}`, Schema.encodeSync(AccountManagement.Policy)(next))
        if (error.reason._tag === "RateLimit" || error.reason._tag === "QuotaExceeded")
          yield* kv.set(`account-limit:${account.integrationID}`, id)
        // Only an explicitly rejected authentication attempt is eligible for automatic
        // account failover. Permission, billing, policy and unknown-scope limits are not.
        if (error.reason._tag !== "Authentication" || error.reason.http?.status !== 401 || account.pinned) return false
        return order(
          (yield* list()).filter(
            (other) => other.integrationID === account.integrationID && other.method === account.method,
          ),
          now,
        ).some((other) => other.id !== id)
      }, gate.withPermit),
      report: (id, policy) => kv.set(`account:${id}`, Schema.encodeSync(AccountManagement.Policy)(policy)),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Credential.node, KV.node, Database.node] })

/** Stores only normalized state; provider bodies and tokens never enter the account read model. */
export function failurePolicy(
  policy: AccountManagement.Policy,
  error: AIError,
  now: number,
): AccountManagement.Policy | undefined {
  const reason = error.reason
  if (reason._tag === "Authentication") {
    if (reason.http?.status !== 401) return undefined
    return { ...policy, health: "reauthenticate", observed: now, reason: "authentication" }
  }
  if (reason._tag === "QuotaExceeded") return { ...policy, health: "unavailable", observed: now, reason: "quota" }
  if (reason._tag === "RateLimit")
    return {
      ...policy,
      observed: now,
      reason: "rate-limit",
      ...(reason.retryAfterMs !== undefined && Number.isFinite(reason.retryAfterMs) && reason.retryAfterMs >= 0
        ? { cooldown: Math.ceil(now + reason.retryAfterMs) }
        : {}),
    }
  return undefined
}
