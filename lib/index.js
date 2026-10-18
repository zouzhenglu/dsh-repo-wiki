/**
 * Repo Wiki for DeepSeek Harness — the host half.
 *
 * A dual-face plugin: this module is the Node side (the Wiki service, the
 * per-workspace store, the `repo_wiki` tool, the `/repo-wiki` commands, and the
 * authenticated `/api/repoWiki.*` routes), and `lib/client.js` is the browser
 * side (the "仓库 Wiki" tab type in the right Sidebar). One cordis row mounts
 * both, which is the same shape the shipped `dsh-client-ui-deliverables` uses.
 *
 * The feature imitates ZCode's repository Wiki: read a codebase once, keep a
 * source-cited architecture guide outside the repository, one per workspace,
 * generate it in four reported stages, and refresh it only when the code
 * actually changed. The behaviour lives in `lib/wiki/*`, which knows nothing
 * about cordis; this file is the adapter that gives it a context, a model, a
 * surface and a lifetime.
 *
 * ## Why every optional service is reached through `ctx.inject` or `ctx.get`
 *
 * A cordis `inject` list is a hard gate: the plugin does not load until every
 * named service exists. `llm` and `tools` are genuinely required — without them
 * there is no model and no tool registry — but `connection`, `commands` and
 * `sessions` exist only on some surfaces (a headless run has no webserver, no
 * command surface, and may have no sessions). Naming them in `inject` would make
 * the Wiki vanish from those profiles instead of degrading to the surfaces it
 * does have, so they are attached with `ctx.inject([...], …)`, which mounts the
 * callback when the service appears and disposes it when it goes away.
 *
 * @module dsh-repo-wiki
 */

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { basename, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import * as nodeFs from 'node:fs/promises'

import { WikiService } from './wiki/service.js'
import { WikiStore } from './wiki/store.js'
import { createNodeFsAdapter, WorkspaceReader } from './wiki/workspace.js'
import { hashString } from './wiki/workspace.js'
import { createModelClient, listAvailableModels } from './llm-client.js'
import { readGitState } from './wiki/git.js'

/** The plugin's name, used for log lines, message attribution, and route labels. */
export const name = 'repo-wiki'

/**
 * The services this plugin cannot work without. `llm` supplies the model and
 * `tools` receives the model-facing tool; everything else is optional and
 * attached lazily.
 */
export const inject = ['llm', 'tools']

/** The authenticated Fetch routes this plugin owns, all below `/api`. */
export const ROUTES = Object.freeze({
  state: '/api/repoWiki.state',
  generate: '/api/repoWiki.generate',
  stop: '/api/repoWiki.stop',
  read: '/api/repoWiki.read',
  remove: '/api/repoWiki.remove',
  refresh: '/api/repoWiki.refresh',
  models: '/api/repoWiki.models',
  regeneratePage: '/api/repoWiki.regeneratePage',
  restore: '/api/repoWiki.restore',
})

/** The largest request body a route will read, in bytes. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * The plugin configuration.
 *
 * Every field has a default, so the row in `cordis.patch.yml` can shrink to
 * `- id: repo-wiki` / `name: dsh-repo-wiki` and still behave as documented.
 */
export const Config = z.object({
  /** Wiki language when a caller names none. */
  language: z.union([z.const('zh-CN'), z.const('en')]).default('zh-CN'),
  /** Per-request model timeout. ZCode fixes 180000 and refuses to configure it. */
  requestTimeoutMs: z.number().min(1000).default(180000),
  /** Output cap per model request; a page needs room, a catalog does not need much. */
  maxOutputTokens: z.number().min(256).default(8192),
  /** Page-generation retries after the first failure; ZCode's default is 0. */
  retries: z.number().min(0).max(8).default(0),
  /** Whether the prompts may ask for Mermaid diagrams. */
  diagrams: z.boolean().default(true),
  /**
   * How the analysis stage learns the repository.
   * `tools` lets the model drive `list_directory`/`read_file`; `brief` sends one
   * prepared brief instead, for endpoints that cannot call tools.
   */
  exploration: z.union([z.const('tools'), z.const('brief')]).default('tools'),
  /** Explicit model route; without both halves the calling session's model is used. */
  provider: z.string(),
  model: z.string(),
  /** Optional adapter-owned reasoning effort. */
  reasoningEffort: z.string(),
  /**
   * Refresh a Wiki at the end of a turn when the code changed. ZCode does this
   * automatically; set false to make every refresh an explicit action.
   */
  autoRefresh: z.boolean().default(true),
  /** Whether `status` fingerprints the workspace to report staleness. */
  checkStale: z.boolean().default(true),
  /**
   * How many days a previous version stays restorable. Versions older than this
   * are swept automatically; the default keeps the last three days of runs.
   */
  historyRetentionDays: z.number().min(1).max(30).default(3),
  /** How many previous versions one workspace keeps at most. */
  historyMaxEntries: z.number().min(1).max(200).default(30),
  /** Where `wiki.json` files live. Defaults to `<dsh home>/repo-wiki`. */
  dataDir: z.string(),
  /**
   * Fallback workspace root for a caller with no session. Routes never take a
   * root from the request body, so this is the only override.
   */
  workspaceRoot: z.string(),
  /** File budget for one scan, before the scan reports truncation. */
  maxScanFiles: z.number().min(1).default(20000),
  /** Extra directory names to keep out of the reading view. */
  excludedDirectories: z.array(z.string()).default([]),
  /** Extra file suffixes to keep out of the reading view. */
  excludedExtensions: z.array(z.string()).default([]),
  /** Extra basenames to keep out of the reading view. */
  excludedFiles: z.array(z.string()).default([]),
  /** Extra extensions to treat as source code for the credential-name carve-out. */
  sourceExtensions: z.array(z.string()).default([]),
  /** Whether `.gitignore` files constrain the reading view. */
  useGitignore: z.boolean().default(true),
  /** Whether nested `.gitignore` files apply, or only the repository root's. */
  nestedGitignore: z.boolean().default(true),
})

/**
 * Read a bounded JSON body from a Fetch request.
 * @param request - the incoming request.
 * @returns the parsed body, or an empty object when the body is absent.
 */
async function readJsonBody(request) {
  const text = await request.text()
  if (text === '') return {}
  if (text.length > MAX_BODY_BYTES) throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`)
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/**
 * Build a JSON response with the no-store header every route here wants: a
 * cached Wiki state would show a stale progress bar forever.
 * @param value - the JSON-serializable body.
 * @param [status] - the HTTP status.
 * @returns the response.
 */
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * Resolve the absolute workspace root a request or tool call acts on.
 *
 * The root is derived from the session rather than accepted from the caller:
 * the routes are reachable by any page holding the harness's session cookie, and
 * honouring a caller-supplied directory would let that cookie read any directory
 * on the machine through `read`. The order below mirrors where the harness
 * itself keeps the fact — session creation metadata first, then the sandbox
 * policy's resolved workspace — with a configured override and the process
 * working directory as the last resorts for headless use.
 *
 * @param ctx - the plugin context.
 * @param options - the lookup inputs.
 * @param [options.config] - the resolved plugin config, for the override.
 * @param [options.session] - the session in hand, when the caller has one.
 * @param [options.sessionId] - a session id, looked up when no session is in hand.
 * @returns the absolute workspace root.
 * @throws {Error} when no root can be determined.
 */
export function resolveWorkspaceRoot(ctx, options) {
  const { config, session, sessionId } = options

  /** The session the caller named, when it did not already hold one. */
  let resolved = session
  if (resolved === undefined && sessionId !== undefined) {
    try {
      const sessions = ctx.get('sessions')
      resolved = sessions?.get?.(sessionId)
    } catch {
      resolved = undefined
    }
  }

  const fromSession = resolved?.header?.cwd
    ?? resolved?.meta?.cwd
    ?? resolved?.cwd
  if (typeof fromSession === 'string' && fromSession.length > 0) return fromSession

  try {
    const policy = ctx.get('sandboxPolicy')
    const resolvedPolicy = policy?.resolve?.(resolved === undefined ? undefined : { session: resolved })
    if (typeof resolvedPolicy?.workspaceRoot === 'string' && resolvedPolicy.workspaceRoot.length > 0) {
      return resolvedPolicy.workspaceRoot
    }
  } catch {
    // A policy that refuses to resolve is not fatal here; fall through.
  }

  if (typeof config?.workspaceRoot === 'string' && config.workspaceRoot.length > 0) return config.workspaceRoot
  if (typeof process.cwd() === 'string' && process.cwd().length > 0) return process.cwd()

  const error = new Error('repo-wiki: cannot determine the workspace root for this request')
  error.code = 'NO_WORKSPACE'
  throw error
}

/**
 * Describe one workspace the way the store, the status report and the tab all
 * expect it.
 *
 * The root is canonicalized through `realpath` before it is hashed, because the
 * canonical path is the harness's own notion of a workspace's identity: two
 * spellings of one directory (a symlink, a Windows 8.3 alias, a trailing slash)
 * must not produce two Wikis. A path that cannot be canonicalized — a workspace
 * that has been deleted — is used as given, so the caller sees the failure
 * against the directory it named.
 *
 * @param root - the absolute workspace root.
 * @returns the workspace descriptor.
 */
export async function describeWorkspace(root) {
  let canonical = root
  try {
    canonical = await realpath(root)
  } catch {
    canonical = root
  }
  const normalized = canonical.replace(/\\/g, '/').replace(/\/+$/, '')
  return {
    id: hashString(process.platform === 'win32' ? normalized.toLowerCase() : normalized),
    name: basename(canonical) || canonical,
    root: canonical,
  }
}

/**
 * Mount the plugin.
 * @param ctx - the context, carrying the injected `llm` and `tools` services.
 * @param config - the validated configuration.
 */
export function apply(ctx, config) {
  const dataDir = config.dataDir ?? dshHomePath('repo-wiki')
  const store = new WikiStore({ dataDir, fs: nodeFs, join })
  const fsAdapter = createNodeFsAdapter(nodeFs)

  /**
   * Build the policy-enforcing reader for one workspace. Created per run rather
   * than shared, so a run's caches and its read-set — the citation allowlist —
   * cannot leak into another workspace or another run.
   * @param workspace - the workspace descriptor.
   * @returns the reader.
   */
  const createReader = (workspace) =>
    new WorkspaceReader({
      root: workspace.root,
      fs: fsAdapter,
      join,
      excludedDirectories: config.excludedDirectories,
      excludedExtensions: config.excludedExtensions,
      excludedFiles: config.excludedFiles,
      sourceExtensions: config.sourceExtensions,
      useGitignore: config.useGitignore,
      nestedGitignore: config.nestedGitignore,
    })

  /**
   * Build the model client for one run.
   *
   * The session is threaded through so the route defaults to the model that
   * session is already using, and the run's own choice is threaded through so a
   * generation can use a different model for one run without touching the chat
   * settings — which is exactly what the tab's model picker offers.
   * @param request - `{ session, workspace, model }`.
   * @returns the model client.
   */
  const createModel = ({ session, model }) =>
    createModelClient({ ctx, config, pluginName: name, session, route: model })

  const service = new WikiService({
    store,
    createReader,
    createModel,
    // Read from `.git` itself rather than by shelling out, so a Windows host
    // without `git` on PATH still records which code state a Wiki describes.
    readGitState: async (root) => readGitState(root, { fs: nodeFs, join }),
    historyRetentionMs: config.historyRetentionDays * 24 * 60 * 60 * 1000,
    historyMaxEntries: config.historyMaxEntries,
    options: {
      language: config.language,
      diagrams: config.diagrams,
      retries: config.retries,
      requestTimeoutMs: config.requestTimeoutMs,
      maxScanFiles: config.maxScanFiles,
    },
  })

  ctx.logger?.info?.('%s: wiki.json under %s', name, store.root)

  // ── the model-facing tool ─────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: 'repo_wiki',
    description: [
      'Read, generate or maintain the repository Wiki: a source-cited architecture guide for the current workspace, generated from the code itself and stored outside the repository.',
      'Use `status` first — it reports whether a Wiki exists, how many pages are done, whether one is generating, and whether the code changed since it was generated.',
      '`generate` starts a run and returns immediately (a run takes minutes); poll `status` to watch it. Every conclusion in a generated page is cited as `path:line-line` and each citation was verified against a file the generation actually read.',
      '`read` returns one page\'s Markdown when you need to quote the guide. A failed or stopped page can be rewritten on its own with `regenerate-page` (pass `pageId`) instead of regenerating the whole Wiki.',
      'Every full run archives the version it replaces, keeping the recent versions (three days by default); `restore` brings back the newest one or the one named by `versionId`, which is the undo for an accidental regeneration or deletion.',
      'Refused paths are part of the design: dependency trees, build output, caches, `.gitignore` matches, symlinks and credential-looking files are never read.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['status', 'generate', 'read', 'stop', 'remove', 'refresh', 'list', 'regenerate-page', 'restore'],
        description: 'status | generate | read | stop | remove | refresh | list | regenerate-page | restore.',
      },
      pageId: {
        type: 'string',
        description: 'With `read`: the page id, as reported by `status`.',
      },
      versionId: {
        type: 'string',
        description: 'With `restore`: a version id from `status.history`; the newest version when omitted.',
      },
      language: {
        type: 'string',
        enum: ['zh-CN', 'en'],
        description: 'With `generate`: the Wiki language. Regenerating in another language replaces the existing Wiki.',
      },
      diagrams: {
        type: 'boolean',
        description: 'With `generate`: whether to ask for Mermaid diagrams.',
      },
      retries: {
        type: 'integer',
        description: 'With `generate`: retries per page after the first failure (0-8).',
      },
      provider: {
        type: 'string',
        description: 'With `generate`: an explicit provider route, overriding the session model for this run.',
      },
      model: {
        type: 'string',
        description: 'With `generate`: an explicit model id, overriding the session model for this run.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.detail === undefined || value.detail === ''
            ? value.message
            : `${value.message}\n\n${value.detail}`,
        },
      ],
    },
    execute: async (args, exec) => {
      const workspace = await describeWorkspace(
        resolveWorkspaceRoot(ctx, { config, session: exec.agent?.session }),
      )

      if (args.action === 'status') {
        const state = await service.status(workspace, { checkStale: args.action === 'status' })
        return {
          action: 'status',
          ok: true,
          message: summarizeState(state),
          detail: state.exists || state.task !== null ? JSON.stringify(describeState(state), null, 2) : undefined,
        }
      }

      if (args.action === 'list') {
        const entries = await service.list()
        return {
          action: 'list',
          ok: true,
          message: entries.length === 1
            ? '1 workspace has a Wiki.'
            : `${entries.length} workspaces have a Wiki.`,
          detail: JSON.stringify(entries, null, 2),
        }
      }

      if (args.action === 'read') {
        if (typeof args.pageId !== 'string' || args.pageId === '') {
          return { action: 'read', ok: false, message: 'read needs `pageId`; call status first to list the pages.' }
        }
        const result = await service.read(workspace, args.pageId)
        if (result.status === 'absent') {
          return { action: 'read', ok: false, message: 'This workspace has no Wiki yet. Call action `generate` first.' }
        }
        if (result.status === 'invalid') {
          return { action: 'read', ok: false, message: `The stored Wiki cannot be read: ${result.reason}` }
        }
        if (result.status === 'not-found') {
          return {
            action: 'read',
            ok: false,
            message: `No page "${args.pageId}".`,
            detail: `Available pages: ${result.available.join(', ')}`,
          }
        }
        const page = result.page
        return {
          action: 'read',
          ok: true,
          message: `# ${page.title}\n\n${page.markdown === '' ? '(this page has no content)' : page.markdown}`,
          detail: page.sources.length > 0
            ? `Verified source locations: ${page.sources.map((source) => `${source.path}:${source.start}-${source.end}`).join(', ')}`
            : undefined,
        }
      }

      if (args.action === 'generate') {
        let task
        try {
          task = service.start({
            workspace,
            language: args.language,
            diagrams: args.diagrams,
            retries: args.retries,
            model: args.provider !== undefined && args.model !== undefined
              ? { provider: args.provider, model: args.model }
              : undefined,
            session: exec.agent?.session,
          })
        } catch (error) {
          return { action: 'generate', ok: false, message: error.message }
        }
        return {
          action: 'generate',
          ok: true,
          message: `Wiki generation started for ${workspace.name} (task ${task.id}, language ${task.language}). It keeps running after this call; poll action \`status\` to watch progress. Completed pages are saved as they finish, so stopping or failing keeps them.`,
          detail: JSON.stringify(describeState(await service.status(workspace, { checkStale: false })), null, 2),
        }
      }

      if (args.action === 'stop') {
        const stopped = service.stop(workspace)
        return {
          action: 'stop',
          ok: stopped,
          message: stopped
            ? 'Stopping the running Wiki generation. Pages already finished are kept.'
            : 'No Wiki generation is running for this workspace.',
        }
      }

      if (args.action === 'remove') {
        const removed = await service.remove(workspace)
        return {
          action: 'remove',
          ok: removed,
          message: removed
            ? `Deleted the ${workspace.name} Wiki. It only ever held local content, so nothing in the repository changed. The live version was archived; \`restore\` brings it back, and a \`remove\` with no live Wiki clears the history.`
            : `${workspace.name} has no Wiki to delete.`,
        }
      }

      if (args.action === 'restore') {
        try {
          const restored = await service.restore(workspace, typeof args.versionId === 'string' ? args.versionId : undefined)
          return {
            action: 'restore',
            ok: true,
            message: `Restored the ${workspace.name} Wiki version ${restored.id} (${restored.done}/${restored.total} pages done, language ${restored.language ?? 'unknown'}).`,
          }
        } catch (error) {
          return { action: 'restore', ok: false, message: error.message }
        }
      }

      if (args.action === 'refresh') {
        const result = await service.refresh(workspace, { auto: true, session: exec.agent?.session })
        const messages = {
          absent: 'This workspace has no Wiki yet; call `generate` instead.',
          invalid: `The stored Wiki cannot be read: ${result.reason}`,
          unchanged: 'The workspace is unchanged since the Wiki was generated; nothing to refresh.',
          busy: 'A Wiki generation is already running for this workspace.',
          refreshed: 'The code changed, so a refresh was started. Pages already finished are kept.',
          stale: 'The code changed, but the refresh was not started.',
        }
        return {
          action: 'refresh',
          ok: result.outcome === 'refreshed' || result.outcome === 'unchanged',
          message: messages[result.outcome] ?? result.outcome,
        }
      }

      if (args.action === 'regenerate-page') {
        if (typeof args.pageId !== 'string' || args.pageId === '') {
          return { action: 'regenerate-page', ok: false, message: 'regenerate-page needs `pageId`; call status first to list the pages.' }
        }
        try {
          const task = await service.regeneratePage(workspace, args.pageId, {
            retries: args.retries,
            model: args.provider !== undefined && args.model !== undefined
              ? { provider: args.provider, model: args.model }
              : undefined,
            session: exec.agent?.session,
          })
          return {
            action: 'regenerate-page',
            ok: true,
            message: `Page "${task.progress.title}" is being regenerated (task ${task.id}). Poll action \`status\` to watch it; the page appears as generating until its new body is saved.`,
          }
        } catch (error) {
          return { action: 'regenerate-page', ok: false, message: error.message }
        }
      }

      return { action: String(args.action), ok: false, message: `Unknown action ${JSON.stringify(args.action)}.` }
    },
  }))

  // ── the user-facing commands ──────────────────────────────────────────────

  ctx.inject(['commands'], (commandCtx) => {
    /** The workspace one command invocation acts on. */
    const workspaceFor = async (invocation) =>
      describeWorkspace(resolveWorkspaceRoot(ctx, { config, session: invocation.agent?.session }))

    commandCtx.effect(() => commandCtx.commands.register({
      name: 'wiki',
      description: 'Show this workspace\'s repository Wiki status, generate it with `generate`, or undo a regeneration/delete with `restore [versionId]`.',
      input: { hint: '[status|generate|restore [versionId]]' },
      handler: async (invocation) => {
        const workspace = await workspaceFor(invocation)
        const argument = String(invocation.rawInput ?? '').trim()
        if (argument === 'generate' || argument === '') {
          try {
            service.start({ workspace, session: invocation.agent?.session })
            return {
              kind: 'success',
              text: `Repository Wiki generation started for ${workspace.name}. Open the 仓库 Wiki tab in the right Sidebar to watch it, or run /wiki status.`,
            }
          } catch (error) {
            return { kind: 'error', text: error.message }
          }
        }
        if (argument === 'restore' || argument.startsWith('restore ')) {
          const versionId = argument === 'restore' ? undefined : argument.slice('restore '.length).trim()
          try {
            const restored = await service.restore(workspace, versionId === '' ? undefined : versionId)
            return {
              kind: 'success',
              text: `Restored the ${workspace.name} Wiki version ${restored.id} (${restored.done}/${restored.total} pages done).`,
            }
          } catch (error) {
            return { kind: 'error', text: error.message }
          }
        }
        const state = await service.status(workspace)
        return { kind: 'success', text: summarizeState(state) }
      },
    }), 'repo-wiki: /wiki command')

    commandCtx.effect(() => commandCtx.commands.register({
      name: 'wiki-delete',
      description: 'Delete this workspace\'s repository Wiki. The recent versions are kept so `wiki restore` can undo it.',
      handler: async (invocation) => {
        const workspace = await workspaceFor(invocation)
        const removed = await service.remove(workspace)
        return {
          kind: 'success',
          text: removed
            ? `Deleted the ${workspace.name} Wiki. Run /wiki restore to undo it, or /wiki generate to build it again.`
            : `${workspace.name} has no Wiki to delete.`,
        }
      },
    }), 'repo-wiki: /wiki-delete command')
  })

  // ── the authenticated browser routes ─────────────────────────────────────

  ctx.inject(['connection'], (connectionCtx) => {
    const register = (path, methods, handler) =>
      connectionCtx.effect(
        () => {
          // `fetch.register` answers with an asynchronous disposer; the effect
          // wrapper adapts it so unload cannot leak a live route.
          const dispose = connectionCtx.connection.fetch.register({
            path,
            methods,
            requestBody: 'buffered',
            fetch: async (request) => {
              try {
                return await handler(request)
              } catch (error) {
                // A route that throws would answer 400 with no explanation; the
                // tab shows this body instead, so a failure is diagnosable.
                ctx.logger?.warn?.('%s: %s failed: %s', name, path, error?.message ?? String(error))
                return json({ ok: false, error: error?.message ?? String(error) }, 500)
              }
            },
          })
          return () => {
            void dispose()
          }
        },
        `repo-wiki: route ${path}`,
      )

    /** Resolve the workspace named by a request's `sessionId` query or body. */
    const workspaceOf = async (sessionId) =>
      describeWorkspace(resolveWorkspaceRoot(ctx, { config, sessionId }))

    register(ROUTES.state, ['GET'], async (request) => {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('sessionId') ?? undefined
      const workspace = await workspaceOf(sessionId)
      const state = await service.status(workspace, { checkStale: config.checkStale })
      return json({ ok: true, state: describeState(state), wiki: state.wiki })
    })

    register(ROUTES.generate, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const workspace = await workspaceOf(body.sessionId)
      const task = service.start({
        workspace,
        language: body.language,
        diagrams: typeof body.diagrams === 'boolean' ? body.diagrams : undefined,
        retries: typeof body.retries === 'number' ? body.retries : undefined,
        model: typeof body.provider === 'string' && typeof body.model === 'string'
          ? { provider: body.provider, model: body.model }
          : undefined,
      })
      return json({ ok: true, task: describeTask(task) })
    })

    register(ROUTES.stop, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const workspace = await workspaceOf(body.sessionId)
      return json({ ok: true, stopped: service.stop(workspace) })
    })

    register(ROUTES.read, ['GET'], async (request) => {
      const url = new URL(request.url)
      const workspace = await workspaceOf(url.searchParams.get('sessionId') ?? undefined)
      const pageId = url.searchParams.get('pageId') ?? undefined
      const result = await service.read(workspace, pageId ?? undefined)
      return json({ ok: result.status === 'ok', ...result })
    })

    register(ROUTES.remove, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const workspace = await workspaceOf(body.sessionId)
      return json({ ok: true, removed: await service.remove(workspace) })
    })

    register(ROUTES.restore, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const workspace = await workspaceOf(body.sessionId)
      try {
        const versionId = typeof body.versionId === 'string' && body.versionId !== '' ? body.versionId : undefined
        return json({ ok: true, restored: await service.restore(workspace, versionId) })
      } catch (error) {
        // A refused undo is an answer, not an outage: the tab shows the reason
        // ("nothing to restore", "a run is in flight") rather than a 500.
        const status = error?.code === 'WIKI_BUSY' ? 409 : error?.code === 'WIKI_NO_BACKUP' ? 404 : 500
        return json({ ok: false, error: error?.message ?? String(error), code: error?.code ?? null }, status)
      }
    })

    register(ROUTES.refresh, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const workspace = await workspaceOf(body.sessionId)
      const result = await service.refresh(workspace, { auto: body.auto === true })
      return json({ ok: true, outcome: result.outcome })
    })

    register(ROUTES.regeneratePage, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      if (typeof body.pageId !== 'string' || body.pageId === '') {
        return json({ ok: false, error: 'regeneratePage needs a `pageId`' }, 400)
      }
      const workspace = await workspaceOf(body.sessionId)
      const task = await service.regeneratePage(workspace, body.pageId, {
        retries: typeof body.retries === 'number' ? body.retries : undefined,
        model: typeof body.provider === 'string' && typeof body.model === 'string'
          ? { provider: body.provider, model: body.model }
          : undefined,
      })
      return json({ ok: true, task: describeTask(task) })
    })

    register(ROUTES.models, ['GET'], async () => {
      const providers = await listAvailableModels(ctx)
      return json({ ok: true, providers })
    })
  })

  // ── the turn-end refresh ─────────────────────────────────────────────────

  ctx.inject(['sessions'], (sessionCtx) => {
    /**
     * ZCode refreshes a Wiki at the end of a turn, but only when the code
     * changed. DSH exposes `turn/end` as a durable session event rather than a
     * context event, so this subscribes where the session object allows it and
     * reports what it could not attach. The staleness claim itself is always
     * available through `state`/`/wiki`, which are what the tab and the tool
     * read, so a session that offers no subscription loses only the automatic
     * half of the feature rather than the feature.
     */
    const attached = new WeakSet()
    const attach = (session) => {
      if (session === null || session === undefined || attached.has(session)) return
      if (typeof session.on !== 'function') return
      attached.add(session)
      const handler = () => {
        void (async () => {
          try {
            const workspace = await describeWorkspace(
              resolveWorkspaceRoot(ctx, { config, session }),
            )
            await service.refresh(workspace, { auto: config.autoRefresh, session })
          } catch (error) {
            ctx.logger?.debug?.('%s: turn-end refresh skipped: %s', name, error?.message ?? String(error))
          }
        })()
      }
      sessionCtx.effect(() => {
        session.on('turn/end', handler)
        return () => session.off?.('turn/end', handler)
      }, 'repo-wiki: turn-end refresh')
    }

    // Attach to what already exists; the sessions service has no creation event
    // in the verified surface, so a session opened later is picked up by the
    // `status` path instead.
    try {
      for (const session of sessionCtx.sessions.list()) attach(session)
    } catch (error) {
      ctx.logger?.debug?.('%s: cannot enumerate sessions: %s', name, error?.message ?? String(error))
    }
  })

  /**
   * Expose the service so another plugin can drive a Wiki directly, and make
   * unloading stop any run instead of leaving a generator writing into a store
   * whose owner is gone.
   */
  return () => {
    for (const task of service.tasks.values()) {
      if (task.state === 'running') task.stop?.('plugin unloaded')
    }
  }
}

