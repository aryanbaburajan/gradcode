/** @jsxImportSource @opentui/solid */
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import type { FormFields, LocationRef } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogIntegration } from "../../../src/component/dialog-integration"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { PromptRefProvider, usePromptRef } from "../../../src/context/prompt"
import { emptyPrompt } from "../../../src/prompt/history"
import type { PromptRef } from "../../../src/component/prompt"
import { ToastProvider, useToast } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("renders account management with an uncategorized add row and marks the active credential", async () => {
  const fixture = await renderIntegration()

  try {
    const frame = fixture.app.captureCharFrame()
    const lines = frame.split("\n")

    expect(frame.indexOf("Add account")).toBeLessThan(frame.indexOf("Connected accounts"))
    expect(frame.indexOf("Connected accounts")).toBeLessThan(frame.indexOf("Personal"))
    expect(frame.indexOf("Personal")).toBeLessThan(frame.indexOf("Work"))
    expect(lines.find((line) => line.includes("Personal"))).toContain("\u25cf")
    expect(lines.find((line) => line.includes("Work"))).not.toContain("\u25cf")
    expect(frame).not.toContain("OPENAI_API_KEY")
    expect(frame).toContain("Login · personal@example.test")
    expect(frame).toContain("API key")
    expect(frame).not.toContain("Owner unavailable")
    expect(frame).not.toContain("Email unavailable")
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("opens the key connection prompt from the initially focused add account row", async () => {
  const fixture = await renderIntegration()

  try {
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("API key") && !frame.includes("Connected accounts"))

    expect(fixture.requests).toEqual([])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("skips hidden authentication fields and sends their defaults", async () => {
  const fixture = await renderIntegration(undefined, [
    { type: "string", key: "server", title: "Console URL", hidden: true, default: "https://example.com/console" },
    { type: "string", key: "optional", hidden: true },
  ])

  try {
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    expect(fixture.app.captureCharFrame()).not.toContain("Console URL")
    await fixture.app.mockInput.typeText("test-key")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.requests.length === 1)
    expect(fixture.requests).toEqual([
      {
        method: "POST",
        path: "/api/integration/openai/connect/key",
        body: { key: "test-key", answer: { server: "https://example.com/console" } },
      },
    ])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("switches the selected account with enter and keeps the reactive account manager open", async () => {
  const fixture = await renderIntegration()

  try {
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressEnter()

    await fixture.app.waitForFrame((frame) => {
      const line = frame.split("\n").find((entry) => entry.includes("Work"))
      return frame.includes("Connected accounts") && line?.includes("\u25cf") === true
    })

    expect(fixture.requests).toEqual([{ method: "POST", path: "/api/credential/cred_work/activate" }])
    expect(fixture.accounts.map((account) => account.id)).toEqual(["cred_work", "cred_personal"])
    const frame = fixture.app.captureCharFrame()
    expect(frame.indexOf("Personal")).toBeLessThan(frame.indexOf("Work"))
    expect(fixture.reads.integration).toBe(1)
    expect(fixture.reads.model).toBeGreaterThan(0)
    expect(fixture.reads.provider).toBeGreaterThan(0)
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("does not refetch when selecting the already-active account", async () => {
  const fixture = await renderIntegration()

  try {
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressEnter()

    expect(fixture.requests).toEqual([])
    expect(fixture.reads.model).toBe(0)
    expect(fixture.reads.provider).toBe(0)
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("renames the selected account through a prefilled prompt and reopens the account manager", async () => {
  const fixture = await renderIntegration()

  try {
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.waitFor(() => fixture.app.renderer.currentFocusedEditor instanceof TextareaRenderable)

    const textarea = fixture.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused rename prompt")
    expect(textarea.plainText).toBe("Work")

    await fixture.app.mockInput.typeText(" Account")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("Connected accounts") && frame.includes("Work Account"))

    expect(fixture.requests).toEqual([
      { method: "PATCH", path: "/api/credential/cred_work", body: { label: "Work Account" } },
    ])
    expect(fixture.accounts.find((account) => account.id === "cred_work")?.label).toBe("Work Account")
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("requires delete confirmation and preserves the account manager when another credential remains", async () => {
  const fixture = await renderIntegration()

  try {
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressKey("d", { ctrl: true })

    expect(fixture.requests).toEqual([])

    fixture.app.mockInput.pressKey("d", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("Connected accounts") && !frame.includes("Work"))

    expect(fixture.requests).toEqual([{ method: "DELETE", path: "/api/credential/cred_work" }])
    expect(fixture.accounts).toEqual([
      { type: "credential", method: "oauth", id: "cred_personal", label: "Personal", email: "personal@example.test" },
    ])
    expect(fixture.reads.model).toBe(0)
    expect(fixture.reads.provider).toBe(0)
    expect(fixture.app.captureCharFrame()).toContain("Add account")
    expect(fixture.app.captureCharFrame()).toContain("Personal")
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("renames the account label rather than its delete-confirmation message", async () => {
  const fixture = await renderIntegration()

  try {
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressKey("d", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("again to confirm"))

    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.waitFor(() => fixture.app.renderer.currentFocusedEditor instanceof TextareaRenderable)

    const textarea = fixture.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused rename prompt")
    expect(textarea.plainText).toBe("Work")
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("marks the remaining account active after deleting the active credential", async () => {
  const fixture = await renderIntegration()

  try {
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressKey("d", { ctrl: true })
    fixture.app.mockInput.pressKey("d", { ctrl: true })

    await fixture.app.waitForFrame((frame) => {
      const line = frame.split("\n").find((entry) => entry.includes("Work"))
      return !frame.includes("Personal") && line?.includes("\u25cf") === true
    })

    expect(fixture.requests).toEqual([{ method: "DELETE", path: "/api/credential/cred_personal" }])
    expect(fixture.accounts).toEqual([{ type: "credential", method: "key", id: "cred_work", label: "Work" }])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("hides account rename and delete actions while the add account row is selected", async () => {
  const fixture = await renderIntegration()

  try {
    expect(fixture.app.captureCharFrame()).not.toContain("rename")
    expect(fixture.app.captureCharFrame()).not.toContain("delete")

    fixture.app.mockInput.pressKey("r", { ctrl: true })
    fixture.app.mockInput.pressKey("d", { ctrl: true })
    fixture.app.mockInput.pressKey("d", { ctrl: true })

    expect(fixture.requests).toEqual([])
    expect(fixture.app.renderer.currentFocusedEditor).toBeInstanceOf(InputRenderable)
    expect(fixture.app.captureCharFrame()).toContain("Connected accounts")

    fixture.app.mockInput.pressArrow("down")
    await fixture.app.waitForFrame((frame) => frame.includes("rename") && frame.includes("delete"))

    fixture.app.mockInput.pressArrow("up")
    await fixture.app.waitForFrame((frame) => !frame.includes("rename") && !frame.includes("delete"))
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("uses the active location for integration data without scoping credential requests", async () => {
  const location = { directory: "/remote/project" }
  const fixture = await renderIntegration(location)

  try {
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressEnter()

    await fixture.app.waitFor(() => fixture.requests.length === 1)
    expect(fixture.locations).toContainEqual(location)
    expect(fixture.locations.at(-1)).toEqual(location)
    expect(fixture.credentialQueries).toEqual([""])
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderIntegration(activeLocation?: LocationRef, form?: FormFields, help?: { connected: boolean }) {
  const composer: PromptRef = {
    current: { ...emptyPrompt(), text: "Existing draft" },
    focused: false,
    mode: "normal",
    setMode(mode) {
      this.mode = mode
    },
    set(value) {
      this.current = value
    },
    reset() {
      this.current = emptyPrompt()
    },
    focus() {
      this.focused = true
    },
    blur() {
      this.focused = false
    },
    submit() {
      throw new Error("Must not submit automatically")
    },
  }
  const state: { toast?: ReturnType<typeof useToast> } = {}
  const events = createEventStream()
  const requests: Array<{ method: string; path: string; body?: unknown }> = []
  const locations: LocationRef[] = []
  const credentialQueries: string[] = []
  const reads = { integration: 0, model: 0, provider: 0 }
  let accounts = [
    {
      type: "credential" as const,
      method: "oauth" as const,
      id: "cred_personal",
      label: "Personal",
      email: "personal@example.test",
    },
    { type: "credential" as const, method: "key" as const, id: "cred_work", label: "Work" },
  ]

  const calls = createFetch(async (url, request) => {
    const directory =
      url.searchParams.get("location[directory]") ??
      decodeURIComponent(request.headers.get("x-opencode-directory") ?? process.cwd())
    const requestedLocation = { directory }
    const location = {
      ...requestedLocation,
      project: { id: "proj_test", directory, canonical: directory },
    }

    if (url.pathname === "/api/integration") {
      locations.push(requestedLocation)
      reads.integration++
      return json({
        location,
        data: [
          {
            id: "openai",
            name: "OpenAI",
            methods: help
              ? [{ type: "oauth", id: "google", label: "Google login" }]
              : [{ type: "key", label: "API key", form }],
            connections: help && !help.connected ? [] : [...accounts, { type: "env", name: "OPENAI_API_KEY" }],
          },
        ],
      })
    }

    if (request.method === "POST" && url.pathname === "/api/integration/openai/connect/oauth") {
      return json({ message: "Antigravity CLI failed. Install agy and retry login." }, { status: 400 })
    }
    if (request.method === "POST" && url.pathname === "/api/integration/openai/connect/key") {
      requests.push({ method: request.method, path: url.pathname, body: await request.json() })
      return new Response(null, { status: 204 })
    }

    if (url.pathname === "/api/model") {
      reads.model++
      return json({
        location,
        data: help
          ? [
              {
                id: "test-model",
                providerID: "openai",
                name: "Test",
                enabled: true,
                status: "active",
                capabilities: { input: ["text"], output: ["text"], tools: true },
              },
            ]
          : [],
      })
    }

    if (url.pathname === "/api/provider") {
      reads.provider++
      return json({
        location,
        data: help
          ? [{ id: "openai", integrationID: "openai", activation: "auto", name: "OpenAI", package: "test" }]
          : [],
      })
    }

    if (request.method === "POST" && /^\/api\/credential\/[^/]+\/activate$/.test(url.pathname)) {
      credentialQueries.push(url.search)
      const id = url.pathname.split("/")[3]
      const active = accounts.find((account) => account.id === id)
      if (!active) throw new Error(`unknown credential: ${id}`)
      accounts = [active, ...accounts.filter((account) => account.id !== id)]
      requests.push({ method: request.method, path: url.pathname })
      events.emit({
        id: `evt_switched_${id}`,
        created: Date.now(),
        type: "credential.switched",
        data: { integrationID: "openai", credentialID: id },
      })
      return new Response(null, { status: 204 })
    }

    if (request.method === "PATCH" && /^\/api\/credential\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split("/")[3]
      const body = (await request.json()) as { label: string }
      accounts = accounts.map((account) => (account.id === id ? { ...account, label: body.label } : account))
      requests.push({ method: request.method, path: url.pathname, body })
      events.emit({ id: `evt_updated_${id}`, created: Date.now(), type: "credential.updated", data: {} })
      return new Response(null, { status: 204 })
    }

    if (request.method === "DELETE" && /^\/api\/credential\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split("/")[3]
      const active = accounts[0]?.id === id
      accounts = accounts.filter((account) => account.id !== id)
      requests.push({ method: request.method, path: url.pathname })
      events.emit({ id: `evt_deleted_${id}`, created: Date.now(), type: "credential.updated", data: {} })
      if (active)
        events.emit({
          id: `evt_switched_${id}`,
          created: Date.now(),
          type: "credential.switched",
          data: { integrationID: "openai", credentialID: accounts[0]?.id ?? null },
        })
      return new Response(null, { status: 204 })
    }

    return undefined
  }, events)

  function Probe() {
    const data = useData()
    const dialog = useDialog()
    const location = useLocation()
    const prompt = usePromptRef()
    prompt.set(composer)
    state.toast = useToast()
    onMount(() => {
      location.set(activeLocation)
      void Promise.all([
        data.location.integration.sync(activeLocation),
        ...(help ? [data.location.model.sync(activeLocation), data.location.provider.sync(activeLocation)] : []),
      ]).then(() => dialog.replace(() => <DialogIntegration integrationID="openai" autoConnect />))
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <ClientProvider api={createApi(calls.fetch)}>
                <DataProvider directory={process.cwd()}>
                  <LocationProvider>
                    <ThemeProvider mode="dark" source={emptyThemeSource}>
                      <PromptRefProvider>
                        <DialogProvider>
                          <Probe />
                        </DialogProvider>
                      </PromptRefProvider>
                    </ThemeProvider>
                  </LocationProvider>
                </DataProvider>
              </ClientProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )

  app.renderer.start()
  await app.waitForFrame((frame) =>
    help && !help.connected
      ? frame.includes("Starting authorization") || state.toast?.currentToast !== null
      : frame.includes("Add account") && frame.includes("Personal") && frame.includes("Work"),
  )
  if (!help || help.connected) await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)

  return {
    app,
    composer,
    toast: () => state.toast!,
    reads,
    requests,
    locations,
    credentialQueries,
    get accounts() {
      return accounts
    },
  }
}

for (const connected of [true, false]) {
  test(`OAuth setup failure ${connected ? "offers a chat draft with a connected backend" : "keeps the error without a chat action when disconnected"}`, async () => {
    const fixture = await renderIntegration(undefined, undefined, { connected })
    try {
      if (connected) fixture.app.mockInput.pressEnter()
      await fixture.app.waitFor(() => fixture.toast().currentToast !== null)
      const toast = fixture.toast().currentToast!
      expect(toast.variant).toBe("error")
      expect(toast.action?.label).toBe(connected ? "Ask in chat" : undefined)
      if (connected) {
        fixture.toast().activate()
        expect(fixture.composer.current.text).toStartWith("Existing draft\n\n")
        expect(fixture.composer.current.text).toContain("OpenAI connection using Google login")
        expect(fixture.composer.current.text).toContain(toast.message)
        expect(fixture.composer.focused).toBe(true)
      } else expect(fixture.composer.current.text).toBe("Existing draft")
    } finally {
      fixture.app.renderer.destroy()
    }
  })
}
