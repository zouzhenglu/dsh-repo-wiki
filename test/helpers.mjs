/**
 * Test doubles for the Wiki suite.
 *
 * The Wiki's value lives in behaviour that needs a filesystem and a model to
 * exercise: what it refuses to read, what it does when a page fails, and whether
 * a citation that names a file nobody read can survive into the finished guide.
 * Both dependencies are therefore replaced with in-memory doubles that are
 * deterministic — no timing, no network, no disk — so every assertion below is
 * about the Wiki rather than about the environment it ran in.
 *
 * @module dsh-repo-wiki/test/helpers
 */

import { posix } from 'node:path'

/**
 * A virtual filesystem that satisfies the reader's adapter contract.
 *
 * A tree entry is either a string (a text file's contents), an object with a
 * `__symlink` key (a symlink pointing at that relative path), or a directory
 * implied by a nested path. Sizes are the UTF-8 byte lengths, so a size-based
 * limit behaves the way it does on disk rather than the way `String.length`
 * would.
 */
export class VirtualFs {
  /**
   * @param tree - `{ 'relative/path': contents | { __symlink: 'target' } }`.
   */
  constructor(tree) {
    /** @type {Map<string, string>} */
    this.files = new Map()
    /** @type {Map<string, string>} */
    this.links = new Map()
    /** @type {Set<string>} */
    this.directories = new Set([''])
    /** @type {string[]} every readFile, in order, for assertions about what was read. */
    this.readLog = []
    for (const [path, value] of Object.entries(tree)) {
      const normalized = posix.normalize(path).replace(/^\.\//, '')
      if (normalized.startsWith('..')) throw new Error(`invalid test path ${path}`)
      const segments = normalized.split('/')
      for (let index = 1; index < segments.length; index += 1) {
        this.directories.add(segments.slice(0, index).join('/'))
      }
      if (typeof value === 'string') this.files.set(normalized, value)
      else if (value !== null && typeof value === 'object' && typeof value.__symlink === 'string') {
        this.links.set(normalized, value.__symlink)
      } else throw new Error(`unsupported test tree value at ${path}`)
    }
  }

  /**
   * @param {string} absolute - the absolute path.
   * @returns {string} the workspace-relative path.
   */
  relative(absolute) {
    const unified = absolute.replace(/\\/g, '/')
    const root = this.root.replace(/\\/g, '/')
    if (unified === root) return ''
    return unified.startsWith(`${root}/`) ? unified.slice(root.length + 1) : unified
  }

  /** @param {string} root - the root the adapter is bound to. */
  bind(root) {
    this.root = root.replace(/\\/g, '/')
    return this
  }

  /** {@inheritdoc} */
  async readdir(absolute) {
    const relative = this.relative(absolute)
    if (!this.directories.has(relative) && !this.#linkIsDirectory(relative)) {
      const error = new Error(`ENOENT: ${relative}`)
      error.code = 'ENOENT'
      throw error
    }
    const prefix = relative === '' ? '' : `${relative}/`
    const names = new Set()
    for (const path of [...this.files.keys(), ...this.links.keys()]) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf('/')
      names.add(slash === -1 ? rest : rest.slice(0, slash))
    }
    for (const directory of this.directories) {
      if (directory === '' || !directory.startsWith(prefix)) continue
      const rest = directory.slice(prefix.length)
      if (rest !== '') names.add(rest.split('/')[0])
    }
    return [...names]
  }

  /** {@inheritdoc} */
  async readFile(absolute) {
    const relative = this.relative(absolute)
    this.readLog.push(relative)
    const link = this.links.get(relative)
    if (link !== undefined) return this.readFile(`${this.root}/${link}`)
    const value = this.files.get(relative)
    if (value === undefined) {
      const error = new Error(`ENOENT: ${relative}`)
      error.code = 'ENOENT'
      throw error
    }
    return value
  }

