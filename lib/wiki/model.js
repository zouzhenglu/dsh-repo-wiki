/**
 * The Wiki's data model: what a generated Wiki *is*, independent of how it was
 * produced or drawn.
 *
 * ZCode stores a Wiki as one JSON document per workspace holding every page's
 * Markdown plus its source references, and every conclusion in the prose is
 * expected to carry a `path:line` citation that the reader can click. This
 * module owns that document's schema, the invariants a model's JSON must
 * satisfy before it becomes pages, and — the part that matters most — the
 * verification of citations against files the scan actually read, so a
 * plausible-looking invented path cannot survive into a finished Wiki.
 *
 * @module dsh-repo-wiki/wiki/model
 */

import { hashString } from './workspace.js'

/** The `wiki.json` schema version this module writes and reads. */
export const WIKI_VERSION = 1

/**
 * The aspects ZCode's Wiki is documented to cover, in its documented priority
 * order. A catalog that a model returns is merged against this seed, so a model
 * that omits "risk points" still produces a Wiki that has one, and a model that
 * invents a section keeps it.
 */
export const CATALOG_SEED = Object.freeze([
  {
    id: 'identity',
    title: { 'zh-CN': '项目身份', en: 'Project identity' },
    brief: {
      'zh-CN': '这是干什么的项目、用什么技术栈、从哪里进入。',
      en: 'What this project is, its stack, and where execution enters.',
    },
  },
  {
    id: 'execution',
    title: { 'zh-CN': '主执行链路', en: 'Main execution paths' },
    brief: {
      'zh-CN': '程序启动后按什么顺序做什么，主流程如何推进。',
      en: 'What happens in order after startup, and how the main flow advances.',
    },
  },
  {
    id: 'modules',
    title: { 'zh-CN': '核心模块与子模块', en: 'Core modules and submodules' },
    brief: {
      'zh-CN': '模块划分、各自职责，以及模块之间怎么衔接。',
      en: 'How the code is divided, what each part owns, and how they connect.',
    },
  },
  {
    id: 'boundaries',
    title: { 'zh-CN': '跨端边界', en: 'Cross-platform boundaries' },
    brief: {
      'zh-CN': '进程、端、平台之间的边界和通信方式。',
      en: 'Boundaries and transports between processes, surfaces and platforms.',
    },
  },
  {
    id: 'data-flow',
    title: { 'zh-CN': '数据与状态流', en: 'Data and state flow' },
    brief: {
      'zh-CN': '数据从哪里来、经过什么、存到哪里，状态由谁持有。',
      en: 'Where data comes from, what transforms it, where it lands, and who owns state.',
    },
  },
  {
    id: 'configuration',
    title: { 'zh-CN': '配置边界', en: 'Configuration boundaries' },
    brief: {
      'zh-CN': '哪些东西可配置、默认值在哪、环境如何影响行为。',
      en: 'What is configurable, where defaults live, and how the environment changes behavior.',
    },
  },
  {
    id: 'extension-points',
    title: { 'zh-CN': '扩展点', en: 'Extension points' },
    brief: {
      'zh-CN': '要在哪里加功能、注册机制是什么。',
      en: 'Where new behavior is added and what the registration mechanism is.',
    },
  },
  {
    id: 'risks',
    title: { 'zh-CN': '风险点', en: 'Risk points' },
    brief: {
      'zh-CN': '容易出错、隐含耦合、生命周期陷阱、性能瓶颈。',
      en: 'Failure-prone areas, hidden coupling, lifecycle traps and hot spots.',
    },
  },
])

/** The page lifecycle states, mirroring ZCode's generating list. */
export const PAGE_STATUSES = Object.freeze(['waiting', 'generating', 'done', 'failed', 'stopped'])

/** The generation lifecycle states, mirroring ZCode's four progress captions. */
export const TASK_PHASES = Object.freeze(['analyzing', 'catalog', 'pages', 'saving'])

/**
 * Turn a human title into a stable ASCII identifier.
 *
 * A non-Latin title (the common case for a Chinese Wiki) has no ASCII letters
 * to keep, so the slug is empty and the caller falls back to a hash of the
 * title. That keeps ids stable across regenerations — which is what lets the
 * client keep a reader's place — without pretending `项目身份` has a slug.
 * @param title - the node's display title.
 * @returns a lowercase slug, possibly empty.
 */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/**
 * Derive a stable, unique page id.
 * @param title - the node's display title.
 * @param used - ids already handed out in this catalog.
 * @returns an id not present in `used`.
 */
