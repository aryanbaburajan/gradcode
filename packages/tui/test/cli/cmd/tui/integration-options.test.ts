import { describe, expect, test } from "bun:test"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import type { IntegrationInfo } from "@opencode/client"
import {
  canAskConnectionHelp,
  connectionSummary,
  connectMethods,
  credentialConnections,
  integrationOptions,
} from "../../../../src/component/dialog-integration"

const integration = (value: Partial<IntegrationInfo> & Pick<IntegrationInfo, "id" | "name">): IntegrationInfo => ({
  methods: [],
  connections: [],
  ...value,
})

describe("integrationOptions", () => {
  test("keeps popular integrations first and sorts the rest alphabetically", () => {
    expect(
      integrationOptions([
        integration({ id: "mistral", name: "Mistral" }),
        integration({ id: "antigravity", name: "Antigravity" }),
        integration({ id: "openai", name: "OpenAI" }),
        integration({ id: "custom-z", name: "Zebra" }),
        integration({ id: "anthropic", name: "Anthropic" }),
        integration({ id: "opencode", name: "OpenCode Zen" }),
        integration({ id: "opencode-go", name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual(["opencode-go", "opencode", "openai", "anthropic", "antigravity", "mistral", "custom-z"])
  })

  test("keeps MCP integrations above popular integrations without relying on their IDs", () => {
    expect(
      integrationOptions([
        integration({ id: "openai", name: "OpenAI" }),
        integration({ id: "linear", name: "Linear", metadata: { source: "mcp" } }),
        integration({ id: "github", name: "GitHub", metadata: { source: "mcp" } }),
        integration({ id: "opencode", name: "OpenCode Zen" }),
        integration({ id: "opencode-go", name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual(["github", "linear", "opencode-go", "opencode", "openai"])
  })
})

describe("connectMethods", () => {
  test("offers key and OAuth methods but not environment discovery", () => {
    expect(
      connectMethods(
        integration({
          id: "example",
          name: "Example",
          methods: [
            { type: "env", names: ["EXAMPLE_KEY"] },
            { type: "key", label: "API key" },
            { type: "oauth", id: "account", label: "Account" },
          ],
        }),
      ).map((method) => method.type),
    ).toEqual(["oauth", "key"])
  })
})

describe("credentialConnections", () => {
  test("returns removable credential connections only", () => {
    expect(
      credentialConnections(
        integration({
          id: "example",
          name: "Example",
          connections: [
            { type: "env", name: "EXAMPLE_KEY" },
            { type: "credential", method: "key", id: "cred_1", label: "Work" },
          ],
        }),
      ),
    ).toEqual([{ type: "credential", method: "key", id: "cred_1", label: "Work" }])
  })
})

describe("connectionSummary", () => {
  test("counts several connections", () => {
    expect(
      connectionSummary(
        integration({
          id: "example",
          name: "Example",
          connections: [
            { type: "credential", method: "key", id: "cred_1", label: "Work" },
            { type: "env", name: "EXAMPLE_KEY" },
          ],
        }),
      ),
    ).toBe("2 connections")
  })
})

describe("connection setup chat help", () => {
  const provider = Provider.Info.empty(Provider.ID.make("connected"))
  const model = Model.Info.default(provider.id, Model.ID.make("text"))
  const connected = integration({
    id: provider.id,
    name: "Connected",
    connections: [{ type: "env", name: "PROVIDER_KEY" }],
  })
  test("requires an enabled text model and a connection without a reported authentication failure", () => {
    expect(canAskConnectionHelp([connected], [provider], [model])).toBe(true)
    expect(canAskConnectionHelp([], [provider], [model])).toBe(false)
    expect(canAskConnectionHelp([connected], [{ ...provider, activation: "disabled" }], [model])).toBe(false)
    expect(canAskConnectionHelp([connected], [provider], [{ ...model, enabled: false }])).toBe(false)
    expect(
      canAskConnectionHelp(
        [connected],
        [provider],
        [{ ...model, capabilities: { ...model.capabilities, input: ["audio"] } }],
      ),
    ).toBe(false)
    expect(
      canAskConnectionHelp(
        [
          {
            ...connected,
            connections: [
              { type: "env", name: "PROVIDER_KEY", status: { status: "needs_auth", message: "Sign in again" } },
            ],
          },
        ],
        [provider],
        [model],
      ),
    ).toBe(false)
  })
})
