/**
 * The per-workspace Wiki store.
 *
 * The store is the only part of the plugin that writes anything, and it writes
 * outside the repository on purpose, so these tests assert the layout, the
 * workspace key's stability, and the two failure modes a reader will actually
 * meet: a document that is not valid JSON, and a document generated for a
 * different directory — which happens whenever a repository is moved or copied.
 *
 * @module dsh-repo-wiki/test/store
 */

import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as nodeFs from 'node:fs/promises'

import { STORE_DIRNAME, WIKI_BACKUP_FILENAME, WIKI_FILENAME, WikiStore, workspaceKey } from '../lib/wiki/store.js'
import { createWikiDocument } from '../lib/wiki/model.js'

/**
 * Create a store over a fresh temporary directory.
 * @returns the store and a cleanup function.
 */
async function tempStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-wiki-store-'))
  return {
    store: new WikiStore({ dataDir, fs: nodeFs, join }),
    dataDir,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  }
}

/**
 * A minimal document for one root.
 * @param root - the workspace root.
 * @returns the document.
 */
function documentFor(root) {
  const document = createWikiDocument({
    workspace: { id: 'id', name: 'name', root },
    language: 'en',
    diagrams: false,
  })
  document.pages = [{
    id: 'intro',
    title: 'Intro',
    brief: 'b',
    path: ['Intro'],
    parentId: null,
    depth: 0,
    status: 'done',
    markdown: '# Intro',
    sources: [],
    unverifiedSources: [],
    error: null,
    attempts: 1,
  }]
  return document
}

test('the workspace key is stable and spelling-insensitive', () => {
  const canonical = workspaceKey('D:\\agents\\app', 'win32')
  assert.equal(canonical, workspaceKey('D:/agents/app', 'win32'), 'separators do not matter')
  assert.equal(canonical, workspaceKey('D:\\AGENTS\\APP\\', 'win32'), 'case and a trailing separator do not matter')
  assert.notEqual(canonical, workspaceKey('D:\\agents\\other', 'win32'))
  assert.match(canonical, /^[0-9a-f]{16}$/)

  // On a case-sensitive platform the same two spellings are two directories.
  assert.notEqual(workspaceKey('/a/b', 'linux'), workspaceKey('/A/B', 'linux'))
  assert.equal(workspaceKey('/a/b/', 'linux'), workspaceKey('/a/b', 'linux'))
})

test('a saved Wiki round-trips and lives outside the workspace', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    const document = documentFor(root)
    const path = await store.save(document)

    assert.equal(path, join(dataDir, STORE_DIRNAME, workspaceKey(root, process.platform), WIKI_FILENAME))
    assert.equal(path.startsWith(root), false, 'the document must not be written into the workspace')

    const loaded = await store.load(root)
    assert.equal(loaded.status, 'ok')
    assert.equal(loaded.document.pages[0].markdown, '# Intro')

    // The file is real JSON on disk, which is what makes it usable as a plain
    // artifact a person can read or point an agent at.
    const raw = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(raw.version, 1)
  } finally {
    await cleanup()
  }
})

test('a workspace with no Wiki reports absence, not an error', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    assert.deepEqual(await store.load(join(dataDir, 'never-generated')), { status: 'absent' })
    assert.deepEqual(await store.list(), [])
  } finally {
    await cleanup()
  }
})

test('a corrupt document is reported with its reason instead of crashing', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    const path = store.pathFor(root)
    await nodeFs.mkdir(join(path, '..'), { recursive: true })

    await writeFile(path, '{ not json', 'utf8')
    const broken = await store.load(root)
    assert.equal(broken.status, 'invalid')
    assert.match(broken.reason, /not valid JSON/)

    await writeFile(path, JSON.stringify({ version: 1, catalog: [], pages: [] }), 'utf8')
    const missingIdentity = await store.load(root)
    assert.equal(missingIdentity.status, 'invalid')
    assert.match(missingIdentity.reason, /workspace identity/)

    const document = documentFor(root)
    document.pages[0].status = 'nonsense'
    await writeFile(path, JSON.stringify(document), 'utf8')
    const badStatus = await store.load(root)
    assert.equal(badStatus.status, 'invalid')
    assert.match(badStatus.reason, /unknown status/)
  } finally {
    await cleanup()
  }
})