export function deriveId(title, used) {
  const base = slugify(title) || `p-${hashString(String(title)).slice(0, 8)}`
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let counter = 2
  while (used.has(`${base}-${counter}`)) counter += 1
  const unique = `${base}-${counter}`
  used.add(unique)
  return unique
}

/**
 * Pick the right language variant out of a `{ 'zh-CN': …, en: … }` table.
 * @param table - the variant table.
 * @param language - the requested language.
 * @returns the best available string.
 */
export function localized(table, language) {
  if (typeof table === 'string') return table
  if (table === null || typeof table !== 'object') return ''
  return table[language] ?? table['zh-CN'] ?? table.en ?? Object.values(table)[0] ?? ''
}

/**
 * Coerce a model-supplied value into a trimmed single-line string.
 * @param value - the raw value.
 * @returns the normalized string.
 */
function text(value) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Coerce a model-supplied value into a trimmed multi-line string.
 * @param value - the raw value.
 * @returns the normalized string, or `''`.
 */
function paragraph(value) {
  if (typeof value === 'string') return value.trim()
  return ''
}

/**
 * Normalize one catalog node from model output.
 * @param raw - the model's node.
 * @param language - the Wiki's language.
 * @param used - ids already handed out.
 * @param depth - the node's depth, used to bound nesting.
 * @returns the normalized node, or null when the node has no usable title.
 */
function normalizeNode(raw, language, used, depth) {
  if (raw === null || typeof raw !== 'object') return null
  const title = text(raw.title ?? raw.name ?? raw.heading)
  if (title === '') return null
  const node = {
    id: typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : deriveId(title, used),
    title,
    brief: paragraph(raw.brief ?? raw.summary ?? raw.description ?? ''),
    children: [],
  }
  if (Array.isArray(raw.children) && depth < 2) {
    for (const child of raw.children) {
      const normalized = normalizeNode(child, language, used, depth + 1)
      if (normalized !== null) node.children.push(normalized)
    }
  }
  void language
  return node
}

/**
 * Merge a model's catalog against the seed, then normalize.
 *
 * The seed guarantees the documented coverage even when a model returns a thin
 * catalog; the model's own nodes are appended after it so repository-specific
 * structure is never discarded. A node is dropped only when it has no title,
 * which is the sole condition under which nothing can be rendered.
 *
 * @param rawNodes - the model's `catalog` array, or anything else.
 * @param language - the Wiki's language.
 * @returns the normalized catalog, always non-empty.
 */
export function normalizeCatalog(rawNodes, language) {
  const used = new Set()
  /** @type {ReturnType<typeof normalizeNode>[]} */
  const nodes = []
  const candidates = Array.isArray(rawNodes) ? rawNodes : []
  for (const raw of candidates) {
    const node = normalizeNode(raw, language, used, 0)
    if (node !== null) nodes.push(node)
  }
  if (nodes.length === 0) {
    for (const seed of CATALOG_SEED) {
      nodes.push({
        id: seed.id,
        title: localized(seed.title, language),
        brief: localized(seed.brief, language),
        children: [],
      })
      used.add(seed.id)
    }
  }
  return nodes
}

/**
 * Flatten a catalog into the ordered page list a generator walks.
 * @param catalog - the normalized catalog.
 * @returns one entry per node, parents before their children, with `parentId`.
 */
export function flattenCatalog(catalog) {
  /** @type {{ id: string, title: string, brief: string, path: string[], parentId: string | null, depth: number }[]} */
  const flat = []
  const walk = (nodes, parentId, trail, depth) => {
    for (const node of nodes) {
      flat.push({
        id: node.id,
        title: node.title,
        brief: node.brief,
        path: [...trail, node.title],
        parentId,
        depth,
      })
      walk(node.children ?? [], node.id, [...trail, node.title], depth + 1)
    }
  }
  walk(catalog, null, [], 0)
  return flat
}

/**
 * A citation parsed out of a page's prose.
 * @typedef {object} Citation
 * @property {string} path - workspace-relative file path.
 * @property {number} start - first line, 1-based.
 * @property {number} end - last line, inclusive.
 * @property {string} raw - the text as written, for replacement in the UI.
 */

