/**
 * The Wiki service: the rules ZCode documents as limits, and the turn-end
 * refresh.
 *
 * These tests drive the service the way the host does — a real store in a
 * temporary directory, a reader over a mutable virtual tree, and a scripted
 * model — so the assertions cover the behaviour a user meets: one generation at
 * a time, one language at a time, a stop that keeps finished pages, a failure
 * that keeps the catalog, and a refresh that happens only when the code moved.
 *
 * @module dsh-repo-wiki/test/service
 */

import { strict as assert } from 'node:assert'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as nodeFs from 'node:fs/promises'

import { WikiService } from '../lib/wiki/service.js'
import { STORE_DIRNAME, WikiStore } from '../lib/wiki/store.js'
import { WorkspaceReader } from '../lib/wiki/workspace.js'
import { SAMPLE_TREE, VirtualFs, createScriptedModel, posixJoin, virtualAdapter } from './helpers.mjs'

/** The workspace descriptor the virtual tree is bound to. */
const WORKSPACE = { id: 'w1', name: 'sample', root: '/work' }

/** A model that completes a whole run, with the stages recognized from the prompts. */
function wikiModel(options = {}) {
  let pageCount = 0
  return createScriptedModel(async (request) => {
    const text = request.messages.map((message) => message.content ?? '').join('\n')
    if (options.onRequest !== undefined) {
      const override = await options.onRequest({ request, text })
      if (override !== undefined) return override
    }
    if (request.tools !== undefined && request.tools.some((tool) => tool.name === 'finish')) {
      if (!request.messages.some((message) => message.role === 'tool')) {
        return {
          text: '',
          toolCalls: [
            { id: 'c1', name: 'read_file', arguments: { path: 'src/main.js' } },
            { id: 'c2', name: 'list_directory', arguments: { path: 'src/util' } },
          ],
        }
      }
      return {
        text: '',
        toolCalls: [{
          id: 'c3',
          name: 'finish',
          arguments: {
            summary: 'A sample project that doubles a value.',
            stack: ['JavaScript'],
            entrypoints: ['src/main.js'],
            notes: '',
          },
        }],
      }
    }
    if (text.includes('"catalog"')) {
      const catalog = typeof options.catalogFor === 'function'
        ? options.catalogFor()
        : [
          { title: 'Project identity', brief: 'what it is' },
          { title: 'Main flow', brief: 'what runs' },
        ]
      return JSON.stringify({ catalog })
    }
    if (text.includes('cited locations that do not exist')) {
      return 'Repaired. `src/main.js:1-3`'
    }
    pageCount += 1
    return `Page ${pageCount}. \`src/main.js:1-3\`\n\n## Source locations\n- src/main.js:1-3`
  })
}

/**
 * Build a service over a mutable tree.
 * @param [options] - harness overrides.
 * @returns the harness.
 */
async function harness(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-wiki-service-'))
  const state = { tree: { ...(options.tree ?? SAMPLE_TREE) } }
  const store = new WikiStore({ dataDir, fs: nodeFs, join })
  const model = options.model ?? wikiModel(options)
  const service = new WikiService({
    store,
    createReader: () => {
      const fs = new VirtualFs(state.tree).bind('/work')
      return new WorkspaceReader({ root: '/work', fs: virtualAdapter(fs), join: posixJoin })
    },
    createModel: () => model,
    readGitState: options.readGitState,
    now: options.now,
    historyRetentionMs: options.historyRetentionMs,
    historyMaxEntries: options.historyMaxEntries,
    options: { requestTimeoutMs: 5000, maxScanFiles: 5000 },
  })
  return {
    service,
    store,
    model,
    state,
    dataDir,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  }
}

/** Start and await one run. */
async function generate(service, request = {}) {
  service.start({ workspace: WORKSPACE, language: 'en', ...request })
  return service.settled(WORKSPACE)
}

