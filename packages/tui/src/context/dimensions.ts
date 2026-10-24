import type { CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, type Accessor } from "solid-js"

interface Dimensions {
  width: number
  height: number
}

// Each mounted consumer shares one renderer subscription. The last consumer
// releases it, including when dialogs or entire renderer trees are disposed.
const subscriptions = new WeakMap<
  CliRenderer,
  {
    readonly dimensions: Accessor<Dimensions>
    readonly resize: (width: number, height: number) => void
    users: number
  }
>()

export function useTerminalDimensions(): Accessor<Dimensions> {
  const renderer = useRenderer()
  const subscription =
    subscriptions.get(renderer) ??
    (() => {
      const [dimensions, setDimensions] = createSignal({ width: renderer.width, height: renderer.height })
      const resize = (width: number, height: number) => setDimensions({ width, height })
      const entry = { dimensions, resize, users: 0 }
      subscriptions.set(renderer, entry)
      renderer.on("resize", resize)
      return entry
    })()
  subscription.users++
  onCleanup(() => {
    subscription.users--
    if (subscription.users) return
    renderer.off("resize", subscription.resize)
    subscriptions.delete(renderer)
  })
  return subscription.dimensions
}
