import { createResource } from "solid-js"
import { useClient } from "../context/client"
import { DialogSelect } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { DialogIntegration, beginOAuth } from "./dialog-integration"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export function DialogAccounts() {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const data = useData()
  const currentLocation = useLocation()
  const location = currentLocation.ref ?? data.location.default()
  const [accounts, actions] = createResource(() => client.api.credential.accounts())
  const perform = async (operation: () => Promise<unknown>) => {
    try {
      await operation()
      await actions.refetch()
      dialog.replace(() => <DialogAccounts />)
    } catch (error) {
      toast.show({ title: "Account unavailable", message: errorMessage(error), variant: "error" })
    }
  }
  return (
    <DialogSelect
      title={
        accounts.error
          ? "Accounts unavailable · vault may be locked"
          : accounts.loading
            ? "Loading accounts"
            : "Provider accounts"
      }
      options={[
        { title: "Add account", value: "add", onSelect: () => dialog.replace(() => <DialogIntegration />) },
        ...(accounts() ?? []).map((account) => ({
          title: account.label,
          value: account.id,
          description: `${account.integrationID} · ${account.method} · ${account.status ?? account.policy.health} · priority ${account.policy.priority}${account.pinned ? " · pinned" : ""} · quota ${account.policy.quota?.remaining ?? "unknown"}`,
          onSelect: () =>
            dialog.replace(() => (
              <DialogSelect
                title={account.label}
                options={[
                  ...(account.authentication === "oauth"
                    ? [
                        {
                          title: "Reauthenticate",
                          value: "reauthenticate",
                          onSelect: () => {
                            const integration = data.location.integration
                              .list(location)
                              ?.find((item) => item.id === account.integrationID)
                            const method = integration?.methods.find(
                              (item) => item.type === "oauth" && item.id === account.method,
                            )
                            if (integration && method?.type === "oauth")
                              void beginOAuth(integration, method, location, dialog, undefined, account.id)
                          },
                        },
                      ]
                    : []),
                  ...(account.authentication === "oauth"
                    ? [
                        {
                          title: "Sign out session",
                          value: "logout",
                          onSelect: () =>
                            perform(() =>
                              client.api.integration.oauth.logout({
                                integrationID: account.integrationID,
                                credentialID: account.id,
                              }),
                            ),
                        },
                      ]
                    : []),
                  {
                    title: `Expires: ${account.expires ? new Date(account.expires).toISOString() : "unknown"}`,
                    value: "expiry",
                  },
                  {
                    title: account.pinned ? "Use automatic selection" : "Pin account",
                    value: "select",
                    onSelect: () =>
                      perform(() =>
                        client.api.credential.accountUpdate({ credentialID: account.id, selected: !account.pinned }),
                      ),
                  },
                  {
                    title: account.policy.enabled ? "Disable" : "Enable",
                    value: "enabled",
                    onSelect: () =>
                      perform(() =>
                        client.api.credential.accountUpdate({
                          credentialID: account.id,
                          enabled: !account.policy.enabled,
                        }),
                      ),
                  },
                  {
                    title: "Rename",
                    value: "rename",
                    onSelect: () =>
                      dialog.replace(() => (
                        <DialogPrompt
                          title="Account label"
                          placeholder={account.label}
                          onConfirm={(label) =>
                            perform(() => client.api.credential.accountUpdate({ credentialID: account.id, label }))
                          }
                        />
                      )),
                  },
                  {
                    title: `Increase priority (${account.policy.priority})`,
                    value: "priority",
                    onSelect: () =>
                      perform(() =>
                        client.api.credential.accountUpdate({
                          credentialID: account.id,
                          priority: account.policy.priority + 1,
                        }),
                      ),
                  },
                  {
                    title: `Decrease priority (${account.policy.priority})`,
                    value: "decrease",
                    onSelect: () =>
                      perform(() =>
                        client.api.credential.accountUpdate({
                          credentialID: account.id,
                          priority: account.policy.priority - 1,
                        }),
                      ),
                  },
                  {
                    title: "Remove account",
                    value: "remove",
                    onSelect: () => perform(() => client.api.credential.remove({ credentialID: account.id })),
                  },
                ]}
              />
            )),
        })),
      ]}
    />
  )
}
