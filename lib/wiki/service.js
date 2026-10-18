/**
 * The Wiki service: what the plugin offers once, independent of HTTP, tools, or
 * cordis.
 *
 * Everything a caller can do to a Wiki goes through this class — ask for its
 * state, generate it, stop generating it, read a page, delete it, and check
 * whether it still matches the code. Keeping that surface here rather than in
 * the cordis plugin is what makes the feature testable end to end with a fake
 * model and a virtual filesystem, and it is what lets the HTTP route, the
 * model-facing tool and the client tab share one implementation instead of three
 * subtly different ones.
 *
 * The rules this class enforces are the ones ZCode documents as limits, and each
 * exists because the alternative is a broken artifact rather than a missing
 * feature:
 *
 * - **One generation per workspace.** Two concurrent runs would interleave their
 *   saves and produce a document whose pages came from different code states.
 * - **One language per workspace.** Regenerating in the other language replaces
 *   the document, because ZCode keeps a single language version and a reader
 *   cannot be shown two half-translated guides.
 * - **Completed pages survive.** The document is written after every page, so a
 *   stop, a failure, or an application exit leaves what was finished.
 * - **Only a total failure fails.** A run where some pages failed still produces
 *   a usable Wiki, and the failures are reported as a count.
 * - **The previous version is recoverable.** A full run archives the last good
 *   document before overwriting it, and a delete keeps the same copy, so a
 *   mis-clicked regeneration or a mistaken delete can be undone by `restore`.
 *
 * @module dsh-repo-wiki/wiki/service
 */

import { createHash } from 'node:crypto'

import { summarizeWiki } from './model.js'
import { WikiGenerator } from './pipeline.js'

/** Task lifecycle states. */
export const TASK_STATES = Object.freeze(['running', 'done', 'failed', 'stopped'])

/** How long an archived version stays restorable by default: three days. */
export const DEFAULT_HISTORY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000

/** How many archived versions one workspace keeps by default. */
export const DEFAULT_HISTORY_MAX_ENTRIES = 30

/** How often an idle workspace's expired versions are swept, at most. */
const HISTORY_SWEEP_INTERVAL_MS = 10 * 60 * 1000

/**
 * Summarize an archived document for the restore result.
 *
 * Only what a caller needs to confirm the undo is kept: how much of it is
 * usable, which language it is in, and when it was generated. The page bodies
 * stay on disk.
 *
 * @param document - the archived Wiki document.
 * @returns the summary.
 */
export function summarizeBackup(document) {
  const done = document.pages.filter((page) => page.status === 'done').length
  return {
    done,
    total: document.pages.length,
    failed: document.pages.filter((page) => page.status === 'failed').length,
    updatedAt: document.meta?.updatedAt ?? document.createdAt ?? null,
    language: document.meta?.language ?? null,
  }
}

/**
 * A tag describing whether code changed since a Wiki was generated.
 * @typedef {'absent' | 'unchanged' | 'stale' | 'refreshed' | 'busy'} RefreshOutcome
 */

/**
 * The Wiki service.
 */
export class WikiService {
  /**
   * @param options - construction inputs.
   * @param options.store - the per-workspace document store.
   * @param options.createReader - `(workspace) => WorkspaceReader`; the host owns policy config.
   * @param options.createModel - `({ session, workspace, model }) => ModelClient`.
   * @param [options.readGitState] - `(root) => Promise<{ branch, commit }>`; the host's view of VCS
   *   state, consulted once per run so a Wiki records the code state it describes.
   * @param [options.options] - generation defaults merged into every run.
   * @param [options.now] - clock, injectable so tests are deterministic.
   * @param [options.maxTaskEvents] - bound on a task's retained event log.
   * @param [options.historyRetentionMs] - how long an archived version stays restorable.
   * @param [options.historyMaxEntries] - how many versions one workspace keeps.
   */
  constructor(options) {
    /** @type {import('./store.js').WikiStore} */
    this.store = options.store
    this.createReader = options.createReader
    this.createModel = options.createModel
    /** @type {((root: string) => Promise<{ branch: string | null, commit: string | null }>) | undefined} */
    this.readGitState = options.readGitState
    /** @type {object} */
    this.options = options.options ?? {}
    /** @type {() => Date} */
    this.now = options.now ?? (() => new Date())
    /** @type {number} */
    this.maxTaskEvents = options.maxTaskEvents ?? 200
    /** @type {number} how long one archived version stays restorable. */
    this.historyRetentionMs = options.historyRetentionMs ?? DEFAULT_HISTORY_RETENTION_MS
    /** @type {number} how many archived versions one workspace keeps. */
    this.historyMaxEntries = options.historyMaxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES
    /** @type {Map<string, object>} the one running task per workspace key. */
    this.tasks = new Map()
    /** @type {Map<string, number>} when each workspace last had its history swept. */
    this.historySweptAt = new Map()
    /** @type {Set<string>} workspaces whose legacy single-slot backup was migrated. */
    this.legacyMigrated = new Set()
  }

