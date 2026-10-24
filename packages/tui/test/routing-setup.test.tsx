import { expect, test } from "bun:test"
import { DialogRouting } from "../src/component/dialog-routing"
import { createAppFixture } from "./fixture/app"
import { directory } from "./fixture/tui-client"
import { renderLocal } from "./fixture/local"

for (const width of [44, 100]) {
  test(`routing setup offers both backends and masks Jev key at ${width} columns`, async () => {
    const requests: unknown[] = []
    await using setup = await renderLocal({
      fetch: async (url, request) => {
        if (url.pathname === "/api/model/routing/setup") {
          requests.push(await request.json())
          return new Response(null, { status: 204 })
        }
      },
    })
    setup.resize(width, 30)
    setup.dialog.replace(() => <DialogRouting />)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Manage routing profiles")
    expect(setup.captureCharFrame()).not.toContain("Enable automatic routing")
    expect(setup.captureCharFrame()).not.toContain("Save settings")
    expect(setup.captureCharFrame()).toContain("Set up Jev API key")
    expect(setup.captureCharFrame()).toContain("Install and run Laya locally")
    await setup.mockInput.typeText("Jev")
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    await setup.mockInput.pasteBracketedText("fixture-private-key")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("••••")
    expect(setup.captureCharFrame()).not.toContain("fixture-private-key")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(() => setup.local.model.current()?.providerID === "auto")
    expect(requests).toEqual([{ type: "jev", key: "fixture-private-key" }, { type: "auto" }])
  })
}

test("Laya installation requires explicit confirmation and cancellation makes no request", async () => {
  const requests: unknown[] = []
  await using setup = await renderLocal({
    fetch: async (url, request) => {
      if (url.pathname === "/api/model/routing/setup") {
        requests.push(await request.json())
        return new Response(null, { status: 204 })
      }
    },
  })
  setup.dialog.replace(() => <DialogRouting />)
  await setup.renderOnce()
  await setup.mockInput.typeText("Laya")
  setup.mockInput.pressEnter()
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Press Enter to install and start")
  expect(requests).toEqual([])
  setup.mockInput.pressEscape()
  await setup.renderOnce()
  expect(requests).toEqual([])
  setup.dialog.replace(() => <DialogRouting />)
  await setup.renderOnce()
  await setup.mockInput.typeText("Laya")
  setup.mockInput.pressEnter()
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => setup.local.model.current()?.providerID === "auto")
  expect(requests).toEqual([{ type: "laya" }, { type: "auto" }])
  await setup.waitForFrame((frame) => frame.includes("4/4") && frame.includes("Laya is ready"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => !frame.includes("Install and run Laya locally"))
})

test("Laya startup failures stay visible at the current stage and can be retried", async () => {
  let finish: (response: Response) => void = () => {}
  const pending = new Promise<Response>((resolve) => {
    finish = resolve
  })
  let attempts = 0
  await using setup = await renderLocal({
    fetch: async (url, request) => {
      if (url.pathname === "/api/model/routing/progress")
        return Response.json({
          location: { directory },
          data: { completed: 3, stage: "Downloading and loading model…" },
        })
      if (url.pathname === "/api/model/routing/setup") {
        const body = await request.json()
        if (body.type === "laya" && attempts++ === 0) return pending
        return new Response(null, { status: 204 })
      }
    },
  })
  setup.dialog.replace(() => <DialogRouting />)
  await setup.renderOnce()
  await setup.mockInput.typeText("Laya")
  setup.mockInput.pressEnter()
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("3/4"))
  finish(
    Response.json(
      { _tag: "ServiceUnavailableError", message: "Local Laya exited before becoming ready.", service: "routing" },
      { status: 503 },
    ),
  )
  await setup.waitForFrame((frame) => frame.includes("Local Laya exited") && frame.includes("Enter to retry"))
  expect(setup.captureCharFrame()).toContain("3/4")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("4/4") && frame.includes("Enter to close"))
  expect(attempts).toBe(2)
})

test("backend-unavailable event opens routing setup automatically", async () => {
  await using setup = await createAppFixture()
  await setup.ready
  setup.events.emit({
    id: "evt_routing_setup",
    created: 1,
    type: "tui.command.execute",
    location: { directory },
    data: { command: "routing.setup" },
  })
  await setup.waitForFrame(
    (frame) => frame.includes("Set up automatic routing") && frame.includes("Install and run Laya locally"),
  )
})

for (const width of [44, 100]) {
  test(`Laya displays installation progress and cancels polling at ${width} columns`, async () => {
    let completed = 1
    let reads = 0
    let installation: AbortSignal | undefined
    let polling: AbortSignal | undefined
    await using setup = await renderLocal({
      fetch: async (url, request) => {
        if (url.pathname === "/api/model/routing/progress") {
          reads++
          polling = request.signal
          return Response.json({
            location: { directory },
            data: { completed, stage: completed === 1 ? "Installing dependencies…" : "Installing Laya…" },
          })
        }
        if (url.pathname === "/api/model/routing/setup") {
          installation = request.signal
          return new Promise<Response>((resolve) =>
            request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 204 })), {
              once: true,
            }),
          )
        }
      },
    })
    setup.resize(width, 30)
    setup.dialog.replace(() => <DialogRouting />)
    await setup.renderOnce()
    await setup.mockInput.typeText("Laya")
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Run routing locally.")
    expect(setup.captureCharFrame()).not.toContain("PyTorch")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("1/4") && frame.includes("Installing dependencies"))
    expect(setup.captureCharFrame()).toContain("█████░░░░░░░░░░░░░░░")
    completed = 2
    // Native rendering requires real time; wait for one real polling interval.
    await Bun.sleep(550)
    await setup.waitForFrame((frame) => frame.includes("2/4") && frame.includes("Installing Laya"))
    expect(reads).toBeGreaterThanOrEqual(2)
    setup.mockInput.pressEscape()
    await setup.waitForFrame(() => installation?.aborted === true && polling?.aborted === true)
  })
}

test("repeated routing setup events do not replace or cancel an active installation", async () => {
  let installation: AbortSignal | undefined
  await using setup = await createAppFixture({
    fetch: async (url, request) => {
      if (url.pathname === "/api/model/routing/progress")
        return Response.json({
          location: { directory },
          data: { completed: 3, stage: "Downloading and loading model…" },
        })
      if (url.pathname === "/api/model/routing/setup") {
        installation = request.signal
        return new Promise<Response>((resolve) =>
          request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 204 })), { once: true }),
        )
      }
    },
  })
  await setup.ready
  function open(id: string) {
    setup.events.emit({
      id,
      created: 1,
      type: "tui.command.execute",
      location: { directory },
      data: { command: "routing.setup" },
    })
  }
  open("evt_first_setup")
  await setup.waitForFrame((frame) => frame.includes("Set up automatic routing"))
  await setup.mockInput.typeText("Laya")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Press Enter to install"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("3/4"))
  open("evt_repeated_setup")
  await Bun.sleep(550)
  await setup.renderOnce()
  expect(installation?.aborted).toBe(false)
  expect(setup.captureCharFrame()).toContain("3/4")
})
