export * as Credential from "./credential.js"

import { AccountManagement } from "@opencode/schema/account-management"
import { Vault } from "./credential/vault.js"
import { supportsTuningPragmas } from "#sqlite"
import { asc, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Credential } from "@opencode/schema/credential"
import { CredentialLegacy } from "@opencode/schema/credential-legacy"
import { Integration } from "@opencode/schema/integration"
import { Database } from "./database/database.js"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KVTable } from "./kv/sql.js"
import { CredentialTable } from "./credential/sql.js"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const External = Credential.External
export type External = Credential.External

export const Value = Credential.Value
export type Value = Credential.Value

/** Only explicitly stored login email is projected; arbitrary OAuth metadata stays encrypted. */
export function email(value: Value): string | undefined {
  if (value.type !== "oauth") return undefined
  const candidate =
    value.metadata?.email ?? (value.methodID === "antigravity-cli" ? value.metadata?.accountID : undefined)
  if (typeof candidate !== "string" || candidate.length > 320) return undefined
  return /^[^\s\u0000-\u001f\u007f@]+@[^\s\u0000-\u001f\u007f@]+\.[^\s\u0000-\u001f\u007f@]+$/.test(candidate)
    ? candidate
    : undefined
}

export const Event = Credential.Event

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
}) {}

