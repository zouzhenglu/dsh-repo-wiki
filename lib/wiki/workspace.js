/**
 * The Wiki's workspace reading view.
 *
 * This is the enforcement half of the scan policy in `policy.js`, and it exists
 * because ZCode's Wiki does not hand the model a pre-built file list: the model
 * expands directories one layer at a time and reads files on demand, and every
 * one of those operations is filtered by the secret, VCS, dependency, build,
 * cache and symlink rules. Modelling that faithfully needs a reader object that
 * both walks a real filesystem and refuses — with a stable, explainable reason —
 * rather than a function that returns an array.
 *
 * Every method takes a workspace-relative, `/`-separated path. The reader owns
 * three invariants:
 *
 * 1. **Containment.** A path is resolved against the root and re-checked after
 *    resolution, so `../../etc/passwd`, a Windows drive-absolute path, and a
 *    symlink that leaves the workspace are all refused rather than followed.
 * 2. **No symlink traversal.** A symlink is never entered, never read, and
 *    never resolved through; it is reported as excluded, which is what ZCode
 *    documents.
 * 3. **Bounded work.** Reads are capped by byte size and enumeration is capped
 *    by file count, so an enormous repository degrades into a reported
 *    truncation instead of an unbounded model context.
 *
 * @module dsh-repo-wiki/wiki/workspace
 */

import { classifyDirectory, classifyFile, extensionOf } from './policy.js'
import { createIgnoreResolver, GitignoreLayer, parseGitignore } from './gitignore.js'

/** The `.gitignore` basename, the only ignore source this reader consults. */
const GITIGNORE = '.gitignore'

/**
 * A refusal raised by the reader. It carries a stable `code` so the model-facing
 * tool can teach the boundary, and so tests can assert the exact rule that
 * fired rather than a message string.
 */
export class WikiAccessError extends Error {
  /**
   * @param code - the stable refusal code.
   * @param message - a human- and model-readable explanation.
   */
  constructor(code, message) {
    super(message)
    /** @type {string} */
    this.name = 'WikiAccessError'
    /** @type {string} */
    this.code = code
  }
}

/**
 * The filesystem surface the reader needs. `node:fs/promises` satisfies it
 * directly, and tests supply a virtual tree instead.
 * @typedef {object} WikiFsAdapter
 * @property {(path: string) => Promise<string[]>} readdir - names inside a directory.
 * @property {(path: string) => Promise<string>} readFile - UTF-8 file contents.
 * @property {(path: string) => Promise<{ isDirectory: () => boolean, isFile: () => boolean, isSymbolicLink: () => boolean, size: number }>} lstat - link-aware stat.
 */

/**
 * Normalize a caller-supplied relative path into the reader's canonical form.
 * Rejects absolute paths, drive letters, UNC prefixes and any `.`/`..` segment
 * before containment is ever checked, so the check cannot be bypassed by
 * encoding.
 * @param input - the caller's path.
 * @returns the canonical `/`-separated relative path, `''` for the root.
 * @throws {WikiAccessError} when the path escapes or is absolute.
 */
