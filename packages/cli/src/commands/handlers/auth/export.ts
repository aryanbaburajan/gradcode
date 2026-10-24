import { Global } from "@opencode/util/global"
import { databasePath } from "../../../database-path"
import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, loadIntegrations, request, resolveIntegration } from "./shared"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(
  Commands.commands.auth.commands.export,
  Effect.fn("cli.auth.export")(
    function* (input) {
      if (input.includeSecrets) {
        if (!input.standalone || Option.isSome(input.server))
          return yield* Effect.fail(
            new Error("Secret export requires --include-secrets --standalone and cannot use --server"),
          )
        const global = yield* Global.Service
        const { Database } = yield* Effect.promise(() => import("bun:sqlite"))
        const { Vault } = yield* Effect.promise(() => import("@opencode/core/credential/vault"))
        const key = Vault.key()
        const db = new Database(databasePath(global.data), { readonly: true })
        try {
          const rows = db
            .query<
              { id: string; integration_id: string; label: string; value: string; active: number },
              []
            >("SELECT id, integration_id, label, value, active FROM credential ORDER BY active, time_created, id")
            .all()
          const target = Option.getOrUndefined(input.target)
          const credentials = rows
            .filter((row) => !target || row.integration_id === target)
            .map((row) => {
              const value = JSON.parse(row.value)
              return {
                id: row.id,
                integrationID: row.integration_id,
                label: row.label,
                active: Boolean(row.active),
                value: value.version === 1 ? Vault.open(value, key, row.id, row.integration_id) : value,
              }
            })
          process.stdout.write(JSON.stringify(credentials, null, 2) + EOL)
        } finally {
          db.close()
        }
        return
      }
      const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
      const target = Option.getOrUndefined(input.target)
      const integrationID = target ? (yield* resolveIntegration(yield* loadIntegrations(client), target)).id : undefined
      const credentials = (yield* request((signal) => client.credential.list({ signal }))).filter(
        (credential) => !integrationID || credential.integrationID === integrationID,
      )
      process.stdout.write(JSON.stringify(credentials, null, 2) + EOL)
    },
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
