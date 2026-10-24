import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { expect, test } from "bun:test"
import { DialogModel } from "../src/component/dialog-model"
import { renderLocal } from "./fixture/local"
import { json } from "./fixture/tui-client"

for (const enabled of [false, true]) {
  test(`Auto is searchable and ${enabled ? "selectable with an existing backend" : "requires routing setup"}`, async () => {
    const requests: unknown[] = []
    await using setup = await renderLocal({
      fetch: async (url, request) => {
        if (url.pathname === "/api/model/routing/setup") requests.push(await request.json())
        return url.pathname === "/api/model/routing/setup"
          ? enabled
            ? new Response(null, { status: 204 })
            : json(
                {
                  _tag: "ServiceUnavailableError",
                  message: "Set up Jev or local Laya to use Auto",
                  service: "routing",
                },
                { status: 503 },
              )
          : undefined
      },
    })
    for (const width of [44, 100]) {
      setup.resize(width, 30)
      setup.dialog.replace(() => <DialogModel />)
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("Auto")
    }
    await setup.mockInput.typeText("Auto")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Auto")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) =>
      enabled ? setup.local.model.current()?.providerID === "auto" : frame.includes("Set up automatic routing"),
    )
    expect(requests).toEqual([{ type: "auto", providerID: "provider" }])
    expect(setup.local.model.current()?.providerID === "auto").toBe(enabled)
    if (!enabled) expect(setup.captureCharFrame()).toContain("Set up automatic routing")
    if (enabled) {
      setup.local.model.set({ providerID: "provider", modelID: "first" })
      expect(setup.local.model.current()?.providerID).toBe("provider")
    }
  })
}

test("repeated Auto selection releases dialog resize listeners", async () => {
  await using setup = await createAppFixture({
    fetch: (url) => (url.pathname === "/api/model/routing/setup" ? new Response(null, { status: 204 }) : undefined),
  })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  const baseline = setup.renderer.listenerCount("resize")
  for (let i = 0; i < 3; i++) {
    await setup.mockInput.typeText("/models")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) => frame.includes("Auto") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    expect(setup.renderer.listenerCount("resize")).toBeLessThanOrEqual(15)
    await setup.mockInput.typeText("Auto")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
    expect(setup.renderer.listenerCount("resize")).toBe(baseline)
  }
})
