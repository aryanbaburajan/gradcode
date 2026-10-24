import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { createClient, request, location } from "./auth/shared"

export default Runtime.handler(
  Commands.commands.routing.commands.reset,
  Effect.fn("cli.routing.reset")(function* (input) {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    yield* request((signal) =>
      client.model.routingSetup({ location, payload: { type: "reset", backend: input.backend } }, { signal }),
    )
    process.stdout.write("Routing backend reset. Select Auto to configure it again.\n")
    if (input.backend !== "laya")
      process.stdout.write(
        "Environment-provided Jev keys are unchanged; unset TYPESAFE_API_KEY on the server if used.\n",
      )
    if (input.backend !== "jev")
      process.stdout.write(
        "Laya installation and model downloads are kept. Externally managed servers are unchanged.\n",
      )
  }),
)
