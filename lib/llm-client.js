/**
 * The bridge from the Wiki pipeline's narrow model interface to DSH's LLM
 * service.
 *
 * `dsh-llm` exposes exactly one call method — `ctx.llm.stream(options)` — and it
 * deliberately differs from a plain "send messages, get text" API in three ways
 * that this module absorbs so the pipeline never has to know about them:
 *
 * 1. **The reply is a chunk stream that must be assembled.** Deltas arrive as
 *    `StreamChunk`s, so a `BlockAssembler` accumulates them and the text is read
 *    off the assembled blocks afterwards.
 * 2. **Failures are not thrown.** Adapter selection, dispatch and iteration
 *    failures all become one terminal `finish` chunk whose `reason.kind` is
 *    `'error'` or `'aborted'`. A caller that merely awaits the loop sees success,
 *    so `finish` is inspected here and turned into a real exception, which is the
 *    only shape the pipeline's retry logic can act on.
 * 3. **There is no per-request timeout.** A deadline is composed from the
 *    caller's signal, so an in-flight request is abandoned rather than waited
 *    out — which is what makes the documented 180-second cap meaningful.
 *
 * Route selection follows the harness's own precedence, so "use the model this
 * session is already using" is the faithful default and ZCode's promise that a
 * Wiki is generated with the workspace's chat model holds: an explicit
 * configured pair first, then the session's own logged request header, then the
 * process-wide deployment default.
 *
 * @module dsh-repo-wiki/llm-client
 */

import {
  BlockAssembler,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'

/** The error code a composed deadline uses, so a timeout is distinguishable from a provider timeout. */
export const WIKI_TIMEOUT_CODE = 'WIKI_MODEL_TIMEOUT'

/**
 * Resolve the provider/model pair one Wiki call should use.
 *
 * Precedence, strongest first: the pair chosen for this run (ZCode's dialog lets
 * a user pick a model for one generation without changing their chat settings),
 * then the plugin's configured pair, then the session's own model, then the
 * deployment default.
 *
 * @param options - the resolution inputs.
 * @param options.config - the plugin's resolved config.
 * @param [options.override] - the pair chosen for this run, when there is one.
 * @param [options.session] - the calling session, when there is one.
 * @param [options.projections] - the session-projection service, when mounted.
 * @param [options.defaultModel] - the `agentDefaultModel` service, when mounted.
 * @returns the route, or null when nothing can supply one.
 */
export function resolveRoute(options) {
  const { config, session, projections, defaultModel, override } = options
  if (override?.provider !== undefined && override?.model !== undefined) {
    return { provider: override.provider, model: override.model, source: 'run' }
  }
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model, source: 'config' }
  }

  // A pending selection is what the user just chose but has not sent yet, so it
  // is the freshest statement of intent the host has.
  if (session !== undefined && projections !== undefined) {
    try {
      const pending = projections.stateOf(session, 'modelSelection')?.pending
      if (pending?.provider !== undefined && pending?.model !== undefined) {
        return { provider: pending.provider, model: pending.model, source: 'selection' }
      }
    } catch {
      // The projection unit is registered by another package; its absence is
      // not an error, it just means this signal is unavailable.
    }
  }

  if (session !== undefined) {
    try {
      const logged = session.requestHeader?.()?.config
      if (logged?.provider !== undefined && logged?.model !== undefined && logged.model.length > 0) {
        return { provider: logged.provider, model: logged.model, reasoningEffort: logged.reasoningEffort, source: 'session' }
      }
    } catch {
      // A session without a logged request has no route; fall through.
    }
  }

  if (defaultModel !== undefined) {
    try {
      const fallback = defaultModel.currentSelection()
      if (fallback?.provider !== undefined && fallback?.model !== undefined) {
        return { provider: fallback.provider, model: fallback.model, source: 'default' }
      }
    } catch {
      // No deployment default either; the caller reports the absence.
    }
  }
  return null
}

/**
 * Convert one pipeline message into the DSH message objects a request carries.
 *
 * The pipeline speaks a deliberately small vocabulary — a user turn, an
 * assistant turn that may carry tool calls, and a batch of tool results — and
 * each maps onto a constructor that is responsible for identity, freezing, and
 * role/source tagging. Assistant text is dropped when the turn also carries tool
 * calls, because an adapter that requires tool-call-only assistant messages
 * would otherwise reject the request.
 *
 * @param message - the pipeline's message.
 * @param options - construction inputs.
 * @param options.pluginName - the producing plugin, for the user turn's source.
 * @param options.provider - the route's provider.
 * @param options.model - the route's model.
 * @returns the DSH messages, in order.
 */
export function toDshMessages(message, options) {
  if (message.role === 'user') {
    return [
      createUserMessage({
        content: [{ type: 'text', text: message.content ?? '' }],
        source: { kind: 'plugin', plugin: options.pluginName },
      }),
    ]
  }

  if (message.role === 'assistant') {
    const toolCalls = message.toolCalls ?? []
    /** @type {object[]} */
    const content = []
    if (toolCalls.length === 0 && (message.content ?? '') !== '') {
      content.push({ type: 'text', text: message.content ?? '' })
    }
    for (const call of toolCalls) {
      content.push({
        type: 'tool-call',
        id: call.id,
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
      })
    }
    if (content.length === 0) content.push({ type: 'text', text: '' })
    return [
      createAssistantMessage({
        content,
        source: { provider: options.provider, model: options.model },
      }),
    ]
  }

  if (message.role === 'tool') {
    return (message.toolResults ?? []).map((result) =>
      createToolResultMessage({
        callId: result.id,
        content: [{ type: 'text', text: result.content ?? '' }],
        isError: result.content?.startsWith('REFUSED:') === true,
      }),
    )
  }
  return []
}

