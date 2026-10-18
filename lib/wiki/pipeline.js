/**
 * The Wiki generation pipeline.
 *
 * Reproduces the four-stage progress ZCode reports — analysing the codebase,
 * generating the table of contents, generating pages, saving the Wiki — with the
 * behaviours that make the feature usable rather than merely present:
 *
 * - **The model explores; the pipeline does not pre-digest.** In the analysis
 *   stage the model drives `list_directory`/`read_file` against {@link
 *   WorkspaceReader}, so the exclusion policy is part of its world and it reads
 *   what it decides to read. A deployment whose model cannot call tools gets a
 *   deterministic outline plus manifests instead, which preserves the property
 *   that the model chooses, at the cost of a shallower first pass.
 * - **Pages survive failure.** Each finished page is handed to the caller's
 *   save hook immediately, so a stop, a crash, or an application exit leaves the
 *   completed pages on disk. Only an all-pages failure fails the task, exactly
 *   as ZCode documents.
 * - **Citations are verified, not trusted.** Every page's citations are checked
 *   against the files this generation actually read; failures are repaired once
 *   and then recorded as unverified rather than rendered as evidence.
 *
 * The pipeline depends on two narrow interfaces — a workspace reader and a
 * model client — so it is testable end to end without DSH, without a network,
 * and without a real model.
 *
 * @module dsh-repo-wiki/wiki/pipeline
 */

import {
  countLines,
  createWikiDocument,
  flattenCatalog,
  normalizeCatalog,
  parseCitations,
  verifyCitations,
} from './model.js'
import {
  catalogBrief,
  explorationBrief,
  pageBrief,
  parseJsonReply,
  repairBrief,
  systemPreamble,
  EXPLORE_TOOLS,
} from './prompts.js'
import { WikiAccessError } from './workspace.js'

/**
 * A generation failure that carries the stage it happened in, so the UI can say
 * which of the four captions failed.
 */
export class WikiGenerationError extends Error {
  /**
   * @param phase - the stage that failed.
   * @param message - the failure.
   */
  constructor(phase, message) {
    super(message)
    /** @type {string} */
    this.name = 'WikiGenerationError'
    /** @type {string} */
    this.phase = phase
  }
}

/**
 * A model client: one method, one request, one reply.
 *
 * `supportsTools` decides whether the analysis stage explores or reads a single
 * prepared brief. A client that cannot call tools must still answer with text.
 *
 * @typedef {object} ModelClient
 * @property {boolean} [supportsTools] - whether `tools` in a request is honoured.
 * @property {(request: ModelRequest) => Promise<ModelResponse>} complete - perform one request.
 */

/**
 * @typedef {object} ModelRequest
 * @property {string} system - the system prompt.
 * @property {Array<ModelMessage>} messages - the conversation so far.
 * @property {Array<object>} [tools] - JSON-schema tool specs.
 * @property {AbortSignal} [signal] - cancellation.
 * @property {number} [timeoutMs] - per-request timeout.
 */

/**
 * @typedef {object} ModelMessage
 * @property {'system' | 'user' | 'assistant' | 'tool'} role - the turn's author.
 * @property {string} [content] - text content.
 * @property {Array<{ id: string, name: string, arguments: unknown }>} [toolCalls] - requested calls.
 * @property {Array<{ id: string, name: string, content: string }>} [toolResults] - call results.
 */

/**
 * @typedef {object} ModelResponse
 * @property {string} text - the reply's text.
 * @property {Array<{ id: string, name: string, arguments: unknown }>} [toolCalls] - requested calls.
 */

/** Default bounds. Every one of these exists to keep a huge repository bounded. */
const DEFAULTS = Object.freeze({
  /** Model turns allowed in the analysis exploration loop. */
  maxExploreSteps: 24,
  /** Files the exploration loop may read. */
  maxExploreReads: 40,
  /** Bytes of evidence attached to one page request. */
  maxEvidenceBytes: 220 * 1024,
  /** A single evidence file's ceiling. */
  maxEvidenceFileBytes: 48 * 1024,
  /**
   * Evidence files attached to one page request. Sized to hold what the
   * exploration read — the strongest evidence there is — with room left to top
   * up from the rest of the corpus.
   */
  maxEvidenceFiles: 24,
  /** Citations repaired before the rest are recorded unverified. */
  citationRepairAttempts: 1,
})

/** Files whose contents orient a reader in any repository, ordered by signal. */
const ORIENTING_FILES = Object.freeze([
  'package.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'mix.exs',
  'pubspec.yaml',
  'CMakeLists.txt',
  'Makefile',
  'Dockerfile',
  'README.md',
  'README.zh.md',
  'readme.md',
  'ARCHITECTURE.md',
  'AGENTS.md',
  'tsconfig.json',
  'vite.config.ts',
  'webpack.config.js',
  'pnpm-workspace.yaml',
])