export interface Interface {
  readonly locked?: boolean
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /**
   * Creates a credential for an integration and returns the new record. The new credential becomes the
   * integration's selection unless `activate` is false and the integration already has a credential.
   */
  readonly create: (input: {
    readonly id?: ID
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
    readonly activate?: boolean
  }) => Effect.Effect<Info>
  /** Selects a stored credential for its integration. */
  readonly activate: (id: ID) => Effect.Effect<void>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Credential") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    // Obtain a key before opening the migration transaction. Existing ciphertext is restart-safe.
    const rows = yield* db.select().from(CredentialTable).all().pipe(Effect.orDie)
    const plaintext = rows.filter((row) => !("version" in row.value))
    const material = (() => {
      if (!rows.length) return undefined
      try {
        return Vault.key()
      } catch {
        return undefined
      }
    })()
    const encryptionKey = () => {
      if (rows.length && !material) throw new Vault.Locked()
      return material ?? Vault.key()
    }
    if (plaintext.length && material) {
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx.select().from(CredentialTable).all()
            for (const row of current.filter((row) => !("version" in row.value))) {
              yield* tx
                .update(CredentialTable)
                .set({
                  value: Vault.seal(
                    Schema.decodeUnknownSync(CredentialLegacy.Value)(row.value),
                    encryptionKey(),
                    row.id,
                    row.integration_id ?? "",
                  ),
                })
                .where(eq(CredentialTable.id, row.id))
                .run()
            }
            yield* tx
              .insert(KVTable)
              .values({ key: "credential-vault-compaction", value: true })
              .onConflictDoUpdate({ target: KVTable.key, set: { value: true } })
              .run()
          }),
        )
        .pipe(Effect.orDie)
    }
    const pendingCompaction = yield* db
      .select()
      .from(KVTable)
      .where(eq(KVTable.key, "credential-vault-compaction"))
      .get()
      .pipe(Effect.orDie)
    if (pendingCompaction && material) {
      if (supportsTuningPragmas) {
        yield* db.run("PRAGMA wal_checkpoint(TRUNCATE)").pipe(Effect.orDie)
        yield* db.run("VACUUM").pipe(Effect.orDie)
        yield* db.run("PRAGMA wal_checkpoint(TRUNCATE)").pipe(Effect.orDie)
      }
      yield* db.delete(KVTable).where(eq(KVTable.key, "credential-vault-compaction")).run().pipe(Effect.orDie)
    }
    // Rows written before v2.1 may carry the old key credential shape.
    const decode = Schema.decodeUnknownSync(CredentialLegacy.Value)
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      encryptionKey()
      return new Info({
        id: row.id,
        integrationID: row.integration_id,
        label: row.label,
        value: decode(
          "version" in row.value ? Vault.open(row.value, encryptionKey(), row.id, row.integration_id) : row.value,
        ),
      })
    }
    const storedRows = (saved: ReadonlyArray<typeof CredentialTable.$inferSelect>) =>
      (rows.length && !material ? [] : saved).flatMap((row) => {
        const credential = stored(row)
        return credential ? [credential] : []
      })

    return Service.of({
      locked: rows.length > 0 && !material,
      all: Effect.fn("Credential.all")(() =>
        db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.active), asc(CredentialTable.time_created), asc(CredentialTable.id))
          .all()
          .pipe(Effect.orDie, Effect.map(storedRows)),
      ),
      list: Effect.fn("Credential.list")((integrationID) =>
        db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.active), asc(CredentialTable.time_created), asc(CredentialTable.id))
          .all()
          .pipe(Effect.orDie, Effect.map(storedRows)),
      ),
      get: Effect.fn("Credential.get")(function* (id) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Info({
          id: input.id ?? ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        const activated = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const current = yield* tx
                .select({ id: CredentialTable.id, active: CredentialTable.active })
                .from(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .orderBy(desc(CredentialTable.active), desc(CredentialTable.time_created), desc(CredentialTable.id))
                .get()
              const activate = input.activate !== false || !current
              if (activate)
                yield* tx
                  .update(CredentialTable)
                  .set({ active: false })
                  .where(eq(CredentialTable.integration_id, credential.integrationID))
                  .run()
              // Legacy rows have no active flag and the newest one is selected, so pin it before inserting a newer row.
              if (!activate && current && !current.active)
                yield* tx.update(CredentialTable).set({ active: true }).where(eq(CredentialTable.id, current.id)).run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: Vault.seal(credential.value, encryptionKey(), credential.id, credential.integrationID),
                  active: activate,
                })
                .run()
              return activate
            }),
          )
          .pipe(
            Effect.onError(() =>
              Effect.logError("credential create failed", {
                credentialID: credential.id,
                integrationID: credential.integrationID,
                errors: "Credential storage operation failed",
              }),
            ),
            Effect.orDie,
          )
        yield* Effect.logInfo("credential created", {
          credentialID: credential.id,
          integrationID: credential.integrationID,
          type: credential.value.type,
          active: activated,
        })
        yield* bus.publish(Event.Updated, {}, { global: true })
        if (activated)
          yield* bus.publish(
            Event.Switched,
            { integrationID: credential.integrationID, credentialID: credential.id },
            { global: true },
          )
        return credential
      }),
      activate: Effect.fn("Credential.activate")(function* (id) {
        const integrationID = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const credential = yield* tx.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get()
              if (!credential?.integration_id) return
              const active = yield* tx
                .select({ id: CredentialTable.id })
                .from(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integration_id))
                .orderBy(desc(CredentialTable.active), desc(CredentialTable.time_created), desc(CredentialTable.id))
                .get()
              if (active?.id === id) return
              yield* tx
                .update(CredentialTable)
                .set({ active: false })
                .where(eq(CredentialTable.integration_id, credential.integration_id))
                .run()
              yield* tx.update(CredentialTable).set({ active: true }).where(eq(CredentialTable.id, id)).run()
              return credential.integration_id
            }),
          )
          .pipe(
            Effect.onError(() =>
              Effect.logError("credential activate failed", {
                credentialID: id,
                errors: "Credential storage operation failed",
              }),
            ),
            Effect.orDie,
          )
        if (integrationID) {
          yield* Effect.logInfo("credential activated", { integrationID, credentialID: id })
          yield* bus.publish(Event.Switched, { integrationID, credentialID: id }, { global: true })
        }
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (updates.label === undefined && updates.value === undefined) return
        const credential = yield* db
          .select({ integrationID: CredentialTable.integration_id, label: CredentialTable.label })
          .from(CredentialTable)
          .where(eq(CredentialTable.id, id))
          .get()
          .pipe(
            Effect.onError(() =>
              Effect.logError("credential update lookup failed", {
                credentialID: id,
                errors: "Credential storage operation failed",
              }),
            ),
            Effect.orDie,
          )
        if (!credential?.integrationID) {
          yield* Effect.logWarning("credential update skipped", { credentialID: id, reason: "credential_missing" })
          return
        }
        if (updates.label === credential.label && updates.value === undefined) return
        const updated = yield* db
          .update(CredentialTable)
          .set({
            label: updates.label,
            value:
              updates.value === undefined
                ? undefined
                : Vault.seal(updates.value, encryptionKey(), id, credential.integrationID),
          })
          .where(eq(CredentialTable.id, id))
          .returning({ id: CredentialTable.id })
          .get()
          .pipe(
            Effect.onError(() =>
              Effect.logError("credential update failed", {
                credentialID: id,
                integrationID: credential.integrationID,
                errors: "Credential storage operation failed",
              }),
            ),
            Effect.orDie,
          )
        if (updated && updates.value !== undefined) {
          const policy = yield* db
            .select()
            .from(KVTable)
            .where(eq(KVTable.key, `account:${id}`))
            .get()
            .pipe(Effect.orDie)
          if (policy) {
            const current = Schema.decodeUnknownSync(AccountManagement.Policy)(policy.value)
            if (["reauthenticate", "revoked"].includes(current.health))
              yield* db
                .update(KVTable)
                .set({ value: Schema.decodeUnknownSync(Schema.Json)({ ...current, health: "unknown" }) })
                .where(eq(KVTable.key, `account:${id}`))
                .run()
                .pipe(Effect.orDie)
          }
        }
        if (!updated) {
          yield* Effect.logWarning("credential update skipped", { credentialID: id, reason: "credential_removed" })
          return
        }
        yield* Effect.logInfo("credential updated", {
          credentialID: id,
          integrationID: credential.integrationID,
          valueChanged: updates.value !== undefined,
          labelChanged: updates.label !== undefined && updates.label !== credential.label,
        })
        if (updates.value !== undefined || (updates.label !== undefined && updates.label !== credential.label))
          yield* bus.publish(Event.Updated, {}, { global: true })
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        const removed = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const credential = yield* tx.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get()
              if (!credential) return
              const active = credential.integration_id
                ? yield* tx
                    .select({ id: CredentialTable.id })
                    .from(CredentialTable)
                    .where(eq(CredentialTable.integration_id, credential.integration_id))
                    .orderBy(desc(CredentialTable.active), desc(CredentialTable.time_created), desc(CredentialTable.id))
                    .get()
                : undefined
              yield* tx.delete(CredentialTable).where(eq(CredentialTable.id, id)).run()
              yield* tx
                .delete(KVTable)
                .where(eq(KVTable.key, `account:${id}`))
                .run()
              if (credential.integration_id) {
                for (const prefix of ["account-pin", "account-limit"]) {
                  const key = `${prefix}:${credential.integration_id}`
                  const saved = yield* tx.select().from(KVTable).where(eq(KVTable.key, key)).get()
                  if (saved?.value === id) yield* tx.delete(KVTable).where(eq(KVTable.key, key)).run()
                }
              }
              if (!credential.integration_id || active?.id !== id)
                return { switched: false as const, integrationID: credential.integration_id }
              const replacement = yield* tx
                .select({ id: CredentialTable.id })
                .from(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integration_id))
                .orderBy(desc(CredentialTable.time_created), desc(CredentialTable.id))
                .get()
              if (replacement) {
                yield* tx
                  .update(CredentialTable)
                  .set({ active: false })
                  .where(eq(CredentialTable.integration_id, credential.integration_id))
                  .run()
                yield* tx
                  .update(CredentialTable)
                  .set({ active: true })
                  .where(eq(CredentialTable.id, replacement.id))
                  .run()
              }
              return {
                switched: true as const,
                integrationID: credential.integration_id,
                credentialID: replacement?.id ?? null,
              }
            }),
          )
          .pipe(
            Effect.onError(() =>
              Effect.logError("credential remove failed", {
                credentialID: id,
                errors: "Credential storage operation failed",
              }),
            ),
            Effect.orDie,
          )
        if (!removed) return
        yield* Effect.logInfo("credential removed", {
          credentialID: id,
          integrationID: removed.integrationID,
          active: removed.switched,
          ...(removed.switched ? { replacementID: removed.credentialID } : {}),
        })
        yield* bus.publish(Event.Updated, {}, { global: true })
        if (removed.switched)
          yield* bus.publish(
            Event.Switched,
            { integrationID: removed.integrationID, credentialID: removed.credentialID },
            { global: true },
          )
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Bus.node] })
