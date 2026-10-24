import { AccountManagement } from "@opencode/core/account-management"
import { Credential } from "@opencode/core/credential"
import { ConflictError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.accounts",
      Effect.fn(function* () {
        const accounts = yield* AccountManagement.Service
        return { data: yield* accounts.list() }
      }),
    )
    .handle(
      "credential.accountUpdate",
      Effect.fn(function* (ctx) {
        const accounts = yield* AccountManagement.Service
        yield* accounts
          .update(ctx.params.credentialID, ctx.payload)
          .pipe(
            Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "accounts" })),
          )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.list",
      Effect.fn(function* () {
        const accounts = yield* AccountManagement.Service
        return {
          data: (yield* accounts.list()).map((account) => ({
            id: account.id,
            integrationID: account.integrationID,
            label: account.label,
            active: account.active,
            ...(account.email ? { email: account.email } : {}),
            value: {
              type: account.authentication,
              ...(account.authentication !== "key"
                ? { methodID: Credential.OAuth.fields.methodID.make(account.method) }
                : {}),
              ...(account.expires === undefined ? {} : { expires: account.expires }),
            },
          })),
        }
      }),
    )
    .handle(
      "credential.create",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        if (ctx.payload.id && (yield* credential.get(ctx.payload.id)))
          return yield* new ConflictError({
            resource: ctx.payload.id,
            message: `Credential already exists: ${ctx.payload.id}`,
          })
        const created = yield* credential.create(ctx.payload)
        const entry = entries(yield* credential.list(created.integrationID)).find((item) => item.id === created.id)
        return { data: entry ?? entries([created])[0]! }
      }),
    )
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.activate",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.activate(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)

// Credential listings order each integration's selected credential last.
function entries(credentials: Credential.Info[]) {
  const selected = new Map(credentials.map((item) => [item.integrationID, item.id]))
  return credentials.map((item) => ({
    id: item.id,
    integrationID: item.integrationID,
    label: item.label,
    active: selected.get(item.integrationID) === item.id,
    ...(Credential.email(item.value) ? { email: Credential.email(item.value) } : {}),
    value: {
      type: item.value.type,
      ...(item.value.type !== "key" ? { methodID: item.value.methodID } : {}),
      ...(item.value.type === "oauth" ? { expires: item.value.expires } : {}),
    },
  }))
}
