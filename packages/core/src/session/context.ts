export * as SessionContext from "./context.js"

import { Bus } from "../bus.js"
import { TuiEvent } from "@opencode/schema/tui-event"
import { KV } from "../kv.js"
import { Option, Schema } from "effect"
import { Router } from "../routing.js"
import { Model } from "../model.js"
import { Permission } from "../permission.js"
import { Context, Effect, Layer } from "effect"
import { Agent } from "../agent.js"
import { CodeModeInstructions } from "../codemode/instructions.js"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Instructions } from "../instructions/index.js"
import { InstructionBuiltIns } from "../instructions/builtins.js"
import { Location } from "../location.js"
import { McpInstructions } from "../mcp/instructions.js"
import { McpTool } from "../tool/mcp.js"
import { ReferenceInstructions } from "../reference/instructions.js"
import { SkillInstructions } from "../skill/instructions.js"
import { Tool } from "../tool.js"
import { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { InstructionEntry } from "./instruction-entry.js"
import { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

export interface Selection {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly instructions: Instructions.List
  readonly tools: Tool.Snapshot
}

export interface Loaded {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly model: SessionRunnerModel.Resolved
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly tools: Tool.Snapshot
}

/**
 * Resolves model-request state in two phases: `select` fixes the Session,
 * agent, instruction sources, and tool snapshot; `load` adds the model and
 * active history for that selection. Auxiliary operations resolve only the
 * capabilities they need; request preparation stays separate from selection.
 */
export interface Interface {
  /** Selects the Session, agent, instructions, and tools used by subsequent work. */
  readonly select: (sessionID: SessionSchema.ID) => Effect.Effect<Selection, AgentNotFoundError>
  /** Resolves the model and active history for that selection. */
  readonly load: (
    selection: Selection,
    override?: SessionRunnerModel.Resolved,
  ) => Effect.Effect<Loaded, SessionRunnerModel.Error>
  readonly resolveModel: (
    session: SessionSchema.Info,
  ) => Effect.Effect<SessionRunnerModel.Resolved, SessionRunnerModel.Error>
  /** Selects auxiliary title capabilities without instruction or tool preflight. */
  readonly selectTitle: (session: SessionSchema.Info) => Effect.Effect<
    | {
        readonly agent: Agent.Info
        readonly primary: SessionRunnerModel.Resolved | undefined
        readonly selected: SessionRunnerModel.Resolved
      }
    | undefined
  >
  readonly request: SessionModelRequest.Interface
}

/** Location-scoped model-context loader for durable Session Steps. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const builtins = yield* InstructionBuiltIns.Service
    const model = yield* Model.Service
    const db = (yield* Database.Service).db
    const discovery = yield* InstructionDiscovery.Service
    const entries = yield* InstructionEntry.Service
    const location = yield* Location.Service
    const mcpInstructions = yield* McpInstructions.Service
    const mcpTools = yield* McpTool.Service
    const models = yield* SessionRunnerModel.Service
    const router = yield* Router.Service
    const routingCache = yield* KV.Service
    const bus = yield* Bus.Service
    const request = yield* SessionModelRequest.Service
    const referenceInstructions = yield* ReferenceInstructions.Service
    const skillInstructions = yield* SkillInstructions.Service
    const store = yield* SessionStore.Service
    const registry = yield* Tool.Service

    const resolveModel = (session: SessionSchema.Info) => models.resolve(session, model.available)

    const selectTitle = Effect.fn("SessionContext.selectTitle")(function* (session: SessionSchema.Info) {
      const agent = yield* agents.get(Agent.ID.make("title"))
      if (!agent) return
      const primary = yield* resolveModel(session).pipe(Effect.orElseSucceed(() => undefined))
      const candidate = yield* Effect.gen(function* () {
        if (agent.model) {
          const info = yield* model.get(agent.model.providerID, agent.model.id)
          return info && { info, variant: agent.model.variant ?? minimalVariant(info) }
        }
        if (!primary) return
        const small = yield* model.small(primary.ref.providerID)
        if (small) return { info: small, variant: minimalVariant(small) }
        // Without a lower variant, the primary model at its selected variant is already the fallback.
        const info = yield* model.get(primary.ref.providerID, primary.ref.id)
        const variant = info && lowerVariant(info, primary.ref.variant)
        return variant && { info, variant }
      })
      const preferred =
        candidate &&
        (yield* resolveModel({
          ...session,
          model: Model.Ref.make({
            providerID: candidate.info.providerID,
            id: candidate.info.id,
            ...(candidate.variant ? { variant: candidate.variant } : {}),
          }),
        }).pipe(Effect.orElseSucceed(() => undefined)))
      const selected = preferred ?? primary
      if (!selected) return
      return { agent, primary, selected }
    })

    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt

      yield* mcpTools.flush
      const agent = yield* agents.select(session.agent)
      if (!agent.info) return yield* new AgentNotFoundError({ sessionID: session.id, agent: session.agent ?? agent.id })
      // Session permissions narrow discovery the same way they narrow the tool snapshot.
      const permissions = Permission.merge(agent.info.permissions, session.permissions ?? [])
      const loaded = yield* Effect.all(
        {
          tools: registry.snapshot(permissions),
          builtins: builtins.load(),
          discovery: discovery.load(),
          skills: skillInstructions.load(permissions),
          references: referenceInstructions.load(),
          mcp: mcpInstructions.load(permissions),
          entries: entries.load(sessionID),
        },
        { concurrency: "unbounded" },
      )
      return {
        session,
        agent: { ...agent, info: agent.info },
        // Ordered from most to least shared across sessions so the baseline stays a reusable
        // prompt-cache prefix: user-level catalog and guidance, then project instructions, then
        // the date and environment, which vary by day and directory.
        instructions: Instructions.combine([
          CodeModeInstructions.make(loaded.tools.codeModeCatalog),
          loaded.mcp,
          loaded.references,
          loaded.skills,
          loaded.discovery,
          loaded.builtins,
          loaded.entries,
        ]),
        tools: loaded.tools,
      }
    })

    const load = Effect.fn("SessionContext.load")(function* (
      selection: Selection,
      override?: SessionRunnerModel.Resolved,
    ) {
      const routing = yield* router.configuration()
      const automatic = selection.session.model?.providerID === "auto" && selection.session.model.id === "auto"
      if (automatic && (!routing?.enabled || !routing.profiles.length))
        return yield* new SessionRunnerModel.ModelNotSelectedError({
          sessionID: selection.session.id,
          reason: "Automatic routing requires enabled, configured profiles",
        })
      const messages =
        automatic && routing?.enabled && routing.profiles.length
          ? yield* store.context(selection.session.id).pipe(Effect.orDie)
          : []
      const user = messages.findLast((message) => message.type === "user")
      const cached = Schema.decodeUnknownOption(Schema.Struct({ requestID: SessionMessage.ID, model: Model.Ref }))(
        yield* routingCache.get(`routing:${selection.session.id}`),
      ).pipe(Option.getOrUndefined)
      const ref =
        user && routing
          ? cached?.requestID === user.id
            ? cached.model
            : (yield* router
                .preview({
                  config: routing,
                  request: {
                    request: user.text,
                    modalities: [
                      "text",
                      ...new Set(
                        (user.files ?? []).map((file) =>
                          file.mime.startsWith("image/")
                            ? "image"
                            : file.mime === "application/pdf"
                              ? "pdf"
                              : file.mime.split("/")[0],
                        ),
                      ),
                    ],
                    tools: selection.tools.definitions.length > 0,
                    // Conservative admission bound includes attachment bytes, without disclosing them to the router.
                    contextTokens: Math.max(1, JSON.stringify(messages).length),
                  },
                  available: yield* model.available(),
                })
                .pipe(
                  Effect.tapError((error) =>
                    error.setupRequired
                      ? bus.publish(TuiEvent.CommandExecute, { command: "routing.setup" })
                      : Effect.void,
                  ),
                  Effect.mapError(
                    (error) =>
                      new SessionRunnerModel.ModelNotSelectedError({
                        sessionID: selection.session.id,
                        reason: error.message,
                      }),
                  ),
                  Effect.tap(
                    Effect.fn(function* (decision) {
                      const previous = cached?.model
                      const changed =
                        previous &&
                        (previous.providerID !== decision.selectedModel.providerID ||
                          previous.id !== decision.selectedModel.id ||
                          previous.variant !== decision.selectedModel.variant)
                      const message = Router.notice(
                        decision,
                        changed ? "Switched to" : previous ? "Keeping" : "Selected",
                      )
                      // Log the validated selection only, never prompt text or backend responses.
                      yield* Effect.logInfo(message).pipe(
                        Effect.annotateLogs({ sessionID: selection.session.id, requestID: user.id }),
                      )
                      yield* bus.publish(TuiEvent.ToastShow, {
                        title: `Auto routing · ${selection.session.id}`,
                        message,
                        variant: "info",
                        duration: 8000,
                      })
                    }),
                  ),
                )).selectedModel
          : undefined
      if (ref && user)
        yield* routingCache.set(`routing:${selection.session.id}`, { requestID: user.id, model: { ...ref } })
      const selected = override ?? (yield* resolveModel(ref ? { ...selection.session, model: ref } : selection.session))
      const history = yield* SessionHistory.entriesForRunner(
        db,
        selection.session.id,
        selection.instructions,
        selected.ref,
      )
      return {
        session: selection.session,
        agent: selection.agent,
        model: selected,
        initial: history.initial,
        messages: history.entries.map((entry) => entry.message),
        tools: selection.tools,
      }
    })

    return Service.of({ select, load, resolveModel, selectTitle, request })
  }),
)

/** Variant IDs that minimize reasoning output, in preference order. */
const MINIMAL_REASONING_VARIANTS = ["none", "minimal", "low"].map((id) => Model.VariantID.make(id))

const minimalVariant = (info: Model.Info) =>
  MINIMAL_REASONING_VARIANTS.find((id) => info.variants.some((item) => item.id === id))

/**
 * `none` and `minimal` always reduce reasoning. `low` can enable reasoning on a model whose default
 * does not reason, so it is only used when it ranks below the variant the session selected.
 */
const lowerVariant = (info: Model.Info, selected: Model.VariantID | undefined) => {
  const rank = (id: Model.VariantID | undefined) => info.variants.findIndex((item) => item.id === id)
  return MINIMAL_REASONING_VARIANTS.find((id) => rank(id) !== -1 && (id !== "low" || rank(id) < rank(selected)))
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Agent.node,
    Model.node,
    Database.node,
    InstructionBuiltIns.node,
    InstructionDiscovery.node,
    InstructionEntry.node,
    Location.node,
    McpInstructions.node,
    McpTool.node,
    ReferenceInstructions.node,
    SessionRunnerModel.node,
    Router.node,
    Bus.node,
    KV.node,
    SessionModelRequest.node,
    SessionStore.node,
    SkillInstructions.node,
    Tool.node,
  ],
})