/**
 * Parse `path:line` and `path:line-line` citations out of Markdown.
 *
 * Two forms are recognized, both of which read naturally in prose:
 * a backticked span, `` `src/a.ts:12-34` ``, which Markdown already renders as
 * code; and a list item, `- src/a.ts:12-34`, which is the shape the prompts ask
 * for in a trailing source section. Matching is deliberately strict about the
 * shape so that prose containing a colon and a number is not mistaken for a
 * citation.
 *
 * @param markdown - the page body.
 * @returns the citations in order of appearance, de-duplicated by (path, range).
 */
export function parseCitations(markdown) {
  if (typeof markdown !== 'string' || markdown === '') return []
  /** @type {Citation[]} */
  const found = []
  const seen = new Set()
  const record = (raw, path, startText, endText) => {
    const start = Number.parseInt(startText, 10)
    if (!Number.isFinite(start) || start < 1) return
    const end = endText === undefined ? start : Number.parseInt(endText, 10)
    if (!Number.isFinite(end) || end < start) return
    // A model that writes `src\a.ts` on Windows means the same file the reader
    // knows as `src/a.ts`; normalizing here keeps a cosmetic difference from
    // being reported as an invented source location.
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
    const key = `${normalized}:${start}-${end}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ path: normalized, start, end, raw })
  }

  // Form 1: a backticked span, with an optional `#L` prefix before the number,
  // which is how many editors and DSH itself write a line reference.
  const inline = /`([^`\n]+?):(?:#?L?)(\d+)(?:\s*[-–]\s*(?:#?L?)(\d+))?`/g
  for (const match of markdown.matchAll(inline)) {
    record(match[0], match[1], match[2], match[3])
  }

  // Form 2: a list item inside the sources section.
  const listed = /^\s*[-*]\s+`?([^\s`]+?):(?:#?L?)(\d+)(?:\s*[-–]\s*(?:#?L?)(\d+))?`?\s*$/gm
  for (const match of markdown.matchAll(listed)) {
    record(match[0].trim(), match[1], match[2], match[3])
  }
  return found
}

/**
 * Verify citations against the files a generation actually read.
 *
 * A citation survives only when its path was read during this generation and
 * its range fits inside that file. Everything else is returned as `unverified`
 * with a reason, so the UI can mark it and the report can count it rather than
 * presenting an invented path as evidence. This is the one place where the
 * Wiki's central claim — every conclusion is backed by a real location — is
 * enforced instead of requested.
 *
 * @param citations - the parsed citations.
 * @param sources - the ground truth.
 * @param sources.readPaths - workspace-relative paths the scan read.
 * @param sources.lineCounts - a `path -> line count` map for those paths.
 * @returns verified and unverified citations, each carrying its reason.
 */
