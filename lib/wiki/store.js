/**
 * Where a generated Wiki lives.
 *
 * ZCode keeps the result outside the repository, one JSON document per
 * workspace, under a hash of the workspace's identity:
 *
 * ```text
 * <user data>/repo-wiki/<workspace key>/wiki.json
 * ```
 *
 * Keeping it out of the repository is the point of the design, not an
 * implementation detail: a Wiki is a *reading aid* for whoever generated it, it
 * is rewritten whenever the code changes, and different people will generate it
 * in different languages. Committing it would turn all of that into repository
 * churn, so this module reproduces the layout and never writes inside the
 * workspace.
 *
 * The store owns four further properties:
 *
 * - **A missing Wiki is not an error.** Most workspaces have none, so `load`
 *   answers null and every caller treats absence as the normal first-run state.
 * - **A corrupt Wiki is not a crash.** A document that fails validation is
 *   reported as unreadable with its reason, so the UI can offer to regenerate
 *   instead of rendering a half-parsed page.
 * - **A write is atomic.** A crash mid-save must not leave a workspace with a
 *   Wiki that cannot be read, so bytes land in a temporary sibling and are
 *   renamed into place.
 * - **The last good version is kept.** A regeneration overwrites the live
 *   document page by page; the version that was there before it is copied to
 *   `wiki.backup.json`, so a mis-clicked or failed run can be restored.
 *
 * @module dsh-repo-wiki/wiki/store
 */

import { validateWikiDocument, WIKI_VERSION } from './model.js'
import { hashString } from './workspace.js'

/** The directory name inside the plugin's data directory. */
export const STORE_DIRNAME = 'repo-wiki'

/** The one document name, matching ZCode's. */
export const WIKI_FILENAME = 'wiki.json'

/**
 * The directory holding archived versions, one JSON document per version.
 *
 * A regeneration replaces `wiki.json` page by page, so without history a
 * mis-clicked run, a failed run or a crash destroys a Wiki that took minutes to
 * produce. Every full run archives the version it is about to replace here; the
 * service keeps the recent ones for three days, so a string of empty or wrong
 * generations still leaves an older good version recoverable.
 */
export const HISTORY_DIRNAME = 'history'

/**
 * The name of the single-slot copy written by older versions of this plugin.
 *
 * Kept only so an upgrade can migrate it into {@link HISTORY_DIRNAME}; nothing
 * writes it any more.
 */
export const WIKI_BACKUP_FILENAME = 'wiki.backup.json'

/**
 * The shape of a history entry id: `<13-digit epoch ms>-<done>of<total>-<12-hex signature>`.
 *
 * The timestamp prefix makes the directory listing sortable without reading a
 * document, the counts give the index its quality summary, and the signature
 * lets an identical document be recognised instead of archived twice.
 */
const HISTORY_ID_PATTERN = /^\d{13}-\d+of\d+-[0-9a-f]{12}$/

/**
 * Derive the workspace key a Wiki is filed under.
 *
 * The key must be stable across restarts and across the two spellings of the
 * same Windows directory, so the path is normalized before hashing: separators
 * unified, a trailing separator removed, and the whole thing case-folded on
 * Windows, where `D:\Agents\app` and `d:\agents\app` are one directory.
 *
 * @param workspaceRoot - the absolute workspace root.
 * @param platform - `process.platform`, so the test suite can pin both behaviours.
 * @returns a 16-hex-digit key.
 */
export function workspaceKey(workspaceRoot, platform = process.platform) {
  let normalized = String(workspaceRoot).replace(/\\/g, '/').replace(/\/+$/, '')
  if (platform === 'win32') normalized = normalized.toLowerCase()
  return hashString(normalized)
}

/**
 * A JSON-document store over a filesystem adapter.
 */