test('a document generated for a different root is refused', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const original = join(dataDir, 'original')
    const moved = join(dataDir, 'moved')
    const document = documentFor(original)
    await store.save(document)

    // Simulate moving the directory: the document now sits under the `moved`
    // key only because it was copied there, and its citations would be wrong.
    const copied = documentFor(moved)
    copied.workspace.root = original
    const movedPath = store.pathFor(moved)
    await nodeFs.mkdir(join(movedPath, '..'), { recursive: true })
    await writeFile(movedPath, JSON.stringify(copied), 'utf8')

    const loaded = await store.load(moved)
    assert.equal(loaded.status, 'invalid')
    assert.match(loaded.reason, /was generated for workspace root/)
  } finally {
    await cleanup()
  }
})

test('saving twice replaces the document atomically and leaves no temp file', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    const document = documentFor(root)
    await store.save(document)

    document.pages[0].title = 'Renamed'
    await store.save(document)

    const loaded = await store.load(root)
    assert.equal(loaded.status, 'ok')
    assert.equal(loaded.document.pages[0].title, 'Renamed')

    const entries = await nodeFs.readdir(join(store.root, workspaceKey(root, process.platform)))
    assert.deepEqual(entries, [WIKI_FILENAME], 'no temporary file is left behind')
  } finally {
    await cleanup()
  }
})

test('removing a Wiki deletes only local content', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    await nodeFs.mkdir(root, { recursive: true })
    await writeFile(join(root, 'keep.txt'), 'workspace content', 'utf8')
    await store.save(documentFor(root))

    assert.equal(await store.remove(root), true)
    assert.equal((await store.load(root)).status, 'absent')
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'workspace content')
  } finally {
    await cleanup()
  }
})

test('listing reports every stored Wiki, newest first, skipping damaged ones', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const first = documentFor(join(dataDir, 'one'))
    first.meta.updatedAt = '2026-01-01T00:00:00.000Z'
    first.workspace.name = 'one'
    const second = documentFor(join(dataDir, 'two'))
    second.meta.updatedAt = '2026-02-02T00:00:00.000Z'
    second.workspace.name = 'two'
    await store.save(first)
    await store.save(second)

    const damaged = join(store.root, 'deadbeefdeadbeef')
    await nodeFs.mkdir(damaged, { recursive: true })
    await writeFile(join(damaged, WIKI_FILENAME), 'garbage', 'utf8')

    const list = await store.list()
    assert.equal(list.length, 2, 'the damaged entry is skipped rather than failing the listing')
    assert.deepEqual(list.map((entry) => entry.workspace.name), ['two', 'one'])
    assert.equal(list[0].pages, 1)
    assert.equal(list[0].done, 1)
  } finally {
    await cleanup()
  }
})

test('a previous-version copy round-trips beside the live document', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    assert.deepEqual(await store.loadBackup(root), { status: 'absent' }, 'a first run has no copy to restore')

    const archived = documentFor(root)
    archived.pages[0].markdown = '# The good version'
    await store.saveBackup(archived)

    // The copy lives beside the live document and does not become the live one.
    assert.equal(store.backupPathFor(root), join(dataDir, STORE_DIRNAME, workspaceKey(root, process.platform), WIKI_BACKUP_FILENAME))
    assert.equal((await store.load(root)).status, 'absent')
    const loaded = await store.loadBackup(root)
    assert.equal(loaded.status, 'ok')
    assert.equal(loaded.document.pages[0].markdown, '# The good version')

    // Listing reports live Wikis only: a copy alone is not a workspace entry.
    assert.deepEqual(await store.list(), [])
  } finally {
    await cleanup()
  }
})

test('removing the live document keeps the copy, so the delete can be undone', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    const document = documentFor(root)
    await store.save(document)
    await store.saveBackup(document)

    assert.equal(await store.removeDocument(root), true)
    assert.equal((await store.load(root)).status, 'absent')
    assert.equal((await store.loadBackup(root)).status, 'ok', 'the copy survives the delete')

    // The full removal is the one that really forgets the workspace.
    assert.equal(await store.remove(root), true)
    assert.equal((await store.loadBackup(root)).status, 'absent')

    const leftover = await nodeFs.readdir(join(store.root, workspaceKey(root, process.platform))).catch(() => [])
    assert.deepEqual(leftover, [], 'no temporary file is left behind either')
  } finally {
    await cleanup()
  }
})

