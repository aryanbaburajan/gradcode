import { useLocal } from "../context/local"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import { useClient } from "../context/client"
import { useLocation } from "../context/location"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export function DialogRouting() {
  const client = useClient()
  const location = useLocation()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const local = useLocal()
  const [mode, setMode] = createSignal<"choice" | "key" | "install">("choice")
  const [secret, setSecret] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [complete, setComplete] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const [progress, setProgress] = createSignal({ completed: 0, stage: "Preparing…" })
  const [target, setTarget] = createSignal<BoxRenderable>()
  const controller = new AbortController()
  onCleanup(() => {
    controller.abort()
    setSecret("")
  })
  createEffect(() => {
    if (!busy() || mode() !== "install") return
    const polling = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const result = await client.api.model.routingProgress({ location: location.ref }, { signal: polling.signal })
        if (!polling.signal.aborted) setProgress(result.data)
      } catch {
        // The setup request owns error reporting; temporary polling failures keep the last stage.
      }
      if (!polling.signal.aborted) timer = setTimeout(poll, 500)
    }
    void poll()
    onCleanup(() => {
      polling.abort()
      clearTimeout(timer)
    })
  })
  async function setup(type: "jev" | "laya") {
    if (complete()) return dialog.clear()
    if (busy() || (type === "jev" && !secret().trim())) return
    setFailure(undefined)
    setBusy(true)
    try {
      await client.api.model.routingSetup(
        { location: location.ref, payload: type === "jev" ? { type, key: secret() } : { type } },
        { signal: controller.signal },
      )
      setSecret("")
      await client.api.model.routingSetup(
        { location: location.ref, payload: { type: "auto" } },
        { signal: controller.signal },
      )
      local.model.set({ providerID: "auto", modelID: "auto" })
      if (type === "laya") {
        setProgress({ completed: 4, stage: "Laya is ready · Auto is on" })
        setComplete(true)
        setBusy(false)
      } else dialog.clear()
    } catch (error) {
      if (controller.signal.aborted) return
      if (type === "laya") setFailure(errorMessage(error))
      else toast.show({ variant: "error", message: errorMessage(error), duration: 10000 })
      setBusy(false)
    }
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    target,
    commands:
      mode() === "key" || mode() === "install"
        ? [
            { bind: "escape", title: "Cancel routing setup", group: "Dialog", run: () => dialog.clear() },
            {
              bind: "return",
              title: "Set up routing",
              group: "Dialog",
              run: () => setup(mode() === "key" ? "jev" : "laya"),
            },
          ]
        : [],
  }))
  return (
    <Show
      when={mode() !== "choice"}
      fallback={
        <DialogSelect
          title="Set up automatic routing"
          options={[
            {
              title: "Set up Jev API key",
              value: "jev",
              description: "Hosted routing",
              onSelect: () => setMode("key"),
            },
            {
              title: "Install and run Laya locally",
              value: "laya",
              description: "Runs locally",
              onSelect: () => setMode("install"),
            },
          ]}
        />
      }
    >
      <DialogLayout
        header={
          <DialogHeader
            title={mode() === "key" ? "Set up Jev API key" : "Install and run Laya locally"}
            onClose={() => dialog.clear()}
          />
        }
      >
        <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2}>
          <text fg={theme.text.base}>
            {mode() === "key"
              ? "Paste your API key from console.typesafe.ai."
              : "Run routing locally. The first download may take a few minutes."}
          </text>
          <Show when={(busy() || complete() || failure()) && mode() === "install"}>
            <box flexDirection="column">
              <text fg={theme.text.base}>{progress().stage}</text>
              <text fg={theme.text.base}>
                {"█".repeat(progress().completed * 5) + "░".repeat((4 - progress().completed) * 5)}{" "}
                {progress().completed}/4
              </text>
            </box>
          </Show>
          <Show when={failure()}>{(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}</Show>
          <box
            focusable
            ref={(ref) => {
              setTarget(ref)
              queueMicrotask(() => {
                if (!ref.isDestroyed) ref.focus()
              })
            }}
            onPaste={(event) => {
              event.preventDefault()
              if (!busy() && mode() === "key")
                setSecret((value) => value + new TextDecoder().decode(event.bytes).trim())
            }}
            onKeyDown={(event) => {
              if (mode() !== "key" || busy()) return
              if (event.name === "return" || event.name === "escape") return
              event.preventDefault()
              if (event.name === "backspace") return setSecret((value) => value.slice(0, -1))
              if (event.ctrl && event.name === "u") return setSecret("")
              if (
                !event.ctrl &&
                !event.meta &&
                event.sequence &&
                !event.sequence.includes("\x1b") &&
                event.sequence.length === 1
              )
                setSecret((value) => value + event.sequence)
            }}
          >
            <text fg={theme.text.formfield.focused}>
              {busy() || complete() || failure()
                ? ""
                : mode() === "key"
                  ? "•".repeat(Math.min(secret().length, 40)) || "Paste API key"
                  : "Press Enter to install and start"}
            </text>
          </box>
          <text fg={theme.text.muted}>
            {complete()
              ? "Enter to close"
              : failure()
                ? "Enter to retry · Escape to close"
                : busy()
                  ? mode() === "key"
                    ? "Saving encrypted key…"
                    : "Escape to cancel"
                  : "Enter to continue · Escape to cancel"}
          </text>
        </box>
      </DialogLayout>
    </Show>
  )
}