export class WikiStore {
  /**
   * @param options - construction inputs.
   * @param options.dataDir - absolute directory this plugin owns.
   * @param options.fs - `{ readFile, writeFile, mkdir, rm, rename, readdir }`.
   * @param options.join - path joiner.
   * @param [options.platform] - the platform used for key normalization.
   */
  constructor(options) {
    /** @type {string} */
    this.dataDir = options.dataDir
    /** @type {any} */
    this.fs = options.fs
    /** @type {(root: string, segment: string) => string} */
    this.join = options.join
    /** @type {string} */
    this.platform = options.platform ?? process.platform
  }

  /** @returns {string} the absolute directory holding every workspace's Wiki. */
  get root() {
    return this.join(this.dataDir, STORE_DIRNAME)
  }

  /**
   * The absolute path of one workspace's document.
   * @param workspaceRoot - the absolute workspace root.
   * @returns the path, whether or not the file exists.
   */
  pathFor(workspaceRoot) {
    return this.join(this.root, workspaceKey(workspaceRoot, this.platform), WIKI_FILENAME)
  }

  /**
   * The absolute path of one workspace's previous-version copy.
   * @param workspaceRoot - the absolute workspace root.
   * @returns the path, whether or not the file exists.
   */
  backupPathFor(workspaceRoot) {
    return this.join(this.root, workspaceKey(workspaceRoot, this.platform), WIKI_BACKUP_FILENAME)
  }

  /**
   * Load one workspace's Wiki.
   * @param workspaceRoot - the absolute workspace root.
   * @returns a discriminated result: `{ status: 'ok', document }`,
   * `{ status: 'absent' }`, or `{ status: 'invalid', reason }`.
   */
  async load(workspaceRoot) {
    return this.#read(this.pathFor(workspaceRoot), workspaceRoot)
  }

  /**
   * Load one workspace's previous-version copy (legacy single slot).
   *
   * Validation is the same as for the live document, including the workspace
   * check: a copy carried in from another directory must not be offered as
   * this workspace's history.
   * @param workspaceRoot - the absolute workspace root.
   * @returns the same discriminated result as {@link load}.
   */
  async loadBackup(workspaceRoot) {
    return this.#read(this.backupPathFor(workspaceRoot), workspaceRoot)
  }

  /**
   * The absolute directory holding one workspace's archived versions.
   * @param workspaceRoot - the absolute workspace root.
   * @returns the path, whether or not it exists.
   */
  historyDirFor(workspaceRoot) {
    return this.join(this.root, workspaceKey(workspaceRoot, this.platform), HISTORY_DIRNAME)
  }

  /**
   * The absolute path of one archived version.
   * @param workspaceRoot - the absolute workspace root.
   * @param id - a history id as returned by {@link listHistory}.
   * @returns the path, whether or not the file exists.
   * @throws {Error} when the id does not match the generated shape, which is
   *   what keeps a caller-supplied id from escaping the directory.
   */
  historyPathFor(workspaceRoot, id) {
    if (!HISTORY_ID_PATTERN.test(String(id))) {
      throw new Error(`invalid history id ${JSON.stringify(id)}`)
    }
    return this.join(this.historyDirFor(workspaceRoot), `${id}.json`)
  }

  /**
   * Write one archived version atomically.
   * @param document - the document to archive.
   * @param id - the history id naming it.
   * @returns the path written.
   */
  async saveHistory(document, id) {
    return this.#write(this.historyPathFor(document.workspace.root, id), document)
  }