  /**
   * The key a task is filed under: the same key the store files documents
   * under, so "one task per workspace" and "one Wiki per workspace" cannot
   * disagree.
   * @param workspace - the workspace descriptor.
   * @returns the key.
   */
  #key(workspace) {
    return this.store.pathFor(workspace.root)
  }

  /**
   * Report one workspace's state without reading page bodies.
   *
   * This is what both the tab and the model-facing tool call first, so it
   * answers every question they need in one round trip: whether a Wiki exists,
   * what it holds, whether a run is in flight, and whether the code has moved on
   * since it was generated.
   *
   * @param workspace - the workspace descriptor.
   * @param [options] - measurement options.
   * @param [options.checkStale] - whether to fingerprint the workspace (default true).
   * @returns the state.
   */
  async status(workspace, options = {}) {
    const key = this.#key(workspace)
    // An idle workspace still needs its expired versions swept; the sweep is
    // throttled because `status` is polled every couple of seconds.
    await this.#migrateLegacy(workspace)
    await this.#purgeHistoryIfDue(workspace)
    const task = this.tasks.get(key) ?? null
    const loaded = await this.store.load(workspace.root)
    // The archived versions are what make "I clicked the wrong thing" a
    // recoverable accident, and several of them make it recoverable after a
    // string of bad runs too.
    let history = []
    try {
      history = await this.store.listHistory(workspace.root)
    } catch {
      history = []
    }

    /** @type {object} */
    const state = {
      workspace,
      task,
      exists: loaded.status === 'ok',
      unreadable: loaded.status === 'invalid' ? loaded.reason : null,
      wiki: loaded.status === 'ok' ? summarizeWiki(loaded.document) : null,
      history,
      historyRetentionDays: this.historyRetentionMs / (24 * 60 * 60 * 1000),
      stale: false,
      fingerprint: null,
    }

    if (options.checkStale !== false) {
      try {
        const reader = this.createReader(workspace)
        const { fingerprint, files, truncated } = await reader.fingerprint({
          maxFiles: this.options.maxScanFiles ?? 20000,
        })
        state.fingerprint = { value: fingerprint, files, truncated }
        if (loaded.status === 'ok') {
          state.stale = loaded.document.meta?.fingerprint !== undefined
            && loaded.document.meta.fingerprint !== null
            && loaded.document.meta.fingerprint !== fingerprint
        }
      } catch (error) {
        // A workspace that cannot be walked is reported as unknown rather than
        // as unchanged: claiming freshness would be a lie about the code.
        state.fingerprint = { value: null, files: 0, truncated: false, error: error?.message ?? String(error) }
      }
    }
    return state
  }

  /**
   * The running task for a workspace, or null.
   * @param workspace - the workspace descriptor.
   * @returns the task snapshot.
   */
  taskFor(workspace) {
    return this.tasks.get(this.#key(workspace)) ?? null
  }

  /**
   * Start a generation, or refuse because one is already running.
   *
   * The returned task object is the live one: its `state`, `phase` and
   * `progress` fields update as the run proceeds, so a caller that holds it does
   * not need to poll. Callers that cannot hold it — an HTTP request — read
   * {@link taskFor} instead.
   *
   * @param options - the run request.
   * @param options.workspace - the workspace descriptor.
   * @param [options.language] - the Wiki language; defaults to the configured one.
   * @param [options.diagrams] - whether to ask for diagrams.
   * @param [options.retries] - retries per page.
   * @param [options.model] - an explicit `{ provider, model }` for this run.
   * @param [options.session] - the calling session, so its model is the default.
   * @param [options.branch] - the recorded VCS branch.
   * @param [options.commit] - the recorded VCS commit.
   * @returns the live task.
   * @throws {Error} when a run is already in flight for this workspace.
   */
  start(options) {
    const key = this.#key(options.workspace)
    const existing = this.tasks.get(key)
    if (existing !== undefined && existing.state === 'running') {
      const error = new Error(`a Wiki generation is already running for ${options.workspace.root}`)
      error.code = 'WIKI_BUSY'
      throw error
    }

    const language = options.language ?? this.options.language ?? 'zh-CN'
    const task = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      workspace: options.workspace,
      state: 'running',
      phase: 'analyzing',
      language,
      diagrams: options.diagrams ?? this.options.diagrams ?? true,
      retries: options.retries ?? this.options.retries ?? 0,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      error: null,
      progress: { index: 0, total: 0, pageId: null, title: null, done: 0, failed: 0 },
      /** @type {{ provider: string | null, model: string | null, source: string | null } | null} the route writing this Wiki, once the first reply names it. */
      model: null,
      /** @type {{ requests: number, inputTokens: number, outputTokens: number } | null} cumulative token cost of this run. */
      usage: null,
      events: [],
      stop: null,
      promise: null,
    }
    this.tasks.set(key, task)

    task.promise = this.#run(task, options).catch((error) => {
      // #run records its own failures; this catch exists so an unexpected throw
      // cannot become an unhandled rejection that kills the host process.
      if (task.state === 'running') {
        this.#record(task, { type: 'log', message: `internal failure: ${error?.message ?? String(error)}` })
        task.state = 'failed'
        task.error = error?.message ?? String(error)
        task.finishedAt = this.now().toISOString()
      }
    })
    return task
  }

  /**
   * Run one generation to completion, persisting after every page.
   * @param task - the live task.
   * @param options - the run request, as for {@link start}.
   */
  async #run(task, options) {
    const reader = this.createReader(task.workspace)
    const model = this.createModel({
      session: options.session,
      workspace: task.workspace,
      model: options.model,
    })

    const generator = new WikiGenerator({
      reader,
      model,
      workspace: task.workspace,
      options: { ...this.options, requestTimeoutMs: this.options.requestTimeoutMs },
      onEvent: (event) => this.#record(task, event),
      onPage: async (document) => {
        // Written after every page: this single line is what makes stopping,
        // crashing and exiting non-destructive.
        await this.store.save(document)
      },
    })
    task.stop = (reason) => generator.abort(reason)

    try {
      // The live document is about to be replaced page by page. Copy what is
      // there now into the previous-version slot first, so a mis-clicked
      // regeneration, a provider outage or a stop that leaves nothing usable
      // does not destroy the Wiki that was already finished.
      await this.#archiveCurrent(task.workspace)
      const measured = await reader.fingerprint({ maxFiles: this.options.maxScanFiles ?? 20000 })
      // Recorded once, at the start: the branch and commit the pages describe.
      // Best-effort — an unreadable repository yields nulls rather than a
      // failed run, because the pages are worth more than their provenance.
      const vcs = typeof this.readGitState === 'function'
        ? await this.readGitState(task.workspace.root).catch(() => ({ branch: null, commit: null }))
        : { branch: null, commit: null }
      const document = await generator.run({
        language: task.language,
        diagrams: task.diagrams,
        retries: task.retries,
        timeoutMs: this.options.requestTimeoutMs,
        fingerprint: measured.fingerprint,
        model: options.model ?? null,
        branch: options.branch ?? vcs.branch ?? null,
        commit: options.commit ?? vcs.commit ?? null,
        fileCount: measured.files,
      })
      const finishedAt = this.now().toISOString()
      const done = document.pages.filter((page) => page.status === 'done').length
      const failed = document.pages.filter((page) => page.status === 'failed').length
      // Record the outcome on the document itself: the in-memory task vanishes
      // with the process, but a reader opening the tab tomorrow still deserves
      // to know how the last run ended. The save must complete before the task
      // flips to `done`, or a status poll can observe the finished task with
      // the pre-final document.
      document.meta.lastTask = {
        state: 'done',
        phase: task.phase,
        error: null,
        startedAt: task.startedAt,
        finishedAt,
        done,
        failed,
      }
      await this.store.save(document)
      task.state = 'done'
      task.finishedAt = finishedAt
      task.progress.done = done
      task.progress.failed = failed
      this.#record(task, { type: 'done', pages: done, failed })
    } catch (error) {
      const stopped = error?.stopped === true || generator.signal.aborted
      const finishedAt = this.now().toISOString()
      const message = stopped ? null : (error?.message ?? String(error))
      const phase = stopped ? task.phase : (error?.phase ?? task.phase)
      // A stopped or failed run keeps whatever pages already reached disk; the
      // unrun pages are recorded as `waiting` in the saved document. Same
      // ordering rule as the success path: the document's `lastTask` lands
      // before the task state flips, so no reader can see a settled task over
      // a document that does not yet say how it settled.
      try {
        const loaded = await this.store.load(task.workspace.root)
        if (loaded.status === 'ok') {
          const done = loaded.document.pages.filter((page) => page.status === 'done').length
          const failed = loaded.document.pages.filter((page) => page.status === 'failed').length
          loaded.document.meta.lastTask = {
            state: stopped ? 'stopped' : 'failed',
            phase,
            error: message,
            startedAt: task.startedAt,
            finishedAt,
            done,
            failed,
          }
          await this.store.save(loaded.document)
          task.progress.done = done
          task.progress.failed = failed
        }
      } catch {
        // Reporting progress is best-effort; the run's outcome is already set.
      }
      if (stopped) {
        task.state = 'stopped'
        task.error = null
        task.finishedAt = finishedAt
        this.#record(task, { type: 'stopped' })
      } else {
        task.state = 'failed'
        task.error = message
        task.finishedAt = finishedAt
        this.#record(task, { type: 'failed', phase, message })
      }
    }
  }

  /**
   * Archive the live Wiki as a restorable version, if it has any content.
   *
   * Called once, at the start of a full run, before the first page save, so the
   * version the run is about to replace survives. Unlike the old single-slot
   * design this does not have to choose between versions: complete, partial and
   * wrong-but-complete runs all get their own entry, and an older good entry is
   * never overwritten. Two things are still skipped — a document with no
   * finished page (there is nothing to read) and a document whose content is
   * already archived (so poking "regenerate" repeatedly without changing the
   * Wiki does not fill the window with copies of the same version).
   *
   * @param workspace - the workspace descriptor.
   * @returns whether a version was archived.
   */
  async #archiveCurrent(workspace) {
    try {
      await this.#migrateLegacy(workspace)
      const current = await this.store.load(workspace.root)
      if (current.status !== 'ok') return false
      return await this.#archiveDocument(current.document, this.now().getTime())
    } catch {
      // Recovery is best-effort; the run itself must not fail because of it.
      return false
    }
  }

  /**
   * Store one document as a history entry.
   * @param document - the document to archive.
   * @param archivedAtMs - when the archive happened.
   * @returns whether a new entry was written.
   */
  async #archiveDocument(document, archivedAtMs) {
    try {
      const done = document.pages.filter((page) => page.status === 'done').length
      if (done === 0) return false
      const signature = this.#signature(document)
      const entries = await this.store.listHistory(document.workspace.root)
      if (entries.some((entry) => entry.id.endsWith(`-${signature}`))) return false
      const stamp = String(Math.trunc(Number.isFinite(archivedAtMs) ? archivedAtMs : this.now().getTime())).padStart(13, '0')
      const id = `${stamp}-${done}of${document.pages.length}-${signature}`
      await this.store.saveHistory(document, id)
      await this.#trimHistory(document.workspace.root)
      return true
    } catch {
      return false
    }
  }

  /**
   * A content signature that ignores the run's bookkeeping.
   *
   * `meta.lastTask` and `meta.restoredAt` change when a stopped or failed run
   * records its outcome without changing a single page; including them would
   * archive the same Wiki again on every restart.
   * @param document - the document.
   * @returns 12 hex characters.
   */
  #signature(document) {
    const content = {
      version: document.version,
      workspace: document.workspace,
      meta: { ...document.meta, lastTask: null, restoredAt: undefined },
      catalog: document.catalog,
      pages: document.pages,
    }
    return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12)
  }

  /**
   * Enforce the retention window and size cap for one workspace.
   * @param workspaceRoot - the workspace root.
   */
  async #trimHistory(workspaceRoot) {
    try {
      await this.store.purgeHistory(workspaceRoot, {
        nowMs: this.now().getTime(),
        retentionMs: this.historyRetentionMs,
        maxEntries: this.historyMaxEntries,
      })
    } catch {
      // A cleanup failure must not fail the run; the next sweep retries.
    }
  }

  /**
   * Sweep one workspace's expired history at most once per interval.
   * @param workspace - the workspace descriptor.
   */
  async #purgeHistoryIfDue(workspace) {
    const key = this.#key(workspace)
    const nowMs = this.now().getTime()
    const last = this.historySweptAt.get(key) ?? 0
    if (nowMs - last < HISTORY_SWEEP_INTERVAL_MS) return
    this.historySweptAt.set(key, nowMs)
    await this.#trimHistory(workspace.root)
  }

  /**
   * Move the legacy single-slot `wiki.backup.json` into the history.
   *
   * Runs once per workspace per process. A valid legacy copy becomes an entry
   * (timestamped by the version it was), then the file is removed; an
   * unreadable one is left in place for manual inspection rather than silently
   * deleted.
   * @param workspace - the workspace descriptor.
   */
  async #migrateLegacy(workspace) {
    const key = this.#key(workspace)
    if (this.legacyMigrated.has(key)) return
    try {
      const legacy = await this.store.loadBackup(workspace.root)
      // Absence is not cached: an older process could create the file after this
      // one started, and the next lookup should still find and migrate it.
      if (legacy.status === 'absent') return
      this.legacyMigrated.add(key)
      if (legacy.status !== 'ok') return
      // Stamp the migrated copy with the upgrade time rather than the version's
      // generation time: it was the only safety copy before this release, so it
      // gets a full retention window instead of expiring on the spot.
      await this.#archiveDocument(legacy.document, this.now().getTime())
      await this.store.removeBackup(workspace.root)
    } catch {
      // Migration is best-effort; a legacy file left behind is harmless.
    }
  }

  /**
   * Append one progress event and fold it into the task's summary counters.
   * @param task - the live task.
   * @param event - the event from the pipeline.
   */
  #record(task, event) {
    if (event.type === 'phase') task.phase = event.phase
    if (event.type === 'model') task.model = { provider: event.provider ?? null, model: event.model ?? null, source: event.source ?? null }
    if (event.type === 'usage') task.usage = { requests: event.requests, inputTokens: event.inputTokens, outputTokens: event.outputTokens }
    if (event.type === 'catalog') {
      task.progress.total = event.total
      task.progress.index = 0
    }
    if (event.type === 'page') {
      task.progress.pageId = event.pageId
      task.progress.title = event.title
      task.progress.index = event.index + 1
      if (event.status === 'done') task.progress.done += 1
      if (event.status === 'failed') task.progress.failed += 1
    }
    task.events.push({ at: this.now().toISOString(), ...event })
    if (task.events.length > this.maxTaskEvents) task.events.splice(0, task.events.length - this.maxTaskEvents)
  }

  /**
   * Request that a running generation stop.
   * @param workspace - the workspace descriptor.
   * @param [reason] - why, recorded on the task.
   * @returns whether a running task was asked to stop.
   */
  stop(workspace, reason = 'stopped by the user') {
    const task = this.tasks.get(this.#key(workspace))
    if (task === undefined || task.state !== 'running' || task.stop === null) return false
    task.stop(reason)
    return true
  }

  /**
   * Regenerate one page of an existing Wiki.
   *
   * The full-run rules still hold: one task per workspace, so a page retry is
   * refused while a generation is in flight. The page task reuses the task map
   * — and therefore the progress route, the stop button and the tab's polling —
   * with `kind: 'page'` marking it as a single-page run.
   *
   * @param workspace - the workspace descriptor.
   * @param pageId - the page to regenerate, as reported by `status`.
   * @param [options] - the run request.
   * @param [options.session] - the calling session, so its model is the default.
   * @param [options.model] - an explicit `{ provider, model }` for this run.
   * @param [options.retries] - retries for this page after the first failure.
   * @returns the live task.
   */
  async regeneratePage(workspace, pageId, options = {}) {
    const key = this.#key(workspace)
    const running = this.tasks.get(key)
    if (running !== undefined && running.state === 'running') {
      const error = new Error(`a Wiki generation is already running for ${workspace.root}`)
      error.code = 'WIKI_BUSY'
      throw error
    }
    const loaded = await this.store.load(workspace.root)
    if (loaded.status === 'absent') {
      const error = new Error('this workspace has no Wiki yet')
      error.code = 'WIKI_ABSENT'
      throw error
    }
    if (loaded.status === 'invalid') {
      const error = new Error(`the stored Wiki cannot be read: ${loaded.reason}`)
      error.code = 'WIKI_UNREADABLE'
      throw error
    }
    const document = loaded.document
    const record = document.pages.find((candidate) => candidate.id === pageId)
    if (record === undefined) {
      const error = new Error(`no such page ${JSON.stringify(pageId)}`)
      error.code = 'NO_SUCH_PAGE'
      throw error
    }

    const task = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      workspace,
      state: 'running',
      phase: 'pages',
      kind: 'page',
      pageId,
      language: document.meta?.language ?? this.options.language ?? 'zh-CN',
      diagrams: document.meta?.diagrams === true,
      retries: options.retries ?? this.options.retries ?? 0,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      error: null,
      progress: { index: 1, total: 1, pageId, title: record.title, done: 0, failed: 0 },
      model: null,
      usage: null,
      events: [],
      stop: null,
      promise: null,
    }
    this.tasks.set(key, task)
    task.promise = this.#runPage(task, document, options).catch((error) => {
      // Same contract as a full run: an unexpected throw must not become an
      // unhandled rejection that kills the host process.
      if (task.state === 'running') {
        this.#record(task, { type: 'log', message: `internal failure: ${error?.message ?? String(error)}` })
        task.state = 'failed'
        task.error = error?.message ?? String(error)
        task.finishedAt = this.now().toISOString()
      }
    })
    return task
  }

  /**
   * Run one single-page regeneration.
   *
   * A page that was `done` keeps its old body when the new attempt fails: the
   * retry exists to fill gaps, not to destroy good pages. The record is
   * restored before the failure is persisted.
   *
   * @param task - the live page task.
   * @param document - the stored document, already loaded.
   * @param options - the run request, as for {@link regeneratePage}.
   */
  async #runPage(task, document, options) {
    const reader = this.createReader(task.workspace)
    const model = this.createModel({
      session: options.session,
      workspace: task.workspace,
      model: options.model,
    })
    const generator = new WikiGenerator({
      reader,
      model,
      workspace: task.workspace,
      options: { ...this.options, requestTimeoutMs: this.options.requestTimeoutMs },
      onEvent: (event) => this.#record(task, event),
      onPage: async (doc) => {
        await this.store.save(doc)
      },
    })
    task.stop = (reason) => generator.abort(reason)

    const record = document.pages.find((candidate) => candidate.id === task.pageId)
    const snapshot = {
      status: record.status,
      markdown: record.markdown,
      sources: record.sources,
      unverifiedSources: record.unverifiedSources,
      error: record.error,
      attempts: record.attempts,
    }

    try {
      // Persist the generating state first: the tab's tree shows the page being
      // rewritten instead of presenting the stale body as current.
      record.status = 'generating'
      record.error = null
      await this.store.save(document)
      const outcome = await generator.runPage({
        document,
        pageId: task.pageId,
        language: task.language,
        diagrams: task.diagrams,
        retries: task.retries,
        timeoutMs: this.options.requestTimeoutMs,
      })
      task.finishedAt = this.now().toISOString()
      if (outcome.status === 'done') {
        task.state = 'done'
        task.progress.done = 1
        this.#record(task, { type: 'done', pages: 1, failed: 0 })
      } else {
        if (snapshot.status === 'done') Object.assign(record, snapshot)
        task.state = 'failed'
        task.error = outcome.error ?? 'generation failed'
        task.progress.failed = 1
        this.#record(task, { type: 'failed', phase: 'pages', message: task.error })
      }
      await this.store.save(document)
    } catch (error) {
      task.finishedAt = this.now().toISOString()
      if (error?.stopped === true || generator.signal.aborted) {
        if (snapshot.status === 'done') {
          // A stopped retry of a good page keeps the good page; a stopped retry
          // of a gap stays `stopped`, as the writePage abort path recorded it.
          Object.assign(record, snapshot)
          await this.store.save(document).catch(() => {})
        }
        task.state = 'stopped'
        task.error = null
        this.#record(task, { type: 'stopped' })
      } else {
        if (snapshot.status === 'done') {
          Object.assign(record, snapshot)
          await this.store.save(document).catch(() => {})
        }
        task.state = 'failed'
        task.error = error?.message ?? String(error)
        this.#record(task, { type: 'failed', phase: 'pages', message: task.error })
      }
    }
  }

  /**
   * Wait for a workspace's task to settle. Exposed for tests and for a caller
   * that wants to await a run it just started.
   * @param workspace - the workspace descriptor.
   * @returns the settled task, or null when there is none.
   */
  async settled(workspace) {
    const task = this.tasks.get(this.#key(workspace))
    if (task === null || task === undefined) return null
    await task.promise
    return task
  }

  /**
   * Read a whole Wiki, or one page of it.
   *
   * Reading the whole document is what the model-facing tool does when it wants
   * to quote a conclusion; reading one page is what the tab does when a reader
   * clicks a catalog row. Both answer with the same shapes so neither has to
   * special-case the other.
   *
   * @param workspace - the workspace descriptor.
   * @param [pageId] - a page id, or omitted for the whole document.
   * @returns the read result.
   */
  async read(workspace, pageId) {
    const loaded = await this.store.load(workspace.root)
    if (loaded.status === 'absent') return { status: 'absent' }
    if (loaded.status === 'invalid') return { status: 'invalid', reason: loaded.reason }
    const document = loaded.document
    if (pageId === undefined || pageId === null) {
      return { status: 'ok', wiki: summarizeWiki(document), pages: document.pages }
    }
    const page = document.pages.find((candidate) => candidate.id === pageId)
    if (page === undefined) return { status: 'not-found', pageId, available: document.pages.map((candidate) => candidate.id) }
    return { status: 'ok', page, meta: document.meta, workspace: document.workspace }
  }

  /**
   * Restore an archived version of a Wiki.
   *
   * This is the undo for the ways a generated Wiki can disappear: a
   * regeneration started by mistake, a run stopped or failed before it produced
   * usable pages, or a delete. With a version id the caller picks any version
   * still inside the retention window; without one the newest archived version
   * is restored, which is what the tab's one-click "restore previous" does.
   *
   * The archived document is written back as the live one, with
   * `meta.restoredAt` recording when the undo happened; its own `updatedAt`,
   * pages and citations are untouched, so the restored guide keeps describing
   * the code state it was generated against.
   *
   * A restore is refused while a run is in flight: two writers would interleave
   * and leave the document describing neither version.
   *
   * @param workspace - the workspace descriptor.
   * @param [versionId] - a history id from `status`; newest when omitted.
   * @returns a summary of what was restored.
   * @throws {Error} with code `WIKI_BUSY`, `WIKI_NO_BACKUP` or `WIKI_BACKUP_UNREADABLE`.
   */
  async restore(workspace, versionId) {
    const running = this.tasks.get(this.#key(workspace))
    if (running !== undefined && running.state === 'running') {
      const error = new Error(`a Wiki generation is already running for ${workspace.root}`)
      error.code = 'WIKI_BUSY'
      throw error
    }
    await this.#migrateLegacy(workspace)
    await this.#purgeHistoryIfDue(workspace)

    let id = versionId
    if (id === undefined || id === null || id === '') {
      const entries = await this.store.listHistory(workspace.root).catch(() => [])
      id = entries[0]?.id
    }
    if (id === undefined) {
      const error = new Error('this workspace has no previous version to restore')
      error.code = 'WIKI_NO_BACKUP'
      throw error
    }
    let loaded
    try {
      loaded = await this.store.loadHistory(workspace.root, id)
    } catch {
      // A malformed id is "no such version", not a crash.
      const error = new Error('this workspace has no such previous version to restore')
      error.code = 'WIKI_NO_BACKUP'
      throw error
    }
    if (loaded.status === 'absent') {
      const error = new Error('that previous version has expired or was removed')
      error.code = 'WIKI_NO_BACKUP'
      throw error
    }
    if (loaded.status === 'invalid') {
      const error = new Error(`the previous version cannot be read: ${loaded.reason}`)
      error.code = 'WIKI_BACKUP_UNREADABLE'
      throw error
    }
    const document = loaded.document
    const restoredAt = this.now().toISOString()
    document.meta.restoredAt = restoredAt
    await this.store.save(document)
    return {
      restored: true,
      restoredAt,
      id,
      ...summarizeBackup(document),
    }
  }

  /**
   * Delete one workspace's Wiki.
   *
   * A delete is undoable while any archived version survives: the live document
   * is archived into the history and the reader sees "no Wiki", while `restore`
   * can still bring it (or any older version) back. A delete when nothing is
   * live is the "forget this workspace" action and removes the history too.
   * Local content only either way, so nothing in the repository is touched.
   *
   * @param workspace - the workspace descriptor.
   * @returns whether anything was removed.
   */
  async remove(workspace) {
    this.stop(workspace, 'deleted while generating')
    await this.#migrateLegacy(workspace)
    const current = await this.store.load(workspace.root)
    if (current.status === 'ok') {
      // Keep the version being deleted before dropping the live file, so the
      // delete itself is one of the versions that can be restored.
      await this.#archiveCurrent(workspace)
      return this.store.removeDocument(workspace.root)
    }
    if (current.status === 'invalid') {
      // Leave the readable history intact; only the corrupt live document goes.
      return this.store.removeDocument(workspace.root)
    }
    // Nothing live: this forgets the workspace, history included.
    return this.store.remove(workspace.root)
  }

  /**
   * List every workspace with a Wiki.
   * @returns the stored summaries.
   */
  async list() {
    return this.store.list()
  }

  /**
   * The turn-end update ZCode performs: refresh only when the code changed.
   *
   * The comparison uses the same reading view that produced the Wiki, so a
   * change confined to an excluded file — a dependency bump in `node_modules`, a
   * build artifact — correctly does not trigger a refresh.
   *
   * @param workspace - the workspace descriptor.
   * @param [options] - the refresh request.
   * @param [options.auto] - whether to start a run when the code changed (default false: report only).
   * @param [options.session] - the session whose model a refresh should reuse.
   * @param [options.branch] - the recorded VCS branch.
   * @param [options.commit] - the recorded VCS commit.
   * @returns the outcome and, when a run started, its task.
   */
  async refresh(workspace, options = {}) {
    const key = this.#key(workspace)
    const running = this.tasks.get(key)
    if (running !== undefined && running.state === 'running') return { outcome: 'busy', task: running }

    const loaded = await this.store.load(workspace.root)
    if (loaded.status === 'absent') return { outcome: 'absent' }
    if (loaded.status === 'invalid') return { outcome: 'invalid', reason: loaded.reason }

    const document = loaded.document
    const reader = this.createReader(workspace)
    const measured = await reader.fingerprint({ maxFiles: this.options.maxScanFiles ?? 20000 })
    const previous = document.meta?.fingerprint
    if (previous !== undefined && previous !== null && previous === measured.fingerprint) {
      return { outcome: 'unchanged', fingerprint: measured.fingerprint }
    }

    if (options.auto !== true) {
      return { outcome: 'stale', fingerprint: measured.fingerprint, previous: previous ?? null }
    }

    // A refresh reuses the language, diagram choice and model of the document it
    // replaces: ZCode's "regenerate" keeps the last model unless the caller
    // names another, and a silent language flip would be a surprise.
    const task = this.start({
      workspace,
      language: document.meta?.language,
      diagrams: document.meta?.diagrams === true,
      retries: this.options.retries ?? 0,
      model: options.model ?? document.meta?.model ?? undefined,
      session: options.session,
      branch: options.branch,
      commit: options.commit,
    })
    return { outcome: 'refreshed', task }
  }

  /**
   * Test whether this workspace's file set changed, without starting anything.
   * @param workspace - the workspace descriptor.
   * @returns `{ changed, fingerprint, previous }`.
   */
  async changed(workspace) {
    const loaded = await this.store.load(workspace.root)
    const reader = this.createReader(workspace)
    const measured = await reader.fingerprint({ maxFiles: this.options.maxScanFiles ?? 20000 })
    if (loaded.status !== 'ok') return { changed: false, fingerprint: measured.fingerprint, previous: null }
    const previous = loaded.document.meta?.fingerprint ?? null
    return {
      changed: previous !== null && previous !== measured.fingerprint,
      fingerprint: measured.fingerprint,
      previous,
    }
  }
}