/**
 * Split a title or brief into searchable lowercase terms.
 *
 * Latin runs split on non-alphanumerics; CJK has no spaces, so every CJK
 * bigram in the text is also emitted. Without that second rule a Chinese page
 * title would retrieve nothing at all, which is the failure mode that makes
 * keyword retrieval unusable for a Chinese Wiki.
 * @param input - the text to tokenize.
 * @returns the terms.
 */
export function tokenize(input) {
  const lowered = String(input).toLowerCase()
  const terms = new Set()
  for (const token of lowered.split(/[^a-z0-9_]+/)) {
    if (token.length >= 3) terms.add(token)
  }
  const cjk = [...lowered].filter((char) => char >= '\u3400' && char <= '\u9fff')
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    terms.add(cjk[index] + cjk[index + 1])
  }
  if (cjk.length === 1) terms.add(cjk[0])
  return [...terms]
}

/**
 * Score one file path against a term list.
 *
 * A path is the only cheap signal available without reading every file, and it
 * is a good one: in a real repository `src/wiki/pipeline.ts` is far more likely
 * to answer a question about the wiki than `src/util/strings.ts`.
 * @param path - the workspace-relative path.
 * @param terms - the query terms.
 * @returns the score, higher being more relevant.
 */
export function scorePath(path, terms) {
  const lowered = path.toLowerCase()
  const basename = lowered.slice(lowered.lastIndexOf('/') + 1)
  let score = 0
  for (const term of terms) {
    if (basename.includes(term)) score += 6
    else if (lowered.includes(term)) score += 3
  }
  return score
}

/**
 * The Wiki generator for one workspace.
 */
export class WikiGenerator {
  /**
   * @param options - construction inputs.
   * @param options.reader - the policy-enforcing workspace reader.
   * @param options.model - the model client.
   * @param options.workspace - `{ id, name, root }`.
   * @param [options.options] - generation options.
   * @param [options.onEvent] - progress sink; never throws into the pipeline.
   * @param [options.onPage] - called with the whole document after each page, so a caller can persist progress.
   */
  constructor(options) {
    /** @type {import('./workspace.js').WorkspaceReader} */
    this.reader = options.reader
    /** @type {ModelClient} */
    this.model = options.model
    /** @type {{ id: string, name: string, root: string }} */
    this.workspace = options.workspace
    /** @type {DEFAULTS & object} */
    this.options = { ...DEFAULTS, ...(options.options ?? {}) }
    /** @type {(event: object) => void} */
    this.onEvent = options.onEvent ?? (() => {})
    /** @type {((document: object) => Promise<void> | void) | undefined} */
    this.onPage = options.onPage
    /** @type {AbortController} */
    this.abortController = new AbortController()
    /** @type {Map<string, number>} line counts for every file this generation read. */
    this.lineCounts = new Map()
    /** @type {string | null} */
    this.stopReason = null
    /** @type {boolean} whether the model route has been reported yet. */
    this.routeReported = false
    /** @type {{ requests: number, inputTokens: number, outputTokens: number }} cumulative token usage across every request of this run. */
    this.usageTotals = { requests: 0, inputTokens: 0, outputTokens: 0 }
  }

  /** @returns {AbortSignal} the signal a caller can watch for cancellation. */
  get signal() {
    return this.abortController.signal
  }

  /**
   * Request cancellation. The pipeline checks between model calls and between
   * pages, so an in-flight request is aborted rather than waited out.
   * @param reason - a human-readable reason recorded on the task.
   */
  abort(reason = 'stopped by the user') {
    if (this.signal.aborted) return
    this.stopReason = reason
    this.abortController.abort(reason)
  }