test('a copy generated for a different workspace is refused', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const original = join(dataDir, 'original')
    const moved = join(dataDir, 'moved')
    const copy = documentFor(original)
    await store.saveBackup(copy)
    // Simulate the directory being copied under another workspace key: the
    // archived document still says it describes the original root.
    const movedPath = store.backupPathFor(moved)
    await nodeFs.mkdir(join(movedPath, '..'), { recursive: true })
    await writeFile(movedPath, JSON.stringify(copy), 'utf8')

    const loaded = await store.loadBackup(moved)
    assert.equal(loaded.status, 'invalid')
    assert.match(loaded.reason, /was generated for workspace root/)
  } finally {
    await cleanup()
  }
})

/** Build a history id from its parts, the way the service does. */
function historyId(epochMs, done, total, signature) {
  return `${String(epochMs).padStart(13, '0')}-${done}of${total}-${String(signature).repeat(12).slice(0, 12)}`
}

test('archived versions are listed newest first and load back by id', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    const document = documentFor(root)
    const older = historyId(1700000000000, 1, 1, 'a')
    const newer = historyId(1700000001000, 1, 1, 'b')
    await store.saveHistory(document, older)
    await store.saveHistory(document, newer)

    const list = await store.listHistory(root)
    assert.deepEqual(list.map((entry) => entry.id), [newer, older], 'newest first')
    assert.equal(list[0].done, 1)
    assert.equal(list[0].total, 1)
    assert.equal(list[0].archivedAt, new Date(1700000001000).toISOString())

    const loaded = await store.loadHistory(root, older)
    assert.equal(loaded.status, 'ok')
    assert.equal(loaded.document.pages[0].markdown, '# Intro')
    assert.equal((await store.loadHistory(root, historyId(1700000002000, 1, 1, 'c'))).status, 'absent')

    // A version carrying another workspace's identity is refused, like the live
    // document would be.
    const foreignId = historyId(1700000003000, 1, 1, 'd')
    const foreignPath = store.historyPathFor(root, foreignId)
    await nodeFs.mkdir(store.historyDirFor(root), { recursive: true })
    await writeFile(foreignPath, JSON.stringify(documentFor(join(dataDir, 'other'))), 'utf8')
    const refused = await store.loadHistory(root, foreignId)
    assert.equal(refused.status, 'invalid')
    assert.match(refused.reason, /was generated for workspace root/)
  } finally {
    await cleanup()
  }
})

test('a history id cannot escape the history directory', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    assert.throws(() => store.historyPathFor(root, '../wiki'), /invalid history id/)
    assert.throws(() => store.historyPathFor(root, '1700000000000-1of1-../../x'), /invalid history id/)
    assert.equal(await store.removeHistory(root, 'not-an-id'), false)
  } finally {
    await cleanup()
  }
})

test('purging a history enforces the age window and trims partial versions before complete ones', async () => {
  const { store, dataDir, cleanup } = await tempStore()
  try {
    const root = join(dataDir, 'project')
    const document = documentFor(root)
    const now = 1700000000000
    const older = historyId(now - 4 * 60 * 60 * 1000, 2, 2, 'a') // expired
    const partial = historyId(now - 60 * 60 * 1000, 1, 2, 'b') // newest after expiry
    const complete = historyId(now - 30 * 60 * 1000, 2, 2, 'c')
    for (const id of [older, partial, complete]) await store.saveHistory(document, id)

    // Two hours of retention drops the four-hour-old version; the cap of one
    // then drops the incomplete version rather than the complete one.
    const outcome = await store.purgeHistory(root, {
      nowMs: now,
      retentionMs: 2 * 60 * 60 * 1000,
      maxEntries: 1,
    })
    assert.equal(outcome.removed, 2)
    assert.equal(outcome.kept, 1)
    assert.deepEqual((await store.listHistory(root)).map((entry) => entry.id), [complete])
  } finally {
    await cleanup()
  }
})