/**
 * Read the text and tool calls out of an assembled reply.
 * @param assembler - the assembler that consumed the stream.
 * @returns the reply.
 */
export function readReply(assembler) {
  const blocks = assembler.blocks()
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const toolCalls = []
  for (const block of blocks) {
    if (block.type !== 'tool-call') continue
    let parsed = {}
    try {
      parsed = block.arguments === '' ? {} : JSON.parse(block.arguments)
    } catch {
      // A model that emitted malformed JSON still named a tool; passing an empty
      // argument object lets the tool reply with a corrective refusal instead of
      // failing the whole turn.
      parsed = {}
    }
    toolCalls.push({ id: block.id, name: block.name, arguments: parsed })
  }
  return { text, toolCalls }
}

/**
 * Turn a terminal finish reason into the exception the pipeline retries on.
 *
 * `'stop'`, `'tool-calls'` and `'max-tokens'` are all successful outcomes from
 * the pipeline's point of view: the first two are the documented ways a model
 * ends a turn, and a truncated reply is still a partial page worth keeping.
 * @param finish - the assembler's finish reason.
 * @param context - a label for the error message.
 * @returns an exception, or null when the turn succeeded.
 */
export function finishError(finish, context) {
  if (finish.kind === 'stop' || finish.kind === 'tool-calls' || finish.kind === 'max-tokens') return null
  const failure = finish.failure
  const error = new Error(`${context}: model request failed (${finish.kind}): ${failure?.message ?? 'no detail'}`)
  error.code = failure?.code ?? `LLM_${String(finish.kind).toUpperCase()}`
  return error
}

/**
 * Build the pipeline's model client over one DSH context.
 *
 * @param options - construction inputs.
 * @param options.ctx - a context carrying the `llm` service.
 * @param options.config - the plugin's resolved config.
 * @param options.pluginName - the producing plugin name, used for message attribution.
 * @param [options.session] - the calling session, so its model is the default route.
 * @param [options.route] - the pair chosen for this run, overriding the above.
 * @returns the model client the pipeline consumes.
 */
export function createModelClient(options) {
  const { ctx, config, pluginName, session, route: override } = options
  /** Captured lazily so the plugin loads even in a profile without these rows. */
  const projections = typeof ctx.get === 'function' ? ctx.get('sessionProjections') : undefined
  const defaultModel = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined

  return {
    // The pipeline adapts when this is false; a provider that ignores `tools`
    // simply answers in prose, and the analysis stage falls back on its own.
    supportsTools: config.exploration !== 'brief',

    /**
     * Perform one model request.
     * @param request - the pipeline's request.
     * @returns the reply's text and tool calls.
     */
    async complete(request) {
      const route = resolveRoute({ config, session, projections, defaultModel, override })
      if (route === null) {
        const error = new Error(
          `${pluginName}: no model route is available — configure \`provider\` and \`model\` in the plugin config, or open a session that has already sent a request`,
        )
        error.code = 'NO_ROUTE'
        throw error
      }

      const timeoutMs = request.timeoutMs ?? config.requestTimeoutMs
      const call = deadline(request.signal, timeoutMs, WIKI_TIMEOUT_CODE)
      try {
        /** @type {object[]} */
        const messages = []
        for (const message of request.messages) {
          for (const converted of toDshMessages(message, {
            pluginName,
            provider: route.provider,
            model: route.model,
          })) {
            messages.push(converted)
          }
        }

        /** @type {Record<string, unknown>} */
        const generateOptions = {
          provider: route.provider,
          model: route.model,
          messages,
          maxTokens: config.maxOutputTokens,
          signal: call.signal,
        }
        if (request.system !== undefined && request.system !== '') generateOptions.system = request.system
        if (request.tools !== undefined && request.tools.length > 0) {
          generateOptions.tools = request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          }))
        }
        const effort = route.reasoningEffort ?? config.reasoningEffort
        if (effort !== undefined) generateOptions.reasoningEffort = ReasoningEffortId(effort)
        if (session?.id !== undefined) generateOptions.sessionId = session.id

        const assembler = new BlockAssembler()
        for await (const chunk of ctx.llm.stream(generateOptions)) {
          // The stream itself never throws on abort, so the composed deadline is
          // the only thing that ends an overlong call.
          call.signal.throwIfAborted()
          assembler.push(chunk)
        }
        call.signal.throwIfAborted()

        const error = finishError(assembler.finish, pluginName)
        if (error !== null) {
          if (assembler.finish.kind === 'aborted') error.stopped = true
          throw error
        }
        return { ...readReply(assembler), usage: assembler.usage, route }
      } finally {
        // Clears the deadline timer; skipping this leaks one per request.
        call[Symbol.dispose]()
      }
    },
  }
}

/**
 * Enumerate the models a client can offer, for the generation dialog's model
 * picker. A provider that cannot be reached is reported rather than thrown, so
 * one bad route does not empty the list.
 *
 * @param ctx - a context carrying the `llm` service.
 * @returns `[{ provider, providerName, models: [{ id, name }] }]`.
 */
export async function listAvailableModels(ctx) {
  /** @type {{ id: string, name: string }[]} */
  let providers = []
  try {
    providers = ctx.llm.listProviders()
  } catch {
    return []
  }
  const result = []
  for (const provider of providers) {
    let models = []
    try {
      const listed = await ctx.llm.listModels(provider.id)
      models = listed.map((model) => ({ id: model.id, name: model.name ?? model.id }))
    } catch {
      models = []
    }
    result.push({ provider: provider.id, providerName: provider.name ?? provider.id, models })
  }
  return result
}