  /**
   * Emit a progress event. A sink that throws must not corrupt a generation, so
   * a failure here is swallowed: progress is an observation, not a step.
   * @param event - the event to emit.
   */
  #emit(event) {
    try {
      this.onEvent(event)
    } catch {
      // A UI that cannot receive progress must not be able to fail a generation.
    }
  }

  /**
   * Throw when the task has been cancelled.
   * @param phase - the stage checking, for the error's label.
   */
  #checkAborted(phase) {
    if (this.signal.aborted) {
      const error = new WikiGenerationError(phase, this.stopReason ?? 'stopped')
      error.stopped = true
      throw error
    }
  }

  /**
   * Read one file through the reader, recording its line count for citation
   * verification. Every read in this pipeline goes through here, so the set of
   * citable paths is exactly the set of read paths.
   * @param path - the workspace-relative path.
   * @param [startLine] - first line, 1-based.
   * @param [endLine] - last line, inclusive.
   * @returns the read result.
   */
  async #read(path, startLine, endLine) {
    const result = await this.reader.read(path)
    this.lineCounts.set(result.path, countLines(result.text))
    if (startLine === undefined && endLine === undefined) return result
    const lines = result.text.split('\n')
    const from = Math.max(1, startLine ?? 1)
    const to = Math.min(lines.length, endLine ?? lines.length)
    return { ...result, text: lines.slice(from - 1, to).join('\n'), range: { start: from, end: to } }
  }

  /**
   * Render a window of a file with line numbers, the form the model is asked to
   * cite from.
   * @param result - a read result.
   * @returns the numbered text.
   */
  static numberLines(result) {
    const offset = result.range?.start ?? 1
    return result.text
      .split('\n')
      .map((line, index) => `${String(index + offset).padStart(5, ' ')}\t${line}`)
      .join('\n')
  }

  /**
   * Dispatch one exploration tool call against the reader.
   * @param call - the model's call.
   * @returns the text result.
   */
  async #dispatchExploreTool(call) {
    const args = call.arguments ?? {}
    if (call.name === 'list_directory') {
      try {
        const listing = await this.reader.list(typeof args.path === 'string' ? args.path : '')
        const lines = listing.entries.map((entry) => {
          const suffix = entry.type === 'directory' ? '/' : ''
          const excluded = entry.excluded === false ? '' : `  [excluded: ${entry.excluded.reason}]`
          const size = entry.type === 'file' && entry.excluded === false ? `  ${entry.size} B` : ''
          return `${entry.path}${suffix}${size}${excluded}`
        })
        return lines.length === 0 ? '(empty directory)' : lines.join('\n')
      } catch (error) {
        if (error instanceof WikiAccessError) return `REFUSED: ${error.message}`
        throw error
      }
    }
    if (call.name === 'read_file') {
      const path = typeof args.path === 'string' ? args.path : ''
      try {
        const result = await this.#read(
          path,
          typeof args.startLine === 'number' ? args.startLine : undefined,
          typeof args.endLine === 'number' ? args.endLine : undefined,
        )
        return `\`${result.path}\`\n${WikiGenerator.numberLines(result)}`
      } catch (error) {
        if (error instanceof WikiAccessError) return `REFUSED: ${error.message}`
        throw error
      }
    }
    return `REFUSED: unknown tool ${JSON.stringify(call.name)}`
  }

  /**
   * Stage one: learn what the repository is.
   *
   * With a tool-capable model this is the exploration loop ZCode describes. The
   * loop is bounded in both turns and reads, and a model that never calls
   * `finish` still yields a usable profile from the last thing it said, so a
   * weak model degrades rather than fails. A provider that rejects the
   * tool-carrying request outright — strict tool-schema validation, a gateway
   * 400 — degrades one step further: the non-interactive brief, which sends
   * text only, stands in for the loop. Losing exploration depth is worth
   * keeping the run.
   *
   * @param options - the stage inputs.
   * @param options.language - the Wiki's language.
   * @param options.timeoutMs - per-request timeout.
   * @returns the project profile and the orientation evidence it read.
   */
  async #analyze(options) {
    this.#checkAborted('analyzing')
    this.#emit({ type: 'phase', phase: 'analyzing' })

    const outline = await this.reader.outline({ maxDepth: 3, maxFiles: 1200 })
    const manifests = await this.#readOrientingFiles()
    const system = systemPreamble(options.language)
    const stage = { language: options.language, timeoutMs: options.timeoutMs, outline, manifests, system }

    if (this.model.supportsTools !== true) return this.#analyzeBrief(stage)

    try {
      return await this.#analyzeExplore(stage)
    } catch (error) {
      // A deliberate stop is never a provider quirk and must not be papered
      // over with a fallback run: the user asked to end this one.
      if (error?.stopped === true || this.signal.aborted) throw error
      this.#emit({
        type: 'warning',
        message: `exploration with tools failed (${error?.message ?? String(error)}); retrying without tools`,
      })
      return this.#analyzeBrief(stage)
    }
  }

  /**
   * The non-interactive analysis: one request, the outline and the orienting
   * manifests attached, no tools to call.
   * @param stage - the stage inputs, as prepared by {@link #analyze}.
   * @returns the project profile and the orientation evidence it read.
   */
  async #analyzeBrief(stage) {
    const reply = await this.#complete({
      system: stage.system,
      messages: [
        {
          role: 'user',
          content: explorationBrief({
            language: stage.language,
            workspaceName: this.workspace.name,
            rootOutline: stage.outline.lines,
            excludedSummary: stage.outline.excludedNotes,
          }),
        },
        {
          role: 'user',
          content: [
            'You cannot explore interactively, so the orientation evidence is attached instead.',
            ...stage.manifests.map((file) => `### \`${file.path}\`\n\`\`\`\n${WikiGenerator.numberLines(file)}\n\`\`\``),
            '',
            'Reply with JSON only: {"summary":"…","stack":["…"],"entrypoints":["…"],"notes":"…"}',
          ].join('\n'),
        },
      ],
      timeoutMs: stage.timeoutMs,
      signal: this.signal,
    })
    const profile = parseJsonReply(reply.text)
    return {
      project: this.#normalizeProject(profile, stage.outline),
      originals: stage.manifests,
      exploreReads: stage.manifests.length,
    }
  }

  /**
   * The interactive analysis: the bounded exploration loop over
   * `list_directory`/`read_file`, ending in a `finish` call.
   * @param stage - the stage inputs, as prepared by {@link #analyze}.
   * @returns the project profile and the orientation evidence it read.
   */
  async #analyzeExplore(stage) {
    /** @type {ModelMessage[]} */
    const messages = [
      {
        role: 'user',
        content: explorationBrief({
          language: stage.language,
          workspaceName: this.workspace.name,
          rootOutline: stage.outline.lines,
          excludedSummary: stage.outline.excludedNotes,
        }),
      },
    ]
    let exploreReads = 0
    let lastText = ''
    for (let step = 0; step < this.options.maxExploreSteps; step += 1) {
      this.#checkAborted('analyzing')
      const reply = await this.#complete({
        system: stage.system,
        messages,
        tools: EXPLORE_TOOLS,
        timeoutMs: stage.timeoutMs,
        signal: this.signal,
      })
      const calls = reply.toolCalls ?? []
      if (reply.text.trim() !== '') lastText = reply.text
      if (calls.length === 0) {
        // No tool call: the model answered in prose. Accept a JSON shape if it
        // gave one, otherwise stop exploring with what has been learned.
        const parsed = parseJsonReply(reply.text)
        if (parsed !== null && typeof parsed === 'object') {
          return {
            project: this.#normalizeProject(parsed, stage.outline),
            originals: [...stage.manifests],
            exploreReads,
          }
        }
        break
      }
      messages.push({ role: 'assistant', content: reply.text, toolCalls: calls })
      /** @type {Array<{ id: string, name: string, content: string }>} */
      const results = []
      for (const call of calls) {
        if (call.name === 'finish') {
          const args = call.arguments ?? {}
          this.#emit({ type: 'log', message: `analysis finished after ${step + 1} model turns` })
          return {
            project: this.#normalizeProject(
              {
                summary: args.summary,
                stack: args.stack,
                entrypoints: args.entrypoints,
                notes: args.notes,
              },
              stage.outline,
            ),
            originals: [...stage.manifests, ...(await this.#readEntrypoints(args.entrypoints))],
            exploreReads,
          }
        }
        if (call.name === 'read_file') exploreReads += 1
        if (exploreReads > this.options.maxExploreReads) {
          results.push({ id: call.id, name: call.name, content: 'REFUSED: exploration read budget exhausted; call `finish` now.' })
          continue
        }
        results.push({ id: call.id, name: call.name, content: await this.#dispatchExploreTool(call) })
      }
      messages.push({ role: 'tool', toolResults: results })
    }

    this.#emit({ type: 'log', message: 'analysis loop ended without an explicit finish; using what was learned' })
    const fallback = parseJsonReply(lastText)
    return {
      project: this.#normalizeProject(fallback, stage.outline),
      originals: [...stage.manifests],
      exploreReads,
    }
  }

  /**
   * Read the orienting files that exist, so every stage has a factual floor
   * even when the model explores badly.
   * @returns the read orientation files.
   */
  async #readOrientingFiles() {
    const read = []
    for (const path of ORIENTING_FILES) {
      if (read.length >= 8) break
      try {
        read.push(await this.#read(path))
      } catch {
        // A manifest that does not exist, is excluded, or is too large simply
        // is not orientation; none of those is an error.
      }
    }
    return read
  }

  /**
   * Read the files a model named as entrypoints, so the guide's citations can
   * point at them and the page stage retrieves them first.
   * @param entrypoints - the model's entrypoint paths.
   * @returns the files that could be read.
   */
  async #readEntrypoints(entrypoints) {
    if (!Array.isArray(entrypoints)) return []
    const read = []
    for (const candidate of entrypoints.slice(0, 8)) {
      if (typeof candidate !== 'string') continue
      const path = candidate.replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '')
      try {
        read.push(await this.#read(path))
      } catch {
        // An entrypoint the model named but that cannot be read is simply not
        // evidence; the citation verifier will reject any later citation of it.
      }
    }
    return read
  }

  /**
   * Coerce an exploration payload into the profile shape the page prompts embed.
   * @param raw - the model's payload, possibly null or malformed.
   * @param outline - the deterministic outline, used as the entrypoint floor.
   * @returns the normalized profile.
   */
  #normalizeProject(raw, outline) {
    const value = raw !== null && typeof raw === 'object' ? raw : {}
    const strings = (input, limit) =>
      Array.isArray(input) ? input.filter((item) => typeof item === 'string' && item.trim() !== '').slice(0, limit) : []
    const summary = typeof value.summary === 'string' && value.summary.trim() !== ''
      ? value.summary.trim()
      : `A repository named ${this.workspace.name}. The automatic outline found ${outline.files} readable files.`
    return {
      name: this.workspace.name,
      summary,
      stack: strings(value.stack, 24),
      entrypoints: strings(value.entrypoints, 24),
      notes: typeof value.notes === 'string' ? value.notes.trim() : '',
      outlineFiles: outline.files,
      outlineTruncated: outline.truncated,
    }
  }

  /**
   * Stage two: design the table of contents.
   *
   * One request, and a deliberately forgiving reading of its reply. A catalog is
   * the least valuable thing in the artifact to be strict about: what a reader
   * opens is the pages, and a repository-specific catalog is a preference rather
   * than a requirement. So when the model times out, fails, or answers with
   * something that is not a catalog, the stage falls back to a deterministic
   * seed catalog instead of failing the whole run — the failure is reported as a
   * warning the UI shows, and generation continues into pages.
   *
   * @param options - the stage inputs.
   * @param options.language - the Wiki's language.
   * @param options.project - the profile from stage one.
   * @param options.timeoutMs - per-request timeout.
   * @returns `{ catalog, degraded }` — the normalized catalog and whether the
   *   built-in template had to stand in for the model's.
   */
  async #catalog(options) {
    this.#checkAborted('catalog')
    this.#emit({ type: 'phase', phase: 'catalog' })

    /** @type {unknown} */
    let rawNodes = null
    /** @type {string | null} */
    let failure = null
    try {
      const reply = await this.#complete({
        system: systemPreamble(options.language),
        messages: [
          {
            role: 'user',
            content: catalogBrief({ language: options.language, project: options.project }),
          },
        ],
        timeoutMs: options.timeoutMs,
        signal: this.signal,
      })
      const parsed = parseJsonReply(reply.text)
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.catalog)) {
        rawNodes = parsed.catalog
      } else {
        failure = parsed === null
          ? 'the model did not answer with JSON'
          : 'the model answer carried no `catalog` array'
      }
    } catch (error) {
      // A timeout here is the common case: analysis has already spent most of
      // the budget exploring the tree. Falling through to the seed catalog is
      // what keeps the run from producing nothing at all.
      failure = error?.message ?? String(error)
    }

    const catalog = normalizeCatalog(rawNodes, options.language)
    const degraded = failure !== null

    if (failure !== null) {
      const message = options.language === 'en'
        ? `the table of contents could not be generated (${failure}); using the built-in template`
        : `目录生成失败（${failure}），已改用内置目录模板`
      this.#emit({ type: 'warning', message })
    }
    this.#emit({ type: 'log', message: `catalog has ${flattenCatalog(catalog).length} pages` })
    return { catalog, degraded }
  }

  /**
   * Choose the evidence attached to one page request.
   *
   * Three sources, in priority order: the files the exploration actually read
   * (the strongest signal that they matter), the profile's entrypoints, and
   * path-keyword matches against the page's own title and brief. The result is
   * bounded by both file count and byte count, because an unbounded evidence
   * bundle is the single fastest way to make this feature expensive.
   *
   * @param options - the retrieval inputs.
   * @param options.page - the flattened catalog entry.
   * @param options.project - the profile.
   * @param options.prior - already-read file results, reused as evidence.
   * @returns the evidence files.
   */
  async #evidence(options) {
    /** @type {Map<string, { path: string, text: string }>} */
    const chosen = new Map()
    const budget = { bytes: 0 }

    const add = (file) => {
      if (chosen.has(file.path)) return
      if (chosen.size >= this.options.maxEvidenceFiles) return
      const clipped = file.text.length > this.options.maxEvidenceFileBytes
        ? { ...file, text: `${file.text.slice(0, this.options.maxEvidenceFileBytes)}\n… (truncated)` }
        : file
      const size = Buffer.byteLength(clipped.text, 'utf8')
      if (budget.bytes + size > this.options.maxEvidenceBytes) return
      budget.bytes += size
      chosen.set(clipped.path, clipped)
    }

    for (const file of options.prior) add(file)

    const terms = tokenize(`${options.page.title} ${options.page.brief}`)
    const candidates = new Set(options.project.entrypoints ?? [])
    let outlinePaths = []
    if (terms.length > 0) {
      const outline = await this.reader.outline({ maxDepth: 6, maxFiles: 4000, maxEntriesPerDirectory: 400 })
      outlinePaths = outline.paths
      const ranked = outline.paths
        .map((path) => ({ path, score: scorePath(path, terms) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
        .slice(0, this.options.maxEvidenceFiles)
      for (const entry of ranked) candidates.add(entry.path)
    }

    for (const path of candidates) {
      if (chosen.size >= this.options.maxEvidenceFiles) break
      try {
        add(await this.#read(path))
      } catch {
        // A candidate that cannot be read is not evidence.
      }
    }

    // Top up with the rest of the readable corpus, shallowest first, until the
    // budget is spent.
    //
    // This is what makes the Wiki's central promise achievable. A page may only
    // cite files this generation actually read, and in this stage the model
    // cannot read anything itself — it can only cite what it was handed. A
    // retrieval that attached keyword matches alone would therefore force a
    // repair round trip on every page that mentions a file whose name does not
    // match its own title, and would leave the citation unverified when the
    // repair could not help. Filling the remaining budget is bounded by the
    // same byte and file caps, so a large repository still sends a bounded
    // slice; it just sends the most structural slice rather than a narrow one.
    if (outlinePaths.length === 0) {
      try {
        outlinePaths = (await this.reader.outline({ maxDepth: 6, maxFiles: 4000, maxEntriesPerDirectory: 400 })).paths
      } catch {
        outlinePaths = []
      }
    }
    for (const path of outlinePaths) {
      if (chosen.size >= this.options.maxEvidenceFiles || budget.bytes >= this.options.maxEvidenceBytes) break
      if (chosen.has(path)) continue
      try {
        add(await this.#read(path))
      } catch {
        // Refused or unreadable: not evidence, and the reason is already known.
      }
    }
    return [...chosen.values()]
  }

  /**
   * Write one page's body into its record, retrying after a failure.
   *
   * Factored out of the page loop so a whole run and a single-page regeneration
   * share exactly one implementation of evidence selection, citation repair and
   * abort handling.
   *
   * @param options - the page inputs.
   * @param options.document - the document being built.
   * @param options.record - the page's record inside that document.
   * @param options.page - the flattened catalog entry.
   * @param options.project - the profile from stage one.
   * @param options.catalogTitles - every page title, for context.
   * @param options.prior - already-read files, reused as evidence.
   * @param options.language - the Wiki's language.
   * @param options.diagrams - whether diagrams are on.
   * @param options.retries - retries after the first failure.
   * @param options.timeoutMs - per-request timeout.
   * @param options.index - the page's position, for progress events.
   * @param options.total - the run's page count, for progress events.
   * @returns `{ status: 'done' | 'failed', attempts, error }`; aborts throw.
   */
  async #writePage(options) {
    const { record, page } = options
    this.#emit({ type: 'page', pageId: page.id, title: page.title, index: options.index, total: options.total, status: 'generating' })
    record.status = 'generating'

    let attempt = 0
    let lastError = null
    let written = false
    const maxAttempts = Math.max(1, (options.retries ?? 0) + 1)
    while (attempt < maxAttempts && !written) {
      attempt += 1
      this.#checkAborted('pages')
      try {
        const evidence = await this.#evidence({ page, project: options.project, prior: options.prior })
        const reply = await this.#complete({
          system: systemPreamble(options.language),
          messages: [
            {
              role: 'user',
              content: pageBrief({
                language: options.language,
                title: page.title,
                brief: page.brief,
                path: page.path,
                project: options.project,
                catalog: options.catalogTitles.filter((title) => title !== page.title),
                files: evidence,
                diagrams: options.diagrams,
                readPaths: this.reader.readPaths,
              }),
            },
          ],
          timeoutMs: options.timeoutMs,
          signal: this.signal,
        })
        record.markdown = stripWrappingFence(reply.text).trim()
        const outcome = await this.#verifyAndRepair({
          record,
          page,
          project: options.project,
          catalogTitles: options.catalogTitles,
          diagrams: options.diagrams,
          language: options.language,
          timeoutMs: options.timeoutMs,
          evidence,
        })
        // A stop that arrives while this page was being written must not let
        // the page be presented as finished: the caller cannot tell whether
        // the reply was cut short, and "completed pages are kept" is a promise
        // about pages that actually completed. The catch below turns this into
        // a `stopped` record, and the pages before it stay `done`.
        this.#checkAborted('pages')
        record.sources = outcome.verified
        record.unverifiedSources = outcome.unverified
        record.status = 'done'
        record.error = null
        record.attempts = attempt
        written = true
        // Remember what this page read, so the next page starts warmer.
        for (const file of evidence) options.prior.push(file)
      } catch (error) {
        // An abort can surface two ways: as this pipeline's own stopped error,
        // or as whatever the in-flight request threw when the signal fired — a
        // provider abort, a DOMException from `throwIfAborted`, a transport
        // error. All of them mean the user asked to stop, and none of them is a
        // page failure, so the signal is the authority rather than the error's
        // shape. Recording it as `failed` would count a deliberate stop in the
        // failure total and tell the reader a page was broken when it was not.
        if (error?.stopped === true || this.signal.aborted) {
          // The page is recorded as stopped before the run unwinds, and the
          // document is written, because the reader loads it from disk: a
          // page left as `waiting` would tell the next reader that generation
          // never reached it, when in fact it was cut off mid-sentence.
          record.status = 'stopped'
          record.error = null
          if (this.onPage !== undefined) await this.onPage(options.document)
          if (error?.stopped === true) throw error
          const stopped = new WikiGenerationError('pages', this.stopReason ?? 'stopped by the user')
          stopped.stopped = true
          throw stopped
        }
        lastError = error
      }
    }

    if (!written) {
      record.status = 'failed'
      record.error = lastError?.message ?? 'generation failed'
      this.#emit({
        type: 'page',
        pageId: page.id,
        title: page.title,
        index: options.index,
        total: options.total,
        status: 'failed',
        error: record.error,
      })
      return { status: 'failed', attempts: attempt, error: record.error }
    }

    this.#emit({
      type: 'page',
      pageId: page.id,
      title: page.title,
      index: options.index,
      total: options.total,
      status: 'done',
      sources: record.sources.length,
      unverified: record.unverifiedSources.length,
    })
    return { status: 'done', attempts: attempt, error: null }
  }

  /**
   * Stage three: write every page.
   * @param options - the stage inputs.
   * @param options.language - the Wiki's language.
   * @param options.project - the profile.
   * @param options.catalog - the catalog.
   * @param options.pages - the flattened page list.
   * @param options.diagrams - whether diagrams are on.
   * @param options.retries - retries per page after the first failure.
   * @param options.timeoutMs - per-request timeout.
   * @param options.document - the document being built, saved after each page.
   * @returns the count of pages that reached `done`.
   */
  async #pages(options) {
    this.#emit({ type: 'phase', phase: 'pages' })
    const catalogTitles = options.pages.map((page) => page.title)
    const prior = []
    let completed = 0
    const total = options.pages.length

    for (const [index, page] of options.pages.entries()) {
      this.#checkAborted('pages')
      const record = options.document.pages.find((candidate) => candidate.id === page.id)
      const outcome = await this.#writePage({
        document: options.document,
        record,
        page,
        project: options.project,
        catalogTitles,
        prior,
        language: options.language,
        diagrams: options.diagrams,
        retries: options.retries,
        timeoutMs: options.timeoutMs,
        index,
        total,
      })
      if (outcome.status === 'done') completed += 1
      // Persist after every page: this is what makes a stop or a crash
      // non-destructive, because the completed pages are already on disk.
      if (this.onPage !== undefined) await this.onPage(options.document)
    }
    return { completed, total }
  }

  /**
   * Regenerate one page of an existing document.
   *
   * The single-page counterpart of {@link run}: everything the page needs is
   * recovered from the stored document — its catalog entry supplies the brief,
   * `meta.project` supplies the profile, and the citation allowlist is rebuilt
   * from what this regeneration actually reads. The document is mutated in
   * place; the caller owns saving it.
   *
   * @param options - the run inputs.
   * @param options.document - the stored Wiki document.
   * @param options.pageId - the page to write.
   * @param options.language - the Wiki's language.
   * @param [options.diagrams] - whether to ask for diagrams.
   * @param [options.retries] - retries after the first failure.
   * @param [options.timeoutMs] - per-request timeout.
   * @returns `{ status: 'done' | 'failed', attempts, error }`; aborts throw.
   */
  async runPage(options) {
    const document = options.document
    const record = document.pages.find((candidate) => candidate.id === options.pageId)
    if (record === undefined) {
      const error = new WikiGenerationError('pages', `no such page ${JSON.stringify(options.pageId)}`)
      error.code = 'NO_SUCH_PAGE'
      throw error
    }
    const flat = flattenCatalog(document.catalog ?? [])
    const page = flat.find((candidate) => candidate.id === options.pageId) ?? {
      id: record.id,
      title: record.title,
      brief: record.brief ?? '',
      path: record.path ?? [record.title],
      parentId: record.parentId ?? null,
      depth: record.depth ?? 0,
    }
    const project = document.meta?.project ?? {
      name: this.workspace.name,
      summary: '',
      stack: [],
      entrypoints: [],
      notes: '',
    }
    const outcome = await this.#writePage({
      document,
      record,
      page,
      project,
      catalogTitles: flat.map((entry) => entry.title),
      prior: [],
      language: options.language,
      diagrams: options.diagrams === true,
      retries: options.retries ?? 0,
      timeoutMs: options.timeoutMs,
      index: 0,
      total: 1,
    })
    document.meta.updatedAt = new Date().toISOString()
    return outcome
  }

  /**
   * Verify a page's citations and give the model one chance to repair them.
   * @param options - the verification inputs.
   * @returns the verified and unverified citations.
   */
  async #verifyAndRepair(options) {
    const attemptVerification = () => {
      const citations = parseCitations(options.record.markdown)
      return { citations, ...verifyCitations(citations, { readPaths: this.reader.readPaths, lineCounts: this.lineCounts }) }
    }
    let { citations, verified, unverified } = attemptVerification()
    let repairs = 0
    while (unverified.length > 0 && repairs < this.options.citationRepairAttempts) {
      repairs += 1
      this.#checkAborted('pages')
      const reply = await this.#complete({
        system: systemPreamble(options.language),
        messages: [
          {
            role: 'user',
            content: pageBrief({
              language: options.language,
              title: options.page.title,
              brief: options.page.brief,
              path: options.page.path,
              project: options.project,
              catalog: options.catalogTitles.filter((title) => title !== options.page.title),
              files: options.evidence,
              diagrams: options.diagrams,
              readPaths: this.reader.readPaths,
            }),
          },
          { role: 'assistant', content: options.record.markdown },
          {
            role: 'user',
            content: repairBrief({
              language: options.language,
              rejections: unverified.map((citation) => `${citation.raw} — ${citation.reason}`),
            }),
          },
        ],
        timeoutMs: options.timeoutMs,
        signal: this.signal,
      })
      const candidate = stripWrappingFence(reply.text).trim()
      if (candidate === '') break
      options.record.markdown = candidate
      const recheck = attemptVerification()
      citations = recheck.citations
      verified = recheck.verified
      unverified = recheck.unverified
    }
    return { citations, verified, unverified }
  }

  /**
   * Perform one model request with the pipeline's timeout default applied.
   *
   * This is also where a run's model route and its token cost become visible:
   * the client reports them through the event stream, so the tab can name the
   * model that is writing the Wiki and total what the run has spent, instead of
   * leaving both to guesswork.
   * @param request - the request, without a timeout.
   * @returns the model's reply.
   */
  async #complete(request) {
    const timeoutMs = request.timeoutMs ?? this.options.requestTimeoutMs ?? 180000
    const reply = await this.model.complete({ ...request, timeoutMs })
    const route = reply?.route
    if (this.routeReported !== true && route !== undefined && route !== null) {
      this.routeReported = true
      this.#emit({ type: 'model', provider: route.provider ?? null, model: route.model ?? null, source: route.source ?? null })
    }
    const usage = reply?.usage
    if (usage !== undefined && usage !== null) {
      this.usageTotals.requests += 1
      this.usageTotals.inputTokens += Number(usage.inputTokens) || 0
      this.usageTotals.outputTokens += Number(usage.outputTokens) || 0
      this.#emit({ type: 'usage', ...this.usageTotals })
    }
    return reply
  }

  /**
   * Run a whole generation.
   *
   * @param options - the run inputs.
   * @param options.language - the Wiki's language.
   * @param [options.diagrams] - whether to ask for Mermaid diagrams.
   * @param [options.retries] - retries per page after the first failure.
   * @param [options.timeoutMs] - per-request model timeout.
   * @param [options.fingerprint] - the source fingerprint this run covers.
   * @param [options.model] - the provider/model label recorded in metadata.
   * @param [options.branch] - the recorded VCS branch.
   * @param [options.commit] - the recorded VCS commit.
   * @param [options.fileCount] - the readable file count recorded in metadata.
   * @returns the finished Wiki document.
   */
  async run(options) {
    const document = createWikiDocument({
      workspace: this.workspace,
      language: options.language,
      model: options.model ?? null,
      diagrams: options.diagrams === true,
    })
    document.meta.branch = options.branch ?? null
    document.meta.commit = options.commit ?? null
    document.meta.fileCount = options.fileCount ?? 0
    document.meta.fingerprint = options.fingerprint ?? null

    // ZCode's order is 正在分析代码库 → 正在生成目录 → 正在生成页面 → 正在保存
    // Wiki, and the order is load-bearing rather than cosmetic: the catalog is
    // designed from what the analysis learned, so a repository-specific table of
    // contents is possible at all.
    const analysis = await this.#analyze({ language: options.language, timeoutMs: options.timeoutMs })
    document.meta.project = analysis.project
    if (this.onPage !== undefined) await this.onPage(document)

    const { catalog, degraded } = await this.#catalog({
      language: options.language,
      project: analysis.project,
      timeoutMs: options.timeoutMs,
    })
    document.catalog = catalog
    document.meta.catalogDegraded = degraded === true
    const pages = flattenCatalog(catalog)
    document.pages = pages.map((page) => ({
      id: page.id,
      title: page.title,
      brief: page.brief,
      path: page.path,
      parentId: page.parentId,
      depth: page.depth,
      status: 'waiting',
      markdown: '',
      sources: [],
      unverifiedSources: [],
      error: null,
      attempts: 0,
    }))
    // Publishing the catalog before the first page is written is what lets a
    // reader start reading while the rest of the Wiki is still generating.
    this.#emit({ type: 'catalog', catalog, total: pages.length })
    if (this.onPage !== undefined) await this.onPage(document)

    const counts = await this.#pages({
      language: options.language,
      project: analysis.project,
      catalog,
      pages,
      diagrams: options.diagrams === true,
      retries: options.retries ?? 0,
      timeoutMs: options.timeoutMs,
      document,
    })

    if (counts.completed === 0 && counts.total > 0) {
      throw new WikiGenerationError(
        'pages',
        `every one of the ${counts.total} pages failed to generate; the Wiki was not saved`,
      )
    }

    this.#checkAborted('saving')
    this.#emit({ type: 'phase', phase: 'saving' })
    document.meta.updatedAt = new Date().toISOString()
    return document
  }
}

/**
 * Remove a single fenced block that wraps a whole reply.
 *
 * Models routinely answer with ```markdown … ```, which would otherwise nest a
 * fence inside the page body and break rendering. Only a fence that opens the
 * reply and closes it is removed; a fence inside the prose is content.
 * @param text - the model's reply.
 * @returns the unwrapped text.
 */
export function stripWrappingFence(text) {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  const match = /^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed)
  return match === null ? trimmed : match[1]
}
