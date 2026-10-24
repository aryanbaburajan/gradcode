import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { createClient, request, location } from "./auth/shared"
import { Option } from "effect"

export default Runtime.handler(
  Commands.commands.route,
  Effect.fn("cli.route")(function* (input) {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const result = yield* request((signal) =>
      client.model.preview(
        {
          location,
          request: input.request,
          modalities: ["text"],
          tools: true,
          contextTokens: Math.max(1, input.request.length),
        },
        { signal },
      ),
    )
    process.stdout.write(JSON.stringify(result.data, null, 2) + "\n")
  }),
)
