import { expect, test } from "bun:test"
import { Credential } from "../src/credential"
import { Integration } from "../src/integration"

const login = (metadata: Record<string, unknown>, method = "browser") =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make(method),
    access: "private-access",
    refresh: "private-refresh",
    expires: 0,
    metadata,
  })

test("projects an email only from explicit OAuth identity metadata", () => {
  expect(Credential.email(login({ email: "owner@example.test" }))).toBe("owner@example.test")
  expect(Credential.email(login({ accountID: "owner@example.test" }))).toBeUndefined()
  expect(Credential.email(login({ accountID: "owner@example.test" }, "antigravity-cli"))).toBe("owner@example.test")
  expect(
    Credential.email(
      Credential.Key.make({ type: "key", key: "private-key", metadata: { email: "unverified@example.test" } }),
    ),
  ).toBeUndefined()
  for (const email of ["private-token", "owner@example.test\nsecret", "\u001b[31mowner@example.test", 42])
    expect(Credential.email(login({ email }))).toBeUndefined()
})
