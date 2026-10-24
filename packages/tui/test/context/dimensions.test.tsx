import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, For, Show, type Accessor } from "solid-js"
import { useTerminalDimensions } from "../../src/context/dimensions"

test("dimension consumers share one listener and release it across repeated mounts", async () => {
  const [mounted, setMounted] = createSignal(false)
  const readers: Accessor<{ width: number; height: number }>[] = []
  function Reader() {
    readers.push(useTerminalDimensions())
    return <box />
  }
  const setup = await testRender(
    () => (
      <Show when={mounted()}>
        <For each={Array.from({ length: 24 }, (_, i) => i)}>{() => <Reader />}</For>
      </Show>
    ),
    { width: 100, height: 30 },
  )
  try {
    const baseline = setup.renderer.listenerCount("resize")
    for (let cycle = 0; cycle < 3; cycle++) {
      readers.length = 0
      setMounted(true)
      await setup.renderOnce()
      expect(setup.renderer.listenerCount("resize")).toBe(baseline + 1)
      setup.resize(44 + cycle, 20 + cycle)
      await setup.renderOnce()
      expect(readers).toHaveLength(24)
      for (const read of readers) expect(read()).toEqual({ width: 44 + cycle, height: 20 + cycle })
      setMounted(false)
      await setup.renderOnce()
      expect(setup.renderer.listenerCount("resize")).toBe(baseline)
    }
  } finally {
    setup.renderer.destroy()
  }
})