/**
 * Render a status report as one line a model or a user can act on.
 * @param state - the service's status result.
 * @returns the summary.
 */
export function summarizeState(state) {
  const parts = []
  const history = Array.isArray(state.history) ? state.history : []
  if (state.task !== null && state.task.state === 'running') {
    const { index, total, title } = state.task.progress
    parts.push(`Generating (${state.task.phase}, ${index}/${total || '?'}${title === null ? '' : `: ${title}`})`)
  } else if (state.task !== null && state.task.state !== 'done') {
    parts.push(`Last run ${state.task.state}${state.task.error === null ? '' : `: ${state.task.error}`}`)
  }
  if (state.exists) {
    const counts = state.wiki.counts
    parts.push(
      `Wiki present: ${counts.done}/${counts.total} pages done`
      + (counts.failed > 0 ? `, ${counts.failed} failed` : '')
      + `, ${state.wiki.citations.verified} verified source locations`
      + (state.wiki.citations.unverified > 0 ? `, ${state.wiki.citations.unverified} unverified` : '')
      + `, language ${state.wiki.meta.language}`,
    )
    if (state.stale) parts.push('the code changed since it was generated (refresh available)')
  } else if (state.unreadable !== null) {
    parts.push(`The stored Wiki is unreadable: ${state.unreadable}`)
  } else {
    parts.push('No Wiki yet for this workspace')
  }
  if (history.length > 0) {
    const newest = history[0]
    parts.push(`${history.length} archived version${history.length === 1 ? '' : 's'} kept; newest ${newest.done}/${newest.total} pages done`)
  }
  return `${parts.join('; ')}.`
}

