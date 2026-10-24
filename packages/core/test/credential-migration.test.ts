import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Credential } from "../src/credential"
import { CredentialTable } from "../src/credential/sql"
import { Vault } from "../src/credential/vault"
import { Database } from "../src/database/database"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Database.node))

it.live("transactionally migrates plaintext and resumes without changing credentials", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db
      .run(sql`INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated)
    VALUES ('cred_migration', 'fixture', 'Fixture', '{"type":"key","key":"fixture-migration-secret"}', 1, 0, 0)`)
    const layer = LayerNode.compile(Credential.node, {
      replacements: [Database.node.replace(Layer.succeed(Database.Service, database))],
    })
    yield* Effect.gen(function* () {
      const credentials = yield* Credential.Service
      expect((yield* credentials.get(Credential.ID.make("cred_migration")))?.value).toEqual({
        type: "key",
        key: "fixture-migration-secret",
      })
    }).pipe(Effect.provide(layer))
    const rows = yield* database.db.select().from(CredentialTable).all()
    expect(JSON.stringify(rows)).not.toContain("fixture-migration-secret")
    expect(rows[0]?.value).toHaveProperty("algorithm", "aes-256-gcm")
    const value = rows[0]?.value
    if (!value || !("version" in value)) throw new Error("Expected ciphertext")
    expect(Vault.open(value, Vault.key(), "cred_migration", "fixture")).toEqual({
      type: "key",
      key: "fixture-migration-secret",
    })
    yield* Effect.gen(function* () {
      const credentials = yield* Credential.Service
      expect((yield* credentials.all()).length).toBe(1)
    }).pipe(Effect.provide(layer))
  }),
)