  /** {@inheritdoc} */
  async lstat(absolute) {
    const relative = this.relative(absolute)
    if (this.links.has(relative)) {
      return {
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
        size: this.links.get(relative).length,
      }
    }
    if (this.files.has(relative)) {
      const value = this.files.get(relative)
      return {
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
        size: Buffer.byteLength(value, 'utf8'),
      }
    }
    if (this.directories.has(relative) || this.#linkIsDirectory(relative)) {
      return {
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        size: 0,
      }
    }
    const error = new Error(`ENOENT: ${relative}`)
    error.code = 'ENOENT'
    throw error
  }

  /** @param {string} relative - a candidate directory. */
  #linkIsDirectory(relative) {
    const target = this.links.get(relative)
    return target !== undefined && this.directories.has(target)
  }
}

/**
 * The filesystem adapter over a {@link VirtualFs}, with POSIX joining so tests
 * assert the same thing on every platform.
 * @param fs - the virtual filesystem.
 * @returns the adapter.
 */
export function virtualAdapter(fs) {
  return {
    readdir: (path) => fs.readdir(path),
    readFile: (path, encoding) => fs.readFile(path, encoding),
    lstat: (path) => fs.lstat(path),
  }
}

/** The POSIX joiner a virtual-root reader uses, so `/work` + `src` is `/work/src`. */
export const posixJoin = (root, segment) => (root === '' ? segment : posix.join(root, segment))

/**
 * A model client driven by a script, so a generation is reproducible.
 *
 * The handler receives the request and returns either a plain string (the
 * reply's text) or `{ text, toolCalls }`. A handler that throws simulates a
 * provider failure, which is what the retry and all-pages-failed paths assert.
 *
 * @param handler - `(request, callIndex) => string | { text?, toolCalls? }`.
 * @param [options] - `{ supportsTools }`.
 * @returns the model client plus its recorded requests.
 */
export function createScriptedModel(handler, options = {}) {
  /** @type {object[]} */
  const requests = []
  return {
    supportsTools: options.supportsTools !== false,
    requests,
    async complete(request) {
      const index = requests.length
      requests.push(request)
      const reply = await handler(request, index)
      if (typeof reply === 'string') return { text: reply, toolCalls: [] }
      return { text: reply.text ?? '', toolCalls: reply.toolCalls ?? [] }
    },
  }
}

/**
 * Build a `WorkspaceReader` over a virtual filesystem.
 * @param tree - the tree, as for {@link VirtualFs}.
 * @param [options] - reader options plus `{ readerOptions }` passthrough.
 * @returns `{ reader, fs }`.
 */
export async function virtualReader(tree, options = {}) {
  const { WorkspaceReader } = await import('../lib/wiki/workspace.js')
  const fs = new VirtualFs(tree).bind('/work')
  const reader = new WorkspaceReader({
    root: '/work',
    fs: virtualAdapter(fs),
    join: posixJoin,
    ...options,
  })
  return { reader, fs }
}

/**
 * A tiny repository used by more than one suite: a manifest, a source tree, a
 * nested module, a dependency directory that must never be read, a build output
 * directory, a gitignored log, a dotenv and a credential file, and a symlink.
 */
export const SAMPLE_TREE = Object.freeze({
  'package.json': '{"name":"sample","version":"1.0.0","main":"src/main.js"}',
  'README.md': '# Sample\n\nA sample project.',
  '.gitignore': '*.log\nbuild/\n',
  'src/main.js': [
    'import { run } from "./run.js"',
    'const config = loadConfig()',
    'export function main() { return run(config) }',
  ].join('\n'),
  'src/run.js': ['export function run(config) {', '  return config.value * 2', '}'].join('\n'),
  'src/util/strings.js': 'export const upper = (s) => s.toUpperCase()',
  'src/util/strings.log': 'a runtime log that must not be read',
  'node_modules/dep/index.js': 'export const dep = 1',
  'build/out.js': 'compiled output that must not be read',
  '.env': 'API_TOKEN=super-secret',
  'config/credentials.json': '{"password":"hunter2"}',
  'config/tokenService.js': 'export function tokenService(token) { return token }',
  'docs/guide.md': '# Guide\n\nHow it works.',
  'link-to-src': { __symlink: 'src' },
  'src/big.txt': 'x'.repeat(4096),
})