/**
 * Project a status result onto the JSON the browser tab consumes, dropping the
 * live task's unbounded fields.
 * @param state - the service's status result.
 * @returns the wire shape.
 */
export function describeState(state) {
  return {
    workspace: state.workspace,
    exists: state.exists,
    unreadable: state.unreadable,
    stale: state.stale,
    fingerprint: state.fingerprint === null ? null : { value: state.fingerprint.value, files: state.fingerprint.files, truncated: state.fingerprint.truncated, error: state.fingerprint.error ?? null },
    wiki: state.wiki,
    history: Array.isArray(state.history) ? state.history : [],
    historyRetentionDays: state.historyRetentionDays ?? null,
    task: state.task === null ? null : describeTask(state.task),
  }
}

/**
 * Project a task onto its wire shape.
 * @param task - the live task.
 * @returns the wire shape.
 */
export function describeTask(task) {
  return {
    id: task.id,
    state: task.state,
    phase: task.phase,
    kind: task.kind ?? 'full',
    pageId: task.pageId ?? null,
    language: task.language,
    diagrams: task.diagrams,
    retries: task.retries,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    error: task.error,
    model: task.model ?? null,
    usage: task.usage ?? null,
    progress: { ...task.progress },
    events: task.events.slice(-40),
  }
}

export { hashString }
