import { AccountManagement } from "@opencode/schema/account-management"
import { Credential } from "@opencode/schema/credential"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, ServiceUnavailableError } from "../errors.js"

export const CredentialGroup = HttpApiGroup.make("server.credential")
  .add(
    HttpApiEndpoint.get("credential.accounts", "/api/credential/accounts", {
      success: Schema.Struct({ data: Schema.Array(AccountManagement.Info) }),
    }).annotateMerge(
      OpenApi.annotations({ identifier: "credential.accounts", summary: "List secret-free account status" }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("credential.accountUpdate", "/api/credential/:credentialID/account", {
      params: { credentialID: Credential.ID },
      payload: AccountManagement.Patch,
      success: HttpApiSchema.NoContent,
      error: ServiceUnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.accountUpdate",
        summary: "Rename, enable, disable, or prioritize an account",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("credential.list", "/api/credential", {
      success: Schema.Struct({ data: Schema.Array(Credential.Entry) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.list",
        summary: "List credentials",
        description: "List secret-free integration credential metadata.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("credential.create", "/api/credential", {
      payload: Credential.CreateInput,
      success: Schema.Struct({ data: Credential.Entry }),
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.create",
        summary: "Create credential",
        description:
          "Store an integration credential. It becomes the integration's active credential unless activate is false and the integration already has one. Fails with a conflict when the requested ID already exists.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("credential.update", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      payload: Schema.Struct({ label: Schema.String }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.update",
        summary: "Update credential",
        description: "Update a stored credential label.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "credential" }))
  .add(
    HttpApiEndpoint.post("credential.activate", "/api/credential/:credentialID/activate", {
      params: { credentialID: Credential.ID },
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.activate",
        summary: "Activate credential",
        description: "Activate a stored integration credential.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("credential.remove", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.remove",
        summary: "Remove credential",
        description: "Remove a stored integration credential.",
      }),
    ),
  )
