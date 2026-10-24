import type { IntegrationInfo, ModelInfo, ProviderInfo, AccountManagementInfo } from "@opencode/client"

export type Backend = {
  id: string
  providerID: string
  integrationID: string
  credentialID?: string
  modelID: string
  label: string
  active: boolean
}

/** Manual demo order is stable, independent of automatic account priority. */
export function backendOptions(input: {
  accounts: readonly AccountManagementInfo[]
  integrations: readonly IntegrationInfo[]
  providers: readonly ProviderInfo[]
  models: readonly ModelInfo[]
  current?: { providerID: string; modelID: string }
  now: number
}): Backend[] {
  return input.providers
    .flatMap((provider) => {
      if (provider.activation === "disabled") return []
      const integrationID = provider.integrationID ?? provider.id
      const accounts = input.accounts.filter((account) => account.integrationID === integrationID)
      // Manual demo cycling must not turn a shared/unknown limit into another allowance.
      if (accounts.some((account) => account.policy.reason === "rate-limit" || account.policy.reason === "quota"))
        return []
      const models = input.models.filter(
        (model) =>
          model.providerID === provider.id &&
          model.enabled &&
          model.status !== "deprecated" &&
          model.capabilities.input.includes("text"),
      )
      const model =
        models.find((model) => model.id === input.current?.modelID && provider.id === input.current.providerID) ??
        models[0]
      if (!model) return []
      if (accounts.length)
        return accounts
          .filter(
            (account) =>
              (account.status === "ready" || (account.status === "expired" && account.authentication === "oauth")) &&
              account.policy.enabled &&
              ["healthy", "unknown"].includes(account.policy.health) &&
              (account.policy.cooldown ?? 0) <= input.now &&
              (!account.policy.quota || account.policy.quota.reset <= input.now || account.policy.quota.remaining > 0),
          )
          .map((account) => ({
            id: `${provider.id}:${account.id}`,
            providerID: provider.id,
            integrationID,
            credentialID: account.id,
            modelID: model.id,
            label: `${provider.name} · ${account.label}`,
            active: accounts.some((account) => account.pinned) ? !!account.pinned : account.active,
          }))
      const integration = input.integrations.find((integration) => integration.id === integrationID)
      if (!integration?.connections.some((connection) => !connection.status) && provider.activation !== "enabled")
        return []
      return [
        {
          id: provider.id,
          providerID: provider.id,
          integrationID,
          modelID: model.id,
          label: provider.name,
          active: true,
        },
      ]
    })
    .toSorted((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id))
}

export function nextBackend(options: readonly Backend[], currentProvider?: string, previous?: string) {
  const previousIndex = options.findIndex(
    (option) => option.id === previous && option.providerID === currentProvider && option.active,
  )
  const index =
    previousIndex >= 0
      ? previousIndex
      : options.findIndex((option) => option.providerID === currentProvider && option.active)
  return options.length ? options[(index + 1) % options.length] : undefined
}
