import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { createClient, request } from "./auth/shared"

export default Runtime.handler(
  Commands.commands.accounts,
  Effect.fn("cli.accounts")(function* (input) {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    if (input.action === "list") {
      process.stdout.write(
        JSON.stringify(yield* request((signal) => client.credential.accounts({ signal })), null, 2) + "\n",
      )
      return
    }
    const id = Option.getOrUndefined(input.id)
    const value = Option.getOrUndefined(input.value)
    if (!id) return yield* Effect.fail(new Error("An account ID is required"))
    if (input.action === "inspect" || input.action === "logout") {
      const account = (yield* request((signal) => client.credential.accounts({ signal }))).find(
        (account) => account.id === id,
      )
      if (!account) return yield* Effect.fail(new Error("Account not found"))
      if (input.action === "inspect") {
        process.stdout.write(JSON.stringify(account, null, 2) + "\n")
        return
      }
      return yield* request((signal) =>
        client.integration.oauth.logout({ integrationID: account.integrationID, credentialID: id }, { signal }),
      )
    }
    if (input.action === "remove")
      return yield* request((signal) => client.credential.remove({ credentialID: id }, { signal }))
    if (input.action === "select" || input.action === "unselect")
      return yield* request((signal) =>
        client.credential.accountUpdate({ credentialID: id, selected: input.action === "select" }, { signal }),
      )
    if (input.action === "rename" && !value) return yield* Effect.fail(new Error("An account label is required"))
    if (input.action === "priority" && (value === undefined || !Number.isSafeInteger(Number(value))))
      return yield* Effect.fail(new Error("Priority must be an integer"))
    yield* request((signal) =>
      client.credential.accountUpdate(
        {
          credentialID: id,
          ...(input.action === "rename" ? { label: value } : {}),
          ...(input.action === "priority" ? { priority: Number(value) } : {}),
          ...(["enable", "disable"].includes(input.action) ? { enabled: input.action === "enable" } : {}),
        },
        { signal },
      ),
    )
  }),
)