  /**
   * List one workspace's archived versions, newest first.
   *
   * The summary is derived from the file name alone, so rendering a history
   * list never reads a page body. A file whose name does not match the id shape
   * is ignored rather than failing the listing.
   * @param workspaceRoot - the absolute workspace root.
   * @returns `{ id, archivedAt, done, total }` entries, newest first.
   */
  async listHistory(workspaceRoot) {
    let names
    try {
      names = await this.fs.readdir(this.historyDirFor(workspaceRoot))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    /** @type {{ id: string, archivedAt: string, done: number, total: number }[]} */
    const entries = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -'.json'.length)
      const match = /^(\d{13})-(\d+)of(\d+)-([0-9a-f]{12})$/.exec(id)
      if (match === null) continue
      entries.push({
        id,
        archivedAt: new Date(Number(match[1])).toISOString(),
        done: Number(match[2]),
        total: Number(match[3]),
      })
    }
    entries.sort((left, right) => right.archivedAt.localeCompare(left.archivedAt) || right.id.localeCompare(left.id))
    return entries
  }

  /**
   * Load and validate one archived version.
   * @param workspaceRoot - the absolute workspace root.
   * @param id - the history id.
   * @returns the same discriminated result as {@link load}.
   */
  async loadHistory(workspaceRoot, id) {
    return this.#read(this.historyPathFor(workspaceRoot, id), workspaceRoot)
  }

  /**
   * Delete one archived version.
   * @param workspaceRoot - the absolute workspace root.
   * @param id - the history id.
   * @returns whether a file was removed.
   */
  async removeHistory(workspaceRoot, id) {
    try {
      await this.fs.rm(this.historyPathFor(workspaceRoot, id), { force: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete one workspace's legacy single-slot copy.
   * @param workspaceRoot - the absolute workspace root.
   * @returns whether a file was removed.
   */
  async removeBackup(workspaceRoot) {
    try {
      await this.fs.rm(this.backupPathFor(workspaceRoot), { force: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * Enforce a history's retention window and size cap.
   *
   * Expired versions always go. While trimming to the cap, incomplete versions
   * are dropped before complete ones, and the oldest first within each group:
   * a string of stopped or failed runs must not push a finished Wiki out of the
   * window while partial output stays behind.
   *
   * @param workspaceRoot - the absolute workspace root.
   * @param options - the purge policy.
   * @param [options.nowMs] - the clock, in epoch milliseconds.
   * @param [options.retentionMs] - how long a version stays restorable.
   * @param [options.maxEntries] - the maximum number of versions to keep.
   * @returns `{ kept, removed }` counts.
   */
  async purgeHistory(workspaceRoot, options = {}) {
    let entries
    try {
      entries = await this.listHistory(workspaceRoot)
    } catch {
      return { kept: 0, removed: 0 }
    }
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
    const retentionMs = options.retentionMs
    const maxEntries = options.maxEntries
    const expired = []
    const survivors = []
    for (const entry of entries) {
      const tooOld = typeof retentionMs === 'number'
        && retentionMs >= 0
        && nowMs - Date.parse(entry.archivedAt) > retentionMs
      if (tooOld) expired.push(entry)
      else survivors.push(entry)
    }
    if (typeof maxEntries === 'number' && maxEntries >= 0) {
      while (survivors.length > maxEntries) {
        let index = -1
        for (let cursor = survivors.length - 1; cursor >= 0; cursor -= 1) {
          if (survivors[cursor].done < survivors[cursor].total) {
            index = cursor
            break
          }
        }
        if (index === -1) index = survivors.length - 1
        expired.push(...survivors.splice(index, 1))
      }
    }
    for (const entry of expired) {
      try {
        await this.fs.rm(this.historyPathFor(workspaceRoot, entry.id), { force: true })
      } catch {
        // A file that cannot be removed is reported by the next listing again;
        // a cleanup failure must not fail the operation that asked for it.
      }
    }
    return { kept: survivors.length, removed: expired.length }
  }

  /**
   * Read and validate one document at one path.
   * @param path - the absolute file path.
   * @param workspaceRoot - the root the document must belong to.
   * @returns the discriminated result.
   */
  async #read(path, workspaceRoot) {
    let text
    try {
      text = await this.fs.readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { status: 'absent' }
      return { status: 'invalid', reason: `cannot read ${path}: ${error?.message ?? String(error)}` }
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      return { status: 'invalid', reason: `${path} is not valid JSON: ${error?.message ?? String(error)}` }
    }
    const validation = validateWikiDocument(parsed)
    if (!validation.ok) return { status: 'invalid', reason: `${path}: ${validation.reason}` }
    // A document written for a different root is a different workspace's Wiki
    // reached through a moved or copied directory; refusing it is safer than
    // showing pages whose citations point at files that are not here.
    if (validation.document.workspace.root !== workspaceRoot
      && workspaceKey(validation.document.workspace.root, this.platform) !== workspaceKey(workspaceRoot, this.platform)) {
      return {
        status: 'invalid',
        reason: `${path} was generated for workspace root ${JSON.stringify(validation.document.workspace.root)}, not ${JSON.stringify(workspaceRoot)}`,
      }
    }
    return { status: 'ok', document: validation.document }
  }

  /**
   * Write one workspace's Wiki atomically.
   * @param document - the document to write.
   * @returns the path written.
   */
  async save(document) {
    return this.#write(this.pathFor(document.workspace.root), document)
  }

  /**
   * Write one workspace's previous-version copy atomically.
   * @param document - the document to archive.
   * @returns the path written.
   */
  async saveBackup(document) {
    return this.#write(this.backupPathFor(document.workspace.root), document)
  }

  /**
   * Write one document at one path, atomically.
   * @param path - the absolute destination.
   * @param document - the document to write.
   * @returns the path written.
   */
  async #write(path, document) {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const directory = cut === -1 ? '.' : path.slice(0, cut)
    await this.fs.mkdir(directory, { recursive: true })
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    await this.fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    try {
      await this.fs.rename(temporary, path)
    } catch (error) {
      // Windows refuses a rename onto an existing file that another handle
      // holds; removing the destination first is the documented remedy and is
      // still atomic enough for a single-writer store.
      await this.fs.rm(path, { force: true })
      await this.fs.rename(temporary, path)
      void error
    }
    return path
  }

  /**
   * Delete one workspace's *live* document, keeping the previous-version copy.
   *
   * Used by a delete that is meant to be undoable: the reader sees "no Wiki",
   * but the content is still on disk and {@link loadBackup} can hand it back.
   * @param workspaceRoot - the absolute workspace root.
   * @returns whether the live document was removed.
   */
  async removeDocument(workspaceRoot) {
    try {
      await this.fs.rm(this.pathFor(workspaceRoot), { force: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete one workspace's Wiki completely, including its previous-version copy.
   * Deleting only local content is what lets the UI label this "safe to
   * regenerate".
   * @param workspaceRoot - the absolute workspace root.
   * @returns whether anything was removed.
   */
  async remove(workspaceRoot) {
    const directory = this.join(this.root, workspaceKey(workspaceRoot, this.platform))
    try {
      await this.fs.rm(directory, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * List every workspace that has a Wiki, for the reader's project list.
   *
   * A directory that cannot be read is skipped rather than failing the listing:
   * one damaged entry must not hide every other Wiki on the machine.
   * @returns summaries sorted by most recently updated first.
   */
  async list() {
    let keys
    try {
      keys = await this.fs.readdir(this.root)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    /** @type {object[]} */
    const summaries = []
    for (const key of keys) {
      const path = this.join(this.root, key, WIKI_FILENAME)
      try {
        const parsed = JSON.parse(await this.fs.readFile(path, 'utf8'))
        const validation = validateWikiDocument(parsed)
        if (!validation.ok) continue
        const document = validation.document
        summaries.push({
          key,
          workspace: document.workspace,
          meta: document.meta,
          version: document.version,
          pages: document.pages.length,
          done: document.pages.filter((page) => page.status === 'done').length,
          updatedAt: document.meta?.updatedAt ?? document.createdAt ?? null,
        })
      } catch {
        continue
      }
    }
    summaries.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    return summaries
  }

  /**
   * Describe the store without reading any document, for diagnostics.
   * @returns the store's location and schema version.
   */
  describe() {
    return {
      dataDir: this.dataDir,
      root: this.root,
      filename: WIKI_FILENAME,
      historyDirname: HISTORY_DIRNAME,
      legacyBackupFilename: WIKI_BACKUP_FILENAME,
      version: WIKI_VERSION,
    }
  }
}
