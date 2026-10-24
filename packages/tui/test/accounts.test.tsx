import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

for (const width of [45, 100]) {
  test(`account management displays unknown quota and account actions at ${width} columns`, async () => {
    const changes: unknown[] = []
    await using setup = await createAppFixture({
      width,
      fetch: async (url, request) => {
        if (url.pathname === "/api/credential/accounts")
          return json({
            data: [
              {
                id: "cred_fixture",
                integrationID: "fixture",
                label: "Work",
                method: "key",
                authentication: "key",
                active: true,
                policy: { enabled: true, priority: 0, health: "unknown" },
              },
            ],
          })
        if (url.pathname === "/api/credential/cred_fixture/account") {
          changes.push(await request.json())
          return new Response(null, { status: 204 })
        }
      },
    })
    await setup.ready
    await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
    await setup.mockInput.typeText("/accounts")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Provider accounts") &&
        frame.includes("Work") &&
        setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await setup.mockInput.typeText("Work")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) => frame.includes("Disable") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await setup.mockInput.typeText("Disable")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Provider accounts"))
    expect(changes).toEqual([{ enabled: false }])
  })
}

test("account management keeps add-account available for an empty vault", async () => {
  await using setup = await createAppFixture({
    fetch: (url) => (url.pathname === "/api/credential/accounts" ? json({ data: [] }) : undefined),
  })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  await setup.mockInput.typeText("/accounts")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Provider accounts") && frame.includes("Add account"))
  expect(setup.renderer.isDestroyed).toBe(false)
})