export function verifyCitations(citations, sources) {
  const readPaths = sources.readPaths
  const lineCounts = sources.lineCounts ?? new Map()
  /** @type {(Citation & { verified: true })[]} */
  const verified = []
  /** @type {(Citation & { verified: false, reason: string })[]} */
  const unverified = []
  for (const citation of citations) {
    const path = citation.path.replace(/^\.\//, '')
    if (!readPaths.has(path)) {
      const reason = sources.knownPaths?.has?.(path) === true ? 'not-read' : 'unknown-path'
      unverified.push({
        ...citation,
        path,
        verified: false,
        reason:
          reason === 'not-read'
            ? 'the file exists but was not read during this generation'
            : 'no such file in the Wiki reading view',
      })
      continue
    }
    const lines = lineCounts.get(path)
    if (typeof lines === 'number' && lines > 0) {
      if (citation.start > lines) {
        unverified.push({ ...citation, path, verified: false, reason: `file has only ${lines} lines` })
        continue
      }
      const end = Math.min(citation.end, lines)
      verified.push({ ...citation, path, end, verified: true })
      continue
    }
    verified.push({ ...citation, path, verified: true })
  }
  return { verified, unverified }
}

/**
 * Count the lines in a text, treating a trailing newline as not starting a line.
 * @param text - the file's contents.
 * @returns the line count, at least 1 for non-empty text.
 */
export function countLines(text) {
  if (typeof text !== 'string' || text === '') return 0
  return text.split('\n').length
}

/**
 * Create the empty Wiki document for a workspace.
 * @param options - the seed facts.
 * @param options.workspace - `{ id, name, root }`.
 * @param options.language - the Wiki's language.
 * @param options.model - the `{ provider, model }` that will generate it, when known.
 * @param options.diagrams - whether diagrams were requested.
 * @returns a Wiki document with no pages.
 */
export function createWikiDocument(options) {
  return {
    version: WIKI_VERSION,
    createdAt: new Date().toISOString(),
    workspace: {
      id: options.workspace.id,
      name: options.workspace.name,
      root: options.workspace.root,
    },
    meta: {
      language: options.language,
      updatedAt: new Date().toISOString(),
      branch: null,
      commit: null,
      fileCount: 0,
      diagrams: options.diagrams === true,
      model: options.model ?? null,
      fingerprint: null,
      project: null,
      lastTask: null,
      // Stands in for the model's table of contents when that request fails; a
      // reader deserves to know the structure is generic rather than derived.
      catalogDegraded: false,
    },
    catalog: [],
    pages: [],
  }
}

/**
 * Read the module's view of a document's validity.
 *
 * A document from disk is untrusted: it may have been written by an older
 * version, edited by hand, or truncated by a crash. A shape error is reported
 * rather than repaired, because silently reinterpreting a Wiki is worse than
 * telling a user it cannot be read.
 *
 * @param value - the parsed JSON.
 * @returns the document, or a reason it cannot be used.
 */
export function validateWikiDocument(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'wiki.json is not an object' }
  }
  if (value.version !== WIKI_VERSION) {
    return { ok: false, reason: `unsupported wiki.json version ${JSON.stringify(value.version)}; this plugin writes version ${WIKI_VERSION}` }
  }
  // The workspace identity is not decoration: the store files a document by its
  // root, and a reader is shown which code state the pages describe. A document
  // missing either field is truncated or hand-edited, and serving it would mean
  // presenting pages whose provenance is unknown.
  if (value.workspace === null || typeof value.workspace !== 'object' || Array.isArray(value.workspace)) {
    return { ok: false, reason: 'wiki.json is missing its workspace identity' }
  }
  if (typeof value.workspace.root !== 'string' || value.workspace.root === '') {
    return { ok: false, reason: 'wiki.json is missing its workspace root' }
  }
  if (value.meta === null || typeof value.meta !== 'object' || Array.isArray(value.meta)) {
    return { ok: false, reason: 'wiki.json is missing its metadata' }
  }
  if (!Array.isArray(value.pages) || !Array.isArray(value.catalog)) {
    return { ok: false, reason: 'wiki.json is missing its catalog or pages array' }
  }
  for (const page of value.pages) {
    if (page === null || typeof page !== 'object') return { ok: false, reason: 'wiki.json holds a non-object page' }
    if (typeof page.id !== 'string' || typeof page.title !== 'string') {
      return { ok: false, reason: 'a wiki page is missing its id or title' }
    }
    if (!PAGE_STATUSES.includes(page.status)) {
      return { ok: false, reason: `page ${page.id} has unknown status ${JSON.stringify(page.status)}` }
    }
  }
  return { ok: true, document: value }
}

/**
 * Summarize a document for a client list or a tool result.
 *
 * Page *bodies* are the one thing this drops. The catalog tree, every page's
 * status, and each page's citation counts travel with the summary because the
 * tab draws all of that from a single round trip, while a page's Markdown can be
 * hundreds of kilobytes and is fetched only when a reader opens that page.
 *
 * @param document - the Wiki document.
 * @returns the metadata, counts, catalog, and per-page status rows.
 */
export function summarizeWiki(document) {
  const counts = { done: 0, failed: 0, waiting: 0, generating: 0, stopped: 0 }
  let verified = 0
  let unverified = 0
  /** @type {object[]} */
  const pages = []
  for (const page of document.pages) {
    counts[page.status] = (counts[page.status] ?? 0) + 1
    const sources = page.sources?.length ?? 0
    const bad = page.unverifiedSources?.length ?? 0
    verified += sources
    unverified += bad
    pages.push({
      id: page.id,
      title: page.title,
      brief: page.brief ?? '',
      path: page.path ?? [page.title],
      parentId: page.parentId ?? null,
      depth: page.depth ?? 0,
      status: page.status,
      sources,
      unverified: bad,
      error: page.error ?? null,
    })
  }
  return {
    version: document.version,
    workspace: document.workspace,
    meta: document.meta,
    counts: { ...counts, total: document.pages.length },
    citations: { verified, unverified },
    catalog: document.catalog,
    pages,
  }
}