export function normalizeRelativePath(input) {
  if (typeof input !== 'string') {
    throw new WikiAccessError('invalid-path', 'path must be a string')
  }
  const unified = input.replace(/\\/g, '/').trim()
  if (unified === '' || unified === '.' || unified === './') return ''
  if (/^[a-zA-Z]:/.test(unified)) {
    throw new WikiAccessError('invalid-path', `path must be workspace-relative, got drive-absolute ${JSON.stringify(input)}`)
  }
  if (unified.startsWith('//') || unified.startsWith('/')) {
    throw new WikiAccessError('invalid-path', `path must be workspace-relative, got absolute ${JSON.stringify(input)}`)
  }
  const segments = []
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      throw new WikiAccessError('invalid-path', `path escapes the workspace: ${JSON.stringify(input)}`)
    }
    if (segment.includes('\0')) {
      throw new WikiAccessError('invalid-path', 'path contains a NUL byte')
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/**
 * One directory entry as the model sees it.
 * @typedef {object} WikiEntry
 * @property {string} name - the entry's basename.
 * @property {string} path - workspace-relative path.
 * @property {'file' | 'directory' | 'symlink'} type - what the entry is.
 * @property {number} [size] - byte size for regular files.
 * @property {false | { reason: string, detail: string }} [excluded] - the refusal,
 * or `false` when the entry is readable. Excluded entries are listed because a
 * guide that cannot say "build output lives here" is worse than one that can;
 * their *contents* are never available.
 */

/** A message table for the reasons the reader can produce, kept in one place. */
const REASON_LABELS = Object.freeze({
  'excluded-directory': 'excluded directory (dependencies, build output, cache or local state)',
  'local-state': 'local operating-system or editor state',
  'binary-extension': 'binary content excluded from the Wiki view',
  'secret-extension': 'credential material excluded from the Wiki view',
  'secret-name': 'filename suggests credential material and is not source code',
  'gitignored': 'excluded by .gitignore',
  symlink: 'symbolic links are not followed',
  'outside-workspace': 'resolves outside the workspace',
  'not-found': 'no such path',
  'not-a-file': 'path is not a regular file',
  tooLarge: 'file exceeds the Wiki read limit',
})

/**
 * Render a refusal into the one-line explanation a tool result carries.
 * @param reason - the stable reason code.
 * @param detail - the rule-specific detail.
 * @returns the explanation.
 */
export function describeReason(reason, detail) {
  const label = REASON_LABELS[reason] ?? reason
  return detail === undefined || detail === '' ? label : `${label} — ${detail}`
}

/**
 * A policy-enforcing, cached view over one workspace root.
 */
export class WorkspaceReader {
  /**
   * @param options - the reader's construction inputs.
   * @param options.root - absolute workspace root.
   * @param options.fs - the filesystem adapter.
   * @param options.join - path joiner for the host platform.
   * @param [options.excludedDirectories] - extra directory names to refuse.
   * @param [options.excludedExtensions] - extra file suffixes to refuse.
   * @param [options.excludedFiles] - extra basenames to refuse.
   * @param [options.sourceExtensions] - extra extensions to count as source code.
   * @param [options.useGitignore] - whether to honour `.gitignore` (default true).
   * @param [options.nestedGitignore] - whether nested `.gitignore` files apply (default true).
   */
  constructor(options) {
    /** @type {string} */
    this.root = options.root
    /** @type {WikiFsAdapter} */
    this.fs = options.fs
    /** @type {(root: string, segment: string) => string} */
    this.join = options.join
    /** @type {object} */
    this.policyOptions = {
      excludedDirectories: options.excludedDirectories ?? [],
      excludedExtensions: options.excludedExtensions ?? [],
      excludedFiles: options.excludedFiles ?? [],
      sourceExtensions: options.sourceExtensions ?? [],
    }
    /** @type {boolean} */
    this.useGitignore = options.useGitignore !== false
    /** @type {boolean} */
    this.nestedGitignore = options.nestedGitignore !== false
    /** @type {Map<string, string>} content cache, so a re-read costs nothing. */
    this.#content = new Map()
    /** @type {Map<string, GitignoreLayer[]>} per-directory layer cache. */
    this.#layerCache = new Map()
    /** @type {Set<string>} paths this reader has read, for the source-citation allowlist. */
    this.#read = new Set()
    /** @type {Map<string, string>} refusal memo, so repeated probes stay cheap. */
    this.#refusals = new Map()
  }

  /** @type {Map<string, string>} */
  #content
  /** @type {Map<string, GitignoreLayer[]>} */
  #layerCache
  /** @type {Set<string>} */
  #read
  /** @type {Map<string, string>} */
  #refusals

  /**
   * The set of workspace-relative paths this reader has successfully read. A
   * generated source citation is validated against it, which is what keeps a
   * hallucinated path out of the finished Wiki.
   * @returns {ReadonlySet<string>} the read set.
   */
  get readPaths() {
    return this.#read
  }

  /** @returns {number} the number of bytes currently cached. */
  get cachedBytes() {
    let total = 0
    for (const text of this.#content.values()) total += text.length
    return total
  }

  /**
   * Resolve a relative path to an absolute one inside the root.
   * @param relativePath - the canonical relative path.
   * @returns the absolute path.
   */
  absolute(relativePath) {
    if (relativePath === '') return this.root
    return this.join(this.root, relativePath)
  }

  /**
   * Load and cache the `.gitignore` layers that apply to a directory.
   *
   * Layers are collected from the root down, which is what makes a nested
   * file's deeper rules win: {@link createIgnoreResolver} orders by depth.
   * Only directories on the path are consulted, so a repository with thousands
   * of nested ignore files pays for the ones it actually uses.
   * @param relativeDir - the canonical directory path.
   * @returns the layers in scope.
   */
  async #layersFor(relativeDir) {
    if (!this.useGitignore) return []
    const cached = this.#layerCache.get(relativeDir)
    if (cached !== undefined) return cached

    const segments = relativeDir === '' ? [] : relativeDir.split('/')
    const chain = []
    for (let depth = 0; depth <= segments.length; depth += 1) {
      const dir = segments.slice(0, depth).join('/')
      if (depth > 0 && !this.nestedGitignore) break
      const text = await this.#readGitignore(dir)
      if (text !== null) chain.push(new GitignoreLayer(parseGitignore(text), dir))
    }
    this.#layerCache.set(relativeDir, chain)
    return chain
  }

  /**
   * Read one directory's `.gitignore`, tolerating its absence and its
   * unreadability. An ignore file that cannot be read must not fail a
   * generation, so the failure is treated as "no rules here".
   * @param relativeDir - the canonical directory path.
   * @returns the file's text, or null.
   */
  async #readGitignore(relativeDir) {
    const path = this.absolute(relativeDir === '' ? GITIGNORE : `${relativeDir}/${GITIGNORE}`)
    try {
      return await this.fs.readFile(path, 'utf8')
    } catch {
      return null
    }
  }

  /**
   * The ignore resolver in force for a directory.
   * @param relativeDir - the canonical directory path.
   * @returns the resolver predicate.
   */
  async ignoreFor(relativeDir) {
    const layers = await this.#layersFor(relativeDir)
    return createIgnoreResolver(layers)
  }

  /**
   * Classify one path against every rule, without touching file contents.
   * @param relativePath - the canonical relative path.
   * @param isDirectory - whether the caller believes this is a directory.
   * @returns `null` when readable, otherwise `{ reason, detail }`.
   */
  async classify(relativePath, isDirectory) {
    if (relativePath === '') return null
    const segments = relativePath.split('/')
    const basename = segments[segments.length - 1]

    // Every ancestor must be enterable, so an excluded parent excludes the child.
    for (let end = 1; end < segments.length; end += 1) {
      const ancestor = segments.slice(0, end).join('/')
      const ancestorName = segments[end - 1]
      const directoryRefusal = classifyDirectory(ancestorName, this.policyOptions)
      if (directoryRefusal !== null) return directoryRefusal
      if (this.#refusals.has(ancestor)) {
        const reason = this.#refusals.get(ancestor)
        return { reason: 'excluded-directory', detail: `${ancestor} is excluded (${reason})` }
      }
    }

    if (isDirectory) {
      return classifyDirectory(basename, this.policyOptions)
    }
    // A read aimed at an excluded directory should name the exclusion rather
    // than complain that it is not a file: the exclusion is the fact the model
    // needs, and "not a file" invites it to try a different spelling.
    const directoryRefusal = classifyDirectory(basename, this.policyOptions)
    if (directoryRefusal !== null) return directoryRefusal
    const fileRefusal = classifyFile(basename, this.policyOptions)
    if (fileRefusal !== null) return fileRefusal

    const parent = segments.slice(0, -1).join('/')
    const ignore = await this.ignoreFor(parent)
    if (ignore(relativePath, isDirectory)) {
      return { reason: 'gitignored', detail: `matched a rule in a ${GITIGNORE} file` }
    }
    return null
  }

  /**
   * List one directory, one layer at a time, exactly as the model asks for it.
   *
   * Excluded entries are reported with their refusal so the model learns the
   * boundary, but a symlink is reported as a symlink and an excluded
   * directory's children are never enumerated.
   *
   * @param input - the workspace-relative directory path, or `''`/`'.'` for the root.
   * @returns the listing with readable and excluded entries separated.
   * @throws {WikiAccessError} when the directory itself is not listable.
   */
  async list(input) {
    const relativeDir = normalizeRelativePath(input)
    const refusal = await this.classify(relativeDir, true)
    if (refusal !== null) {
      const code = refusal.reason === 'gitignored' ? 'excluded' : refusal.reason
      throw new WikiAccessError(code, `${relativeDir || '.'} is not in the Wiki reading view: ${describeReason(refusal.reason, refusal.detail)}`)
    }

    const absolute = this.absolute(relativeDir)

    // The directory itself is stat'ed before it is entered. Without this a path
    // that names a symlink would be listed through the link, which is the one
    // thing the reading view promises never to do — the root is exempt because
    // the workspace root is the scan's own identity, not a path within it.
    if (relativeDir !== '') {
      let stats
      try {
        stats = await this.fs.lstat(absolute)
      } catch (error) {
        if (error?.code === 'ENOENT') throw new WikiAccessError('not-found', `no such directory: ${relativeDir}`)
        throw new WikiAccessError('unreadable', `cannot stat ${relativeDir}: ${error?.message ?? String(error)}`)
      }
      if (stats.isSymbolicLink()) {
        throw new WikiAccessError('symlink', `${relativeDir} is a symbolic link; the Wiki view does not follow links`)
      }
      if (!stats.isDirectory()) {
        throw new WikiAccessError('not-a-directory', `${relativeDir} is not a directory; read it instead`)
      }
    }

    let names
    try {
      names = await this.fs.readdir(absolute)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new WikiAccessError('not-found', `no such directory: ${relativeDir || '.'}`)
      throw new WikiAccessError('unreadable', `cannot list ${relativeDir || '.'}: ${error?.message ?? String(error)}`)
    }

    /** @type {WikiEntry[]} */
    const entries = []
    for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
      if (name === GITIGNORE) continue
      const path = relativeDir === '' ? name : `${relativeDir}/${name}`
      let stats
      try {
        stats = await this.fs.lstat(this.absolute(path))
      } catch {
        continue
      }
      if (stats.isSymbolicLink()) {
        entries.push({ name, path, type: 'symlink', excluded: { reason: 'symlink', detail: describeReason('symlink') } })
        continue
      }
      const isDirectory = stats.isDirectory()
      const entry = {
        name,
        path,
        type: isDirectory ? 'directory' : 'file',
        ...(isDirectory ? {} : { size: stats.size }),
      }
      const entryRefusal = isDirectory
        ? await this.#classifyDirectoryEntry(path, name)
        : await this.classify(path, false)
      if (entryRefusal !== null) {
        if (isDirectory) this.#refusals.set(path, describeReason(entryRefusal.reason, entryRefusal.detail))
        entry.excluded = entryRefusal
      } else {
        entry.excluded = false
      }
      entries.push(entry)
    }
    return { path: relativeDir, entries }
  }

  /**
   * Classify a child directory, honouring both the name rules and the ignore
   * files, since a directory can be excluded by a pattern as well as by name.
   * @param path - the child's workspace-relative path.
   * @param name - the child's basename.
   * @returns the refusal, or null.
   */
  async #classifyDirectoryEntry(path, name) {
    const byName = classifyDirectory(name, this.policyOptions)
    if (byName !== null) return byName
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const ignore = await this.ignoreFor(parent)
    if (ignore(path, true)) return { reason: 'gitignored', detail: `matched a rule in a ${GITIGNORE} file` }
    return null
  }

  /**
   * Read one file's text, subject to every rule.
   * @param input - the workspace-relative file path.
   * @param options - read options.
   * @param [options.maxBytes] - the byte ceiling for this read.
   * @returns the file's text and the facts the caller must report.
   * @throws {WikiAccessError} when the file is excluded, missing, or too large.
   */
  async read(input, options = {}) {
    const relativePath = normalizeRelativePath(input)
    if (relativePath === '') throw new WikiAccessError('not-a-file', 'the workspace root is a directory, not a file')

    const cached = this.#content.get(relativePath)
    if (cached !== undefined) {
      return { path: relativePath, text: cached, bytes: Buffer.byteLength(cached, 'utf8'), truncated: false, cached: true }
    }

    const refusal = await this.classify(relativePath, false)
    if (refusal !== null) {
      throw new WikiAccessError(refusal.reason === 'gitignored' ? 'excluded' : refusal.reason, `${relativePath} is not in the Wiki reading view: ${describeReason(refusal.reason, refusal.detail)}`)
    }

    const absolute = this.absolute(relativePath)
    let stats
    try {
      stats = await this.fs.lstat(absolute)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new WikiAccessError('not-found', `no such file: ${relativePath}`)
      throw new WikiAccessError('unreadable', `cannot stat ${relativePath}: ${error?.message ?? String(error)}`)
    }
    if (stats.isSymbolicLink()) {
      throw new WikiAccessError('symlink', `${relativePath} is a symbolic link; the Wiki view does not follow links`)
    }
    if (stats.isDirectory()) {
      throw new WikiAccessError('not-a-file', `${relativePath} is a directory; list it instead`)
    }
    const maxBytes = options.maxBytes ?? 512 * 1024
    if (stats.size > maxBytes) {
      throw new WikiAccessError('tooLarge', `${relativePath} is ${stats.size} bytes, over the ${maxBytes}-byte Wiki read limit`)
    }

    let text
    try {
      text = await this.fs.readFile(absolute, 'utf8')
    } catch (error) {
      throw new WikiAccessError('unreadable', `cannot read ${relativePath}: ${error?.message ?? String(error)}`)
    }
    // A NUL byte in the first block is the reliable signal that a suffix rule
    // missed a binary, so it is refused here rather than sent to a model.
    const probe = text.slice(0, 4096)
    if (probe.includes('\u0000')) {
      throw new WikiAccessError('binary-extension', `${relativePath} contains binary data and is not in the Wiki reading view`)
    }
    this.#content.set(relativePath, text)
    this.#read.add(relativePath)
    return { path: relativePath, text, bytes: Buffer.byteLength(text, 'utf8'), truncated: false, cached: false }
  }

  /**
   * Build a bounded repository outline: directories expanded breadth-first up
   * to a depth and file budget.
   *
   * This is the deterministic fallback for deployments whose model cannot drive
   * a tool loop. It reads no file contents — a caller that wants the analysis
   * prompt filled follows up with {@link read} on the entries it selects — so
   * it preserves the property that the model chooses what to read.
   *
   * @param options - bounds.
   * @param [options.maxDepth] - deepest directory level to expand (default 3).
   * @param [options.maxFiles] - file budget (default 4000).
   * @param [options.maxEntriesPerDirectory] - per-directory listing cap (default 60).
   * @returns the outline, the full relative path of every file it listed, and
   * whether any budget truncated it. `lines` is what a prompt shows; `paths` is
   * what a caller retrieves evidence by, and the two differ because an indented
   * tree is readable while a bare basename is not a path.
   */
  async outline(options = {}) {
    const maxDepth = options.maxDepth ?? 3
    const maxFiles = options.maxFiles ?? 4000
    const maxEntriesPerDirectory = options.maxEntriesPerDirectory ?? 60
    const lines = []
    /** @type {string[]} */
    const paths = []
    const excludedNotes = []
    let files = 0
    let truncated = false

    /** Breadth-first so shallow structure survives a tight budget. */
    const queue = [{ path: '', depth: 0 }]
    while (queue.length > 0) {
      const current = queue.shift()
      if (current.depth > maxDepth) {
        truncated = true
        continue
      }
      let listing
      try {
        listing = await this.list(current.path)
      } catch {
        continue
      }
      const indent = '  '.repeat(current.depth)
      const visible = listing.entries.filter((entry) => entry.excluded === false)
      const hidden = listing.entries.filter((entry) => entry.excluded !== false)
      for (const entry of hidden) {
        excludedNotes.push(`${entry.path} — ${describeReason(entry.excluded.reason, entry.excluded.detail)}`)
      }
      const bounded = visible.slice(0, maxEntriesPerDirectory)
      if (visible.length > bounded.length) truncated = true
      for (const entry of bounded) {
        if (entry.type === 'directory') {
          lines.push(`${indent}${entry.name}/`)
          queue.push({ path: entry.path, depth: current.depth + 1 })
          continue
        }
        if (files >= maxFiles) {
          truncated = true
          continue
        }
        files += 1
        paths.push(entry.path)
        lines.push(`${indent}${entry.name}`)
      }
    }
    return { lines, paths, excludedNotes, files, truncated }
  }

  /**
   * A cheap fingerprint of the readable file set and each file's size.
   *
   * ZCode refreshes a Wiki only when the code actually changed, and comparing
   * a fingerprint reuses the same reading view that generated the Wiki, so a
   * change to an excluded file does not trigger a refresh.
   * @param options - bounds, as for {@link outline}.
   * @returns the fingerprint and the number of files it covers.
   */
  async fingerprint(options = {}) {
    const maxFiles = options.maxFiles ?? 20000
    const parts = []
    let files = 0
    let truncated = false
    const queue = ['']
    while (queue.length > 0) {
      const current = queue.shift()
      let listing
      try {
        listing = await this.list(current)
      } catch {
        continue
      }
      for (const entry of listing.entries) {
        if (entry.excluded !== false) continue
        if (entry.type === 'directory') {
          queue.push(entry.path)
          continue
        }
        if (files >= maxFiles) {
          truncated = true
          continue
        }
        files += 1
        parts.push(`${entry.path}:${entry.size ?? 0}`)
      }
    }
    parts.sort()
    return { fingerprint: `${files}:${hashString(parts.join('\n'))}`, files, truncated }
  }
}

/**
 * A small, stable, dependency-free string hash (FNV-1a, 64-bit via two 32-bit
 * lanes). It only ever needs to answer "did this change", so a cryptographic
 * digest would add cost without adding an answer.
 * @param input - the text to hash.
 * @returns sixteen lowercase hex digits.
 */
export function hashString(input) {
  let low = 0x811c9dc5
  let high = 0x01000193
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    low ^= code & 0xff
    low = Math.imul(low, 0x01000193) >>> 0
    high ^= (code >>> 8) ^ (code & 0xff)
    high = Math.imul(high, 0x85ebca6b) >>> 0
  }
  return (high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')).slice(0, 16)
}

/**
 * Build the default adapter over `node:fs/promises`.
 * @param fsModule - the imported `node:fs/promises` module.
 * @returns the adapter.
 */
export function createNodeFsAdapter(fsModule) {
  return {
    readdir: (path) => fsModule.readdir(path),
    readFile: (path, encoding) => fsModule.readFile(path, encoding),
    lstat: (path) => fsModule.lstat(path),
  }
}

export { extensionOf }
