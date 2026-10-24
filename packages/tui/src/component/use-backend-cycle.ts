import { useData } from "../context/data"
import { useClient } from "../context/client"
import { useLocation } from "../context/location"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { useToast } from "../ui/toast"
import { backendOptions, nextBackend } from "../util/backend-cycle"
import { errorMessage } from "../util/error"

export function useBackendCycle() {
  const data = useData()
  const client = useClient()
  const location = useLocation()
  const local = useLocal()
  const route = useRoute()
  const toast = useToast()
  let cyclingBackend = false
  let lastBackend: string | undefined
  const cycleBackend = async () => {
    if (cyclingBackend) return
    cyclingBackend = true
    try {
      if (!local.agent.current()) throw new Error("Wait for an available agent before switching backends")
      const ref = location.ref ?? data.location.default()
      const accounts = await client.api.credential.accounts()
      const options = backendOptions({
        accounts,
        integrations: data.location.integration.list(ref) ?? [],
        providers: data.location.provider.list(ref) ?? [],
        models: data.location.model.list(ref) ?? [],
        current: local.model.current(),
        now: Date.now(),
      })
      const next = nextBackend(options, local.model.current()?.providerID, lastBackend)
      if (!next || options.length < 2) {
        toast.show({
          variant: "info",
          message: "Connect at least two available backends to cycle. Limited or unavailable accounts are skipped.",
        })
        return
      }
      if (next.credentialID) {
        await client.api.credential.activate({ credentialID: next.credentialID })
        await client.api.credential.accountUpdate({ credentialID: next.credentialID, selected: true })
        await Promise.all([
          data.location.integration.sync(ref),
          data.location.provider.sync(ref),
          data.location.model.sync(ref),
        ])
      }
      const models = data.location.model.list(ref) ?? []
      const eligible = models.filter(
        (model) =>
          model.providerID === next.providerID &&
          model.enabled &&
          model.status !== "deprecated" &&
          model.capabilities.input.includes("text"),
      )
      const model = eligible.find((model) => model.id === next.modelID) ?? eligible[0]
      if (!model) throw new Error("This connection exposes no available text model")
      local.model.set({ providerID: next.providerID, modelID: model.id }, { recent: true })
      lastBackend = next.id
      const message = `Switched backend to ${next.label} / ${model.name}`
      toast.show({ variant: "info", message })
      if (route.data.type === "session")
        await client.api.session.synthetic({
          sessionID: route.data.sessionID,
          text: "",
          description: message,
          metadata: { source: "backend-switch" },
          resume: false,
        })
    } catch (error) {
      toast.show({ variant: "error", title: "Could not switch backend", message: errorMessage(error) })
    } finally {
      cyclingBackend = false
    }
  }
  return cycleBackend
}