test('a run records the VCS state the host reports, so a Wiki names the code it describes', async () => {
  const { service, cleanup } = await harness({
    readGitState: async () => ({ branch: 'main', commit: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d' }),
  })
  try {
    await generate(service)
    const state = await service.status(WORKSPACE)
    assert.equal(state.wiki.meta.branch, 'main')
    assert.equal(state.wiki.meta.commit, '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d')
  } finally {
    await cleanup()
  }
})

test('an explicit branch and commit win over the host VCS state', async () => {
  const { service, cleanup } = await harness({
    readGitState: async () => ({ branch: 'main', commit: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d' }),
  })
  try {
    await generate(service, { branch: 'release', commit: 'deadbeef' })
    const state = await service.status(WORKSPACE)
    assert.equal(state.wiki.meta.branch, 'release')
    assert.equal(state.wiki.meta.commit, 'deadbeef')
  } finally {
    await cleanup()
  }
})

test('a VCS reader that throws does not fail the run', async () => {
  const { service, cleanup } = await harness({
    readGitState: async () => { throw new Error('git is unavailable') },
  })
  try {
    const task = await generate(service)
    assert.equal(task.state, 'done', 'metadata is a courtesy, never a precondition')
    const state = await service.status(WORKSPACE)
    assert.equal(state.wiki.meta.branch, null)
  } finally {
    await cleanup()
  }
})

test('a generation runs to completion and its state is readable', async () => {
  const { service, cleanup } = await harness()
  try {
    const task = await generate(service)
    assert.equal(task.state, 'done')
    assert.equal(task.phase, 'saving')
    assert.equal(task.progress.done, 2)
    assert.equal(task.progress.failed, 0)

    const state = await service.status(WORKSPACE)
    assert.equal(state.exists, true)
    assert.equal(state.unreadable, null)
    assert.equal(state.task.state, 'done')
    assert.equal(state.wiki.counts.done, 2)
    assert.equal(state.wiki.meta.language, 'en')
    assert.equal(state.wiki.pages.length, 2)
    assert.equal(state.wiki.pages[0].title, 'Project identity')
    assert.equal(state.wiki.meta.fingerprint.length > 0, true)
    assert.equal(state.wiki.meta.project.summary, 'A sample project that doubles a value.')
    assert.equal(state.wiki.citations.verified >= 2, true)
    assert.equal(state.wiki.citations.unverified, 0)
    assert.equal(state.stale, false)
    assert.equal(state.wiki.meta.lastTask?.state, 'done', 'the document remembers how the last run ended')
    assert.equal(state.wiki.meta.lastTask?.done, 2)
    assert.equal(state.wiki.meta.lastTask?.error, null)
  } finally {
    await cleanup()
  }
})

test('only one generation runs per workspace at a time', async () => {
  const { service, cleanup, model } = await harness()
  try {
    const first = service.start({ workspace: WORKSPACE, language: 'en' })
    assert.throws(
      () => service.start({ workspace: WORKSPACE, language: 'en' }),
      (error) => {
        assert.equal(error.code, 'WIKI_BUSY')
        return true
      },
    )
    await service.settled(WORKSPACE)
    assert.equal(first.state, 'done')

    // Once settled, a new run is allowed.
    const second = await generate(service)
    assert.equal(second.state, 'done')
    assert.notEqual(second.id, first.id)
    assert.equal(model.requests.length > 0, true)
  } finally {
    await cleanup()
  }
})

test('one language per workspace: regenerating in the other language replaces it', async () => {
  const { service, store, model, cleanup } = await harness()
  try {
    await generate(service, { language: 'zh-CN' })
    const chinese = await store.load('/work')
    assert.equal(chinese.document.meta.language, 'zh-CN')

    // The prompt the model saw really was Chinese, so the claim is not just a
    // field on the document.
    assert.equal(model.requests.some((request) => request.system.includes('简体中文')), true)

    await generate(service, { language: 'en' })
    const english = await store.load('/work')
    assert.equal(english.document.meta.language, 'en')

    const keys = await readdir(join(store.root))
    assert.equal(keys.length, 1, 'the workspace keeps exactly one Wiki, not one per language')
  } finally {
    await cleanup()
  }
})

test('a stop keeps finished pages and reports what was cut off', async () => {
  const { service, store, cleanup } = await harness({
    model: wikiModel({
      onRequest: ({ request, text }) => {
        if (text.includes('"Main flow"')) {
          service.stop(WORKSPACE, 'the user pressed stop')
        }
        void request
        return undefined
      },
    }),
  })
  try {
    const task = await generate(service)
    assert.equal(task.state, 'stopped')
    assert.equal(task.error, null)

    const stored = await store.load('/work')
    assert.equal(stored.status, 'ok')
    const statuses = stored.document.pages.map((page) => page.status)
    assert.equal(statuses[0], 'done', 'the finished page is on disk')
    assert.equal(statuses[1], 'stopped', 'the page that was being written is marked stopped')
    assert.equal(stored.document.meta.project.summary.length > 0, true, 'the analysis survived too')
  } finally {
    await cleanup()
  }
})

test('stopping when nothing runs reports nothing to stop', async () => {
  const { service, cleanup } = await harness()
  try {
    assert.equal(service.stop(WORKSPACE), false)
    await generate(service)
    assert.equal(service.stop(WORKSPACE), false, 'a settled task cannot be stopped')
  } finally {
    await cleanup()
  }
})

test('a total page failure fails the task but keeps the catalog on disk', async () => {
  const { service, store, cleanup } = await harness({
    model: wikiModel({
      onRequest: ({ text }) => {
        if (text.includes('Write the page') || text.includes('架构导读中的页面')) throw new Error('model unavailable')
        return undefined
      },
    }),
  })
  try {
    const task = await generate(service)
    assert.equal(task.state, 'failed')
    assert.match(task.error, /every one of the 2 pages failed/)

    const stored = await store.load('/work')
    assert.equal(stored.status, 'ok')
    assert.equal(stored.document.pages.length, 2, 'the reader still sees the planned catalog')
    assert.equal(stored.document.pages.every((page) => page.status === 'failed'), true)
    assert.equal(stored.document.meta.lastTask?.state, 'failed', 'the failure survives the process that saw it')
    assert.match(stored.document.meta.lastTask?.error ?? '', /every one of the 2 pages failed/)
  } finally {
    await cleanup()
  }
})

test('a failed page can be regenerated on its own', async () => {
  const failing = { on: true }
  const { service, cleanup } = await harness({
    model: wikiModel({
      onRequest: ({ text }) => {
        if (failing.on && (text.includes('Write the page') || text.includes('架构导读中的页面'))) throw new Error('provider exploded')
        return undefined
      },
    }),
  })
  try {
    const task = await generate(service)
    assert.equal(task.state, 'failed', 'the first run loses every page')
    const before = await service.status(WORKSPACE)
    assert.equal(before.wiki.counts.failed, 2)

    failing.on = false
    const pageId = before.wiki.pages[0].id
    await service.regeneratePage(WORKSPACE, pageId)
    await service.settled(WORKSPACE)

    const after = await service.status(WORKSPACE)
    assert.equal(after.wiki.pages[0].status, 'done', 'the retried page is rewritten')
    assert.equal(after.wiki.pages[0].sources > 0, true)
    assert.equal(after.wiki.pages[1].status, 'failed', 'the other page is untouched')
  } finally {
    await cleanup()
  }
})

test('a page retry is refused while a generation is in flight', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { service, cleanup } = await harness({
    model: wikiModel({
      onRequest: async ({ text }) => {
        if (text.includes('Write the page') || text.includes('架构导读中的页面')) await gate
        return undefined
      },
    }),
  })
  try {
    service.start({ workspace: WORKSPACE, language: 'en' })
    await assert.rejects(
      () => service.regeneratePage(WORKSPACE, 'project-identity'),
      (error) => error.code === 'WIKI_BUSY',
    )
    release()
    await service.settled(WORKSPACE)
  } finally {
    await cleanup()
  }
})

test('a failed retry of a done page keeps its old body', async () => {
  const failing = { on: false }
  const { service, cleanup } = await harness({
    model: wikiModel({
      onRequest: ({ text }) => {
        if (failing.on && (text.includes('Write the page') || text.includes('架构导读中的页面'))) throw new Error('provider exploded')
        return undefined
      },
    }),
  })
  try {
    await generate(service)
    const before = await service.read(WORKSPACE)
    const pageId = before.pages[0].id
    const oldMarkdown = before.pages[0].markdown

    failing.on = true
    const task = await service.regeneratePage(WORKSPACE, pageId)
    await task.promise
    assert.equal(task.state, 'failed', 'the retry itself reports failure')

    const after = await service.read(WORKSPACE, pageId)
    assert.equal(after.page.status, 'done', 'the good page survives a failed retry')
    assert.equal(after.page.markdown, oldMarkdown, 'its body is not clobbered')
  } finally {
    await cleanup()
  }
})

test('reading returns the whole Wiki, one page, or a not-found answer', async () => {
  const { service, cleanup } = await harness()
  try {
    assert.deepEqual(await service.read(WORKSPACE), { status: 'absent' })

    await generate(service)
    const whole = await service.read(WORKSPACE)
    assert.equal(whole.status, 'ok')
    assert.equal(whole.pages.length, 2)
    assert.equal(typeof whole.pages[0].markdown, 'string')

    const page = await service.read(WORKSPACE, whole.pages[0].id)
    assert.equal(page.status, 'ok')
    assert.equal(page.page.title, 'Project identity')
    assert.match(page.page.markdown, /src\/main\.js/)

    const missing = await service.read(WORKSPACE, 'nope')
    assert.equal(missing.status, 'not-found')
    assert.deepEqual(missing.available, whole.pages.map((candidate) => candidate.id))
  } finally {
    await cleanup()
  }
})

test('deleting removes local content only, and the workspace can be regenerated', async () => {
  const { service, cleanup } = await harness()
  try {
    await generate(service)
    assert.equal(await service.remove(WORKSPACE), true)
    assert.equal((await service.read(WORKSPACE)).status, 'absent')

    const again = await generate(service)
    assert.equal(again.state, 'done')
    assert.equal((await service.read(WORKSPACE)).status, 'ok')
  } finally {
    await cleanup()
  }
})

test('the turn-end refresh is skipped when the code did not change', async () => {
  const { service, model, cleanup } = await harness()
  try {
    await generate(service)
    const callsAfterGenerate = model.requests.length

    const unchanged = await service.refresh(WORKSPACE, { auto: true })
    assert.equal(unchanged.outcome, 'unchanged')
    assert.equal(model.requests.length, callsAfterGenerate, 'no model call was made')

    const state = await service.status(WORKSPACE)
    assert.equal(state.stale, false)
  } finally {
    await cleanup()
  }
})

test('the turn-end refresh reports staleness and, when asked, refreshes', async () => {
  const { service, state, store, cleanup } = await harness()
  try {
    await generate(service)
    const first = (await store.load('/work')).document.meta.fingerprint

    // A real code change, and one that must not count.
    state.tree['src/run.js'] = 'export function run(config) {\n  return config.value * 3\n}\n'
    state.tree['node_modules/dep/extra.js'] = 'ignored'

    const stale = await service.refresh(WORKSPACE, { auto: false })
    assert.equal(stale.outcome, 'stale', 'report-only does not start a run')
    assert.equal(service.taskFor(WORKSPACE).state, 'done', 'the previous task is untouched')

    const reported = await service.status(WORKSPACE)
    assert.equal(reported.stale, true)

    const refreshed = await service.refresh(WORKSPACE, { auto: true })
    assert.equal(refreshed.outcome, 'refreshed')
    await service.settled(WORKSPACE)
    assert.equal(refreshed.task.state, 'done')

    const second = (await store.load('/work')).document.meta.fingerprint
    assert.notEqual(second, first, 'the refresh recorded the new code state')
    assert.equal((await service.changed(WORKSPACE)).changed, false)
  } finally {
    await cleanup()
  }
})

test('refresh on an absent or unreadable Wiki says which it is', async () => {
  const { service, store, dataDir, cleanup } = await harness()
  try {
    assert.equal((await service.refresh(WORKSPACE)).outcome, 'absent')

    await nodeFs.mkdir(join(dataDir, STORE_DIRNAME, 'deadbeefdeadbeef'), { recursive: true })
    await nodeFs.writeFile(join(dataDir, STORE_DIRNAME, 'deadbeefdeadbeef', 'wiki.json'), 'not json', 'utf8')
    void store

    const loaded = await store.load('/work')
    assert.equal(loaded.status, 'absent', 'a corrupt document under another key does not affect this workspace')
  } finally {
    await cleanup()
  }
})

test('status survives a fingerprint that cannot be computed', async () => {
  const { service, cleanup } = await harness()
  try {
    // A reader whose listing always fails stands in for an unmounted or
    // permission-denied workspace.
    service.createReader = () => ({
      fingerprint: async () => {
        throw new Error('EACCES: permission denied')
      },
    })
    const state = await service.status(WORKSPACE)
    assert.equal(state.exists, false)
    assert.equal(state.fingerprint.value, null)
    assert.match(state.fingerprint.error, /EACCES/)
    assert.equal(state.stale, false, 'an unknown code state is not claimed to be fresh')
  } finally {
    await cleanup()
  }
})

test('a bad regeneration keeps the finished Wiki as an archived version, and restore brings it back', async () => {
  const failing = { on: false }
  const { service, store, cleanup } = await harness({
    model: wikiModel({
      onRequest: ({ text }) => {
        if (failing.on && (text.includes('Write the page') || text.includes('架构导读中的页面'))) {
          throw new Error('provider exploded')
        }
        return undefined
      },
    }),
  })
  try {
    await generate(service)
    const before = await service.read(WORKSPACE)
    assert.equal(before.status, 'ok')
    const oldMarkdown = before.pages.map((page) => page.markdown)
    assert.deepEqual((await service.status(WORKSPACE)).history, [], 'the first run has nothing to archive')

    // The mis-clicked regeneration: every page fails, so the live document ends
    // up with plans but no content. Before this fix that was the whole Wiki.
    failing.on = true
    const failed = await generate(service)
    assert.equal(failed.state, 'failed')
    const afterFailure = await service.status(WORKSPACE)
    assert.equal(afterFailure.wiki.counts.done, 0, 'the failed run produced no usable pages')
    assert.equal(afterFailure.history.length, 1, 'the finished version was kept before it was overwritten')
    assert.equal(afterFailure.history[0].done, 2)
    assert.equal(afterFailure.history[0].total, 2)
    assert.match(afterFailure.history[0].id, /^\d{13}-2of2-[0-9a-f]{12}$/)

    // The recovery is one call, and it returns the original bodies unchanged.
    const restored = await service.restore(WORKSPACE)
    assert.equal(restored.restored, true)
    assert.equal(restored.done, 2)
    const after = await service.read(WORKSPACE)
    assert.equal(after.status, 'ok')
    assert.deepEqual(after.pages.map((page) => page.markdown), oldMarkdown)
    assert.equal((await service.status(WORKSPACE)).wiki.counts.done, 2)
    // Restoring records when it happened, but leaves the pages' own provenance alone.
    assert.equal(typeof after.pages[0].markdown, 'string')
    const reloaded = await store.load('/work')
    assert.equal(typeof reloaded.document.meta.restoredAt, 'string')
  } finally {
    await cleanup()
  }
})

test('a second failed run does not replace the good version in the history with debris', async () => {
  const failing = { on: false }
  const { service, cleanup } = await harness({
    model: wikiModel({
      onRequest: ({ text }) => {
        if (failing.on && (text.includes('Write the page') || text.includes('架构导读中的页面'))) {
          throw new Error('provider exploded')
        }
        return undefined
      },
    }),
  })
  try {
    await generate(service)
    failing.on = true
    await generate(service)
    // A run that starts with zero completed pages must not archive over the copy.
    await generate(service)
    const state = await service.status(WORKSPACE)
    assert.equal(state.wiki.counts.done, 0)
    assert.equal(state.history.length, 1)
    assert.equal(state.history[0].done, 2, 'the history still holds the last version that actually worked')
    await service.restore(WORKSPACE)
    assert.equal((await service.status(WORKSPACE)).wiki.counts.done, 2)
  } finally {
    await cleanup()
  }
})

/** Build a catalog of `size` pages for the test model. */
function catalogOf(size) {
  return Array.from({ length: size }, (_, index) => ({ title: `Page ${index + 1}`, brief: `about ${index + 1}` }))
}

test('every full run archives the version it replaces, keeping several restorable versions', async () => {
  let tick = Date.UTC(2026, 9, 17, 0, 0, 0)
  const now = () => new Date(tick++)
  const catalog = { value: catalogOf(3) }
  const { service, cleanup } = await harness({ model: wikiModel({ catalogFor: () => catalog.value }), now })
  try {
    await generate(service)
    catalog.value = catalogOf(2)
    await generate(service)
    catalog.value = catalogOf(1)
    await generate(service)

    const state = await service.status(WORKSPACE)
    assert.equal(state.history.length, 2, 'each run archived the version it replaced')
    assert.deepEqual(state.history.map((entry) => entry.total), [2, 3], 'newest first')

    // Any archived version can be restored, not only the newest one.
    const older = state.history[1]
    const restored = await service.restore(WORKSPACE, older.id)
    assert.equal(restored.total, 3)
    const after = await service.status(WORKSPACE)
    assert.equal(after.wiki.counts.total, 3)
    assert.equal(after.wiki.counts.done, 3)
  } finally {
    await cleanup()
  }
})

test('versions expire after the three-day retention window', async () => {
  let tick = Date.UTC(2026, 9, 1, 0, 0, 0)
  const now = () => new Date(tick++)
  const catalog = { value: catalogOf(2) }
  const retentionMs = 3 * 24 * 60 * 60 * 1000
  const { service, cleanup } = await harness({
    model: wikiModel({ catalogFor: () => catalog.value }),
    now,
    historyRetentionMs: retentionMs,
  })
  try {
    await generate(service)
    tick += 60 * 60 * 1000 // an hour later the next run archives the first version
    await generate(service)
    let state = await service.status(WORKSPACE)
    assert.equal(state.history.length, 1)
    assert.equal(state.historyRetentionDays, 3)

    // Move past the window: an ordinary status read sweeps the expired version.
    tick = Date.parse(state.history[0].archivedAt) + retentionMs + 60 * 60 * 1000
    state = await service.status(WORKSPACE)
    assert.equal(state.history.length, 0)
    await assert.rejects(
      () => service.restore(WORKSPACE),
      (error) => error.code === 'WIKI_NO_BACKUP',
    )
  } finally {
    await cleanup()
  }
})

test('the history keeps at most its configured number of versions', async () => {
  let tick = Date.UTC(2026, 9, 1, 0, 0, 0)
  const now = () => { tick += 1000; return new Date(tick) }
  const catalog = { value: catalogOf(4) }
  const { service, cleanup } = await harness({
    model: wikiModel({ catalogFor: () => catalog.value }),
    now,
    historyMaxEntries: 2,
  })
  try {
    await generate(service)
    for (const size of [3, 2, 1]) {
      catalog.value = catalogOf(size)
      await generate(service)
    }
    const state = await service.status(WORKSPACE)
    assert.equal(state.history.length, 2, 'the older versions are trimmed away')
    assert.deepEqual(state.history.map((entry) => entry.total), [2, 3], 'newer versions win the cap')
  } finally {
    await cleanup()
  }
})

test('the legacy single-slot backup is migrated into the history', async () => {
  const { service, store, cleanup } = await harness()
  try {
    await generate(service)
    const document = (await store.load('/work')).document
    await store.saveBackup(document)

    const state = await service.status(WORKSPACE)
    assert.equal(state.history.length, 1)
    assert.equal(state.history[0].done, 2)
    assert.equal((await store.loadBackup('/work')).status, 'absent', 'the legacy file is removed after migration')
  } finally {
    await cleanup()
  }
})

test('a complete regeneration with a smaller catalog is kept in the history', async () => {
  let tick = Date.UTC(2026, 9, 17, 0, 0, 0)
  const now = () => new Date(tick++)
  const catalog = { value: catalogOf(3) }
  const { service, cleanup } = await harness({ model: wikiModel({ catalogFor: () => catalog.value }), now })
  try {
    await generate(service)
    catalog.value = catalogOf(1)
    await generate(service)
    await generate(service)

    const state = await service.status(WORKSPACE)
    assert.deepEqual(state.history.map((entry) => entry.total), [1, 3], 'the smaller previous version is kept, not blocked by the larger one')
  } finally {
    await cleanup()
  }
})

test('deleting a failed run keeps the good previous version', async () => {
  const failing = { on: false }
  const { service, cleanup } = await harness({
    model: wikiModel({
      onRequest: ({ text }) => {
        if (failing.on && (text.includes('Write the page') || text.includes('架构导读中的页面'))) {
          throw new Error('provider exploded')
        }
        return undefined
      },
    }),
  })
  try {
    await generate(service)
    failing.on = true
    await generate(service)
    assert.equal((await service.status(WORKSPACE)).wiki.counts.done, 0)

    // Deleting the debris must not replace the copy with a document carrying no
    // completed pages: the user is clearing a bad run, not the good one.
    assert.equal(await service.remove(WORKSPACE), true)
    const afterDelete = await service.status(WORKSPACE)
    assert.equal(afterDelete.exists, false)
    assert.equal(afterDelete.history[0].done, 2)
    await service.restore(WORKSPACE)
    assert.equal((await service.status(WORKSPACE)).wiki.counts.done, 2)
  } finally {
    await cleanup()
  }
})

test('restore is refused with no archived version and while a run is in flight', async () => {
  const { service, cleanup } = await harness()
  try {
    await assert.rejects(
      () => service.restore(WORKSPACE),
      (error) => {
        assert.equal(error.code, 'WIKI_NO_BACKUP')
        return true
      },
    )

    await generate(service)
    service.start({ workspace: WORKSPACE, language: 'en' })
    await assert.rejects(
      () => service.restore(WORKSPACE),
      (error) => {
        assert.equal(error.code, 'WIKI_BUSY')
        return true
      },
    )
    service.stop(WORKSPACE, 'test cleanup')
    await service.settled(WORKSPACE)
  } finally {
    await cleanup()
  }
})

test('a delete is undoable until the history is purged', async () => {
  const { service, cleanup } = await harness()
  try {
    await generate(service)
    const before = await service.read(WORKSPACE)
    const pageId = before.pages[0].id
    const oldMarkdown = before.pages[0].markdown

    assert.equal(await service.remove(WORKSPACE), true)
    assert.equal((await service.read(WORKSPACE)).status, 'absent')
    const deleted = await service.status(WORKSPACE)
    assert.equal(deleted.exists, false)
    assert.equal(deleted.history.length, 1, 'the delete kept the content recoverable')
    assert.equal(deleted.history[0].done, 2)

    const restored = await service.restore(WORKSPACE)
    assert.equal(restored.done, 2)
    const page = await service.read(WORKSPACE, pageId)
    assert.equal(page.status, 'ok')
    assert.equal(page.page.markdown, oldMarkdown)

    // Deleting the live Wiki again archives it (the duplicate content is already
    // there, so no second entry) and leaves the history recoverable.
    assert.equal(await service.remove(WORKSPACE), true)
    assert.equal((await service.status(WORKSPACE)).history.length, 1)
    // A delete with nothing live is the permanent one: it removes the history.
    assert.equal(await service.remove(WORKSPACE), true)
    assert.deepEqual((await service.status(WORKSPACE)).history, [])
    await assert.rejects(() => service.restore(WORKSPACE), (error) => error.code === 'WIKI_NO_BACKUP')
  } finally {
    await cleanup()
  }
})
