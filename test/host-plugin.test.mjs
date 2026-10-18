/**
 * The host half, mounted for real.
 *
 * This suite calls the plugin's own `apply` with a context whose only stand-in is
 * the provider's raw chunk stream, and then speaks to the plugin through the
 * authenticated Fetch routes it registers. Everything between those two points is
 * the shipped implementation: the tool definition, the config schema, the store,
 * the workspace reader, the generation pipeline, the LLM adapter with its
 * `BlockAssembler` and composed deadline, and the JSON the browser tab consumes.
 *
 * That is the closest this environment gets to the running product, and it covers
 * the one module recon alone could not certify — `llm-client.js`, which is the
 * only place the plugin touches DSH's streaming LLM contract.
 *
 * @module dsh-repo-wiki/test/host-plugin
 */

import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as nodeTest } from 'node:test'

/**
 * Load the host half, or record why this checkout cannot.
 *
 * The host code imports `@deepseek-ai/*` packages that belong to the DSH
 * runtime rather than to this repository. A fresh clone has no `node_modules`,
 * so those imports reject with `ERR_MODULE_NOT_FOUND`. That is a missing
 * environment, not a broken plugin: the suite reports every case as skipped
 * instead of failing, and `scripts/verify-install.mjs` is what checks a real
 * installation. Any other error is a genuine defect and is rethrown.
 */
let plugin
let skipReason
try {
  plugin = await import('../lib/index.js')
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
  skipReason = `needs the DSH runtime packages that provide this checkout's peer dependencies: ${error.message.split('\n')[0]}`
}

const { apply, describeWorkspace, resolveWorkspaceRoot, summarizeState, ROUTES } = plugin ?? {}

/** `node:test`, with every case skipped when the DSH runtime is not resolvable. */
const test =
  skipReason === undefined ? nodeTest : (name, fn) => nodeTest(name, { skip: skipReason }, fn)

/** A small real repository on disk, written by the harness. */
const FILES = {
  'package.json': '{"name":"mounted","version":"1.0.0","main":"src/main.js"}',
  'README.md': '# Mounted\n\nA mounted sample.',
  '.gitignore': '*.log\nbuild/\n',
  'src/main.js': 'import { run } from "./run.js"\nexport const main = () => run()\n',
  'src/run.js': 'export function run() {\n  return 42\n}\n',
  'build/out.js': 'compiled output',
  '.env': 'API_TOKEN=do-not-leak',
}

/**
 * Write a repository to a temporary directory.
 * @param root - the directory to populate.
 */
async function seedRepository(root) {
  for (const [path, contents] of Object.entries(FILES)) {
    const absolute = join(root, ...path.split('/'))
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, contents, 'utf8')
  }
}

/**
 * Build the chunk stream a provider would send for one reply.
 * @param text - the reply text.
 * @returns the chunks.
 */
function textChunks(text) {
  // Deliberately split across deltas, so chunk assembly is exercised rather than
  // bypassed by a single complete delta.
  const middle = Math.floor(text.length / 2)
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: text.slice(0, middle) },
    { type: 'text-delta', index: 0, text: text.slice(middle) },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Build the chunk stream for one tool call.
 * @param call - `{ id, name, arguments }`.
 * @returns the chunks.
 */
function toolChunks(call) {
  const args = JSON.stringify(call.arguments)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: call.id, name: call.name, arguments: args } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * Mount the plugin over a real temporary workspace and store.
 * @param [options] - harness overrides.
 * @returns the harness.
 */
async function mount(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wiki-host-'))
  const workspaceRoot = join(root, 'project')
  const dataDir = join(root, 'data')
  await mkdir(workspaceRoot, { recursive: true })
  await seedRepository(workspaceRoot)

  /** @type {object[]} */
  const streamRequests = []
  /** @type {any[]} */
  const toolDefinitions = []
  /** @type {{ path: string, methods: string[], fetch: Function }[]} */
  const routes = []
  /** @type {object[]} */
  const commands = []
  /** @type {object[]} */
  const injections = []

  /**
   * The provider's chunk stream. The decision of what to reply is the only thing
   * faked here; every message the plugin built is visible in `options`.
   * @param generateOptions - the assembled request from `llm-client.js`.
   */
  async function* stream(generateOptions) {
    streamRequests.push(generateOptions)
    const joined = [
      generateOptions.system ?? '',
      ...generateOptions.messages.flatMap((message) => message.content.map((block) => block.text ?? block.arguments ?? '')),
    ].join('\n')

    if (options.failEveryPage === true && joined.includes('Write the page')) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider exploded', code: 'TRANSPORT' } } }
      return
    }

    if (Array.isArray(generateOptions.tools) && generateOptions.tools.length > 0) {
      const hasToolResult = generateOptions.messages.some((message) =>
        message.content.some((block) => block.type === 'tool-result'))
      if (hasToolResult) {
        for (const chunk of toolChunks({
          id: 'finish-1',
          name: 'finish',
          arguments: {
            summary: 'A mounted sample that returns forty-two.',
            stack: ['JavaScript'],
            entrypoints: ['src/main.js'],
            notes: 'None.',
          },
        })) yield chunk
        return
      }
      for (const chunk of toolChunks({ id: 'call-1', name: 'read_file', arguments: { path: 'src/main.js' } })) yield chunk
      return
    }

    if (joined.includes('"catalog"')) {
      for (const chunk of textChunks(JSON.stringify({
        catalog: [
          { title: 'Project identity', brief: 'what this is' },
          { title: 'Main flow', brief: 'what runs' },
        ],
      }))) yield chunk
      return
    }

    if (joined.includes('cited locations that do not exist')) {
      for (const chunk of textChunks('Repaired. `src/main.js:1-2`')) yield chunk
      return
    }

    // `pageDelayMs` gives the stop test a window in which a page is genuinely in
    // flight, so "stopping keeps what finished" is asserted against a real race
    // rather than against whatever order the scheduler happened to pick.
    if (options.pageDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.pageDelayMs))
    }
    for (const chunk of textChunks('Orientation. `src/main.js:1-2`\n\n## Source locations\n- src/main.js:1-2')) yield chunk
  }

  const ctx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    llm: { stream },
    get: () => undefined,
    tools: {
      register: (definition) => {
        toolDefinitions.push(definition)
        return () => {}
      },
    },
    inject: (deps, callback) => {
      injections.push(deps)
      const scoped = {
        ...ctx,
        commands: {
          register: (command) => {
            commands.push(command)
            return () => {}
          },
        },
        sessions: { list: () => [] },
        connection: {
          fetch: {
            register: (route) => {
              routes.push(route)
              return () => Promise.resolve()
            },
          },
        },
      }
      callback(scoped)
      return { dispose: () => {} }
    },
    effect: (callback) => {
      callback()
      return () => {}
    },
  }

  const dispose = apply(ctx, {
    .../** the schema's defaults, which the loader would have applied */{
      language: 'en',
      requestTimeoutMs: 10000,
      maxOutputTokens: 2048,
      retries: 0,
      diagrams: false,
      exploration: 'tools',
      autoRefresh: true,
      checkStale: true,
      // With no session in the harness, the route has to come from configuration;
      // this is also the deployment shape for a headless run.
      provider: 'test-provider',
      model: 'test-model',
      maxScanFiles: 5000,
      excludedDirectories: [],
      excludedExtensions: [],
      excludedFiles: [],
      sourceExtensions: [],
      useGitignore: true,
      nestedGitignore: true,
      historyRetentionDays: 3,
      historyMaxEntries: 30,
    },
    dataDir,
    workspaceRoot,
    ...options.config,
  })

  return {
    ctx,
    root,
    workspaceRoot,
    dataDir,
    dispose,
    streamRequests,
    toolDefinitions,
    routes,
    commands,
    injections,
    /** Call one registered route, with or without a query string. */
    async call(path, init = {}) {
      const [pathname] = path.split('?')
      const route = routes.find((candidate) => candidate.path === pathname)
      if (route === undefined) throw new Error(`no route ${pathname}; registered: ${routes.map((r) => r.path).join(', ')}`)
      const request = new Request(`http://127.0.0.1${path}`, init)
      const response = await route.fetch(request)
      return { status: response.status, body: await response.json() }
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/** Poll the state route until no task is running. */
async function settle(harness, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { body } = await harness.call(`${ROUTES.state}?sessionId=x`)
    if (body.state.task === null || body.state.task.state !== 'running') return body
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('the generation did not settle')
}

test('mounting registers one tool, nine routes, two commands and three optional-service hooks', async () => {
  const harness = await mount()
  try {
    assert.equal(harness.toolDefinitions.length, 1)
    const tool = harness.toolDefinitions[0]
    assert.equal(tool.name, 'repo_wiki')
    assert.match(tool.description, /architecture guide/)
    // `defineTool` converts the parameter shorthand into a JSON Schema before the
    // registry sees it, which is what the model is actually sent.
    assert.deepStrictEqual(tool.parameters.properties.action.enum, ['status', 'generate', 'read', 'stop', 'remove', 'refresh', 'list', 'regenerate-page', 'restore'])
    assert.equal(tool.parameters.required.includes('action'), true)
    assert.deepStrictEqual(
      Object.keys(tool.parameters.properties).sort(),
      ['action', 'diagrams', 'language', 'model', 'pageId', 'provider', 'retries', 'versionId'],
    )
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.output.schema, 'object')

    assert.deepStrictEqual(harness.routes.map((route) => route.path).sort(), Object.values(ROUTES).sort())
    for (const route of harness.routes) {
      assert.equal(route.requestBody, 'buffered')
      assert.equal(typeof route.fetch, 'function')
    }
    assert.deepStrictEqual(
      harness.routes.find((route) => route.path === ROUTES.generate).methods,
      ['POST'],
    )
    assert.deepStrictEqual(harness.routes.find((route) => route.path === ROUTES.state).methods, ['GET'])

    assert.deepStrictEqual(harness.commands.map((command) => command.name).sort(), ['wiki', 'wiki-delete'])
    assert.equal(typeof harness.commands[0].handler, 'function')

    // The optional surfaces are attached through `ctx.inject`, never `inject`, so a
    // profile without a webserver or a command surface still loads the plugin.
    assert.deepStrictEqual(
      harness.injections.map((deps) => deps.join(',')).sort(),
      ['commands', 'connection', 'sessions'],
    )
    assert.equal(typeof harness.dispose, 'function')
  } finally {
    await harness.cleanup()
  }
})

test('state on a workspace with no Wiki reports absence rather than failing', async () => {
  const harness = await mount()
  try {
    const { status, body } = await harness.call(`${ROUTES.state}?sessionId=x`)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.state.exists, false)
    assert.equal(body.state.wiki, null)
    assert.equal(body.state.task, null)
    assert.equal(body.state.stale, false)
    // Four files are readable: the manifest, the readme and the two sources. The
    // dotenv and the build output are excluded, and `.gitignore` is a scan input
    // rather than content, so none of the three counts.
    assert.equal(body.state.fingerprint.files, 4)
  } finally {
    await harness.cleanup()
  }
})

test('a generation started over HTTP runs the four stages and stores a source-cited Wiki', async () => {
  const harness = await mount()
  try {
    const started = await harness.call(ROUTES.generate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', language: 'en' }),
    })
    assert.equal(started.body.ok, true)
    assert.equal(started.body.task.state, 'running')

    const settled = await settle(harness)
    assert.equal(settled.state.task.state, 'done', settled.state.task.error ?? '')
    assert.equal(settled.state.task.phase, 'saving')
    assert.equal(settled.state.exists, true)
    assert.equal(settled.wiki.counts.done, 2)
    assert.equal(settled.wiki.meta.language, 'en')
    assert.equal(settled.wiki.meta.project.summary, 'A mounted sample that returns forty-two.')
    assert.equal(settled.wiki.citations.unverified, 0)
    assert.equal(settled.wiki.citations.verified > 0, true)
    assert.equal(settled.state.stale, false)

    // The document really is on disk, under the plugin's own directory, and not in
    // the repository it describes.
    const storeRoot = join(harness.dataDir, 'repo-wiki')
    const keys = await readdir(storeRoot)
    assert.equal(keys.length, 1)
    const stored = await readFile(join(storeRoot, keys[0], 'wiki.json'), 'utf8')
    assert.match(stored, /"markdown"/)
    assert.equal(stored.includes('do-not-leak'), false, 'a secret file must never reach the stored Wiki')
    assert.equal(keys[0].length, 16, 'the workspace key is the documented hash')
  } finally {
    await harness.cleanup()
  }
})

test('the model never receives an excluded file, through the real adapter', async () => {
  const harness = await mount()
  try {
    await harness.call(ROUTES.generate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', language: 'en' }),
    })
    await settle(harness)

    assert.equal(harness.streamRequests.length > 0, true)
    for (const request of harness.streamRequests) {
      const serialized = JSON.stringify(request)
      assert.equal(serialized.includes('do-not-leak'), false, 'the dotenv value never reaches a request')
      assert.equal(serialized.includes('compiled output'), false, 'build output never reaches a request')
      // The request is a real DSH request: messages carry content blocks and a
      // source, which is what the constructors guarantee.
      assert.equal(Array.isArray(request.messages), true)
      for (const message of request.messages) {
        assert.equal(Array.isArray(message.content), true)
        assert.equal(typeof message.source, 'object')
        assert.equal(typeof message.id, 'string')
      }
      assert.equal(request.provider.length > 0, true)
      assert.equal(request.model.length > 0, true)
    }

    // The exploration tool schema the plugin advertised reached the provider, and
    // the tool results came back as tool-result blocks correlated by call id.
    const exploration = harness.streamRequests.find((request) => Array.isArray(request.tools))
    assert.notEqual(exploration, undefined)
    assert.deepStrictEqual(exploration.tools.map((tool) => tool.name), ['list_directory', 'read_file', 'finish'])
    const toolResults = harness.streamRequests
      .flatMap((request) => request.messages)
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'tool-result')
    assert.equal(toolResults.length > 0, true)
    assert.equal(toolResults.every((block) => typeof block.toolCallId === 'string'), true)
  } finally {
    await harness.cleanup()
  }
})

test('reading a page over HTTP returns its Markdown and verified source locations', async () => {
  const harness = await mount()
  try {
    await harness.call(ROUTES.generate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', language: 'en' }),
    })
    const settled = await settle(harness)
    const first = settled.wiki.pages[0]

    const read = await harness.call(`${ROUTES.read}?sessionId=x&pageId=${first.id}`)
    assert.equal(read.body.ok, true)
    assert.equal(read.body.page.id, first.id)
    assert.match(read.body.page.markdown, /src\/main\.js:1-2/)
    assert.deepStrictEqual(
      read.body.page.sources.map((source) => `${source.path}:${source.start}-${source.end}`),
      ['src/main.js:1-2'],
    )

    const missing = await harness.call(`${ROUTES.read}?sessionId=x&pageId=nope`)
    assert.equal(missing.body.ok, false)
    assert.equal(missing.body.status, 'not-found')
  } finally {
    await harness.cleanup()
  }
})

test('a total failure is reported through the task and leaves the catalog readable', async () => {
  const harness = await mount({ failEveryPage: true })
  try {
    await harness.call(ROUTES.generate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', language: 'en' }),
    })
    const settled = await settle(harness)
    assert.equal(settled.state.task.state, 'failed')
    assert.match(settled.state.task.error, /every one of the 2 pages failed/)
    assert.equal(settled.state.exists, true, 'the catalog survived the failure')
    assert.equal(settled.wiki.counts.failed, 2)
    assert.equal(settled.wiki.pages[0].error.includes('provider exploded'), true)
  } finally {
    await harness.cleanup()
  }
})

test('stopping over HTTP keeps finished pages and reports a stopped task', async () => {
  // Each page takes 60ms, so the stop lands while the second page is in flight and
  // the first has already been written to disk.
  const harness = await mount({ pageDelayMs: 60 })
  try {
    await harness.call(ROUTES.generate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', language: 'en' }),
    })

    // Wait until the first page has genuinely finished, so the stop lands on the
    // second page and "the finished page is kept" is a claim about real work.
    const deadline = Date.now() + 10000
    let snapshot = null
    while (Date.now() < deadline) {
      const { body } = await harness.call(`${ROUTES.state}?sessionId=x`)
      snapshot = body
      if (body.state.task?.progress?.done >= 1) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.notEqual(snapshot, null)
    assert.equal(snapshot.state.task.progress.done, 1, 'the first page finished before the stop')
    assert.equal(snapshot.state.task.progress.total, 2, 'the catalog was published before pages')

    const stopped = await harness.call(ROUTES.stop, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    assert.equal(stopped.body.stopped, true, 'a running task accepts a stop')

    const settled = await settle(harness)
    assert.equal(settled.state.task.state, 'stopped')
    assert.equal(settled.state.exists, true, 'the catalog and the finished page are on disk')
    assert.equal(settled.wiki.pages[0].status, 'done', 'the finished page is kept')
    // Where the stop lands relative to page two's own start is a race, and both
    // outcomes are correct: `waiting` means it never began, `stopped` means it was
    // cut off. What must never happen is a page that was interrupted being
    // presented as complete, or counted as a failure the user should investigate.
    const second = settled.wiki.pages[1].status
    assert.equal(
      ['waiting', 'stopped'].includes(second),
      true,
      `an interrupted page must be neither done nor failed, got ${second}`,
    )

    // A settled task refuses a second stop rather than claiming it did something.
    const again = await harness.call(ROUTES.stop, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    assert.equal(again.body.stopped, false)
  } finally {
    await harness.cleanup()
  }
})

test('deleting over HTTP removes the Wiki and leaves the repository untouched', async () => {
  const harness = await mount()
  try {
    await harness.call(ROUTES.generate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', language: 'en' }),
    })
    await settle(harness)

    const removed = await harness.call(ROUTES.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    assert.equal(removed.body.removed, true)

    const after = await harness.call(`${ROUTES.state}?sessionId=x`)
    assert.equal(after.body.state.exists, false)
    assert.equal(await readFile(join(harness.workspaceRoot, 'src', 'main.js'), 'utf8'), FILES['src/main.js'])
  } finally {
    await harness.cleanup()
  }
})

test('a deleted Wiki can be restored over HTTP, and a second delete forgets the copy', async () => {
  const harness = await mount()
  try {
    const nothing = await harness.call(ROUTES.restore, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    assert.equal(nothing.status, 404)
    assert.equal(nothing.body.ok, false)
    assert.match(nothing.body.error, /no previous version/)

    await harness.call(ROUTES.generate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', language: 'en' }),
    })
    await settle(harness)

    await harness.call(ROUTES.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    const deleted = await harness.call(`${ROUTES.state}?sessionId=x`)
    assert.equal(deleted.body.state.exists, false)
    assert.equal(deleted.body.state.history.length, 1, 'the state exposes the recoverable versions')
    assert.equal(deleted.body.state.history[0].done, 2)

    const restored = await harness.call(ROUTES.restore, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    assert.equal(restored.status, 200)
    assert.equal(restored.body.ok, true)
    assert.equal(restored.body.restored.done, 2)
    assert.equal(restored.body.restored.total, 2)

    const after = await harness.call(`${ROUTES.state}?sessionId=x`)
    assert.equal(after.body.state.exists, true)
    assert.equal(after.body.wiki.counts.done, 2)

    // The delete while a live Wiki exists keeps the history; the delete with
    // nothing live is the permanent one and clears every archived version.
    await harness.call(ROUTES.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    assert.equal((await harness.call(`${ROUTES.state}?sessionId=x`)).body.state.history.length, 1)
    await harness.call(ROUTES.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    const gone = await harness.call(`${ROUTES.state}?sessionId=x`)
    assert.equal(gone.body.state.exists, false)
    assert.deepEqual(gone.body.state.history, [])
  } finally {
    await harness.cleanup()
  }
})

test('the model list and the refresh route answer without a generation', async () => {
  const harness = await mount()
  try {
    const models = await harness.call(ROUTES.models)
    assert.equal(models.body.ok, true)
    assert.deepEqual(models.body.providers, [], 'listProviders is absent from the stub, which must not fail the route')

    const refresh = await harness.call(ROUTES.refresh, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x', auto: true }),
    })
    assert.equal(refresh.body.outcome, 'absent')
  } finally {
    await harness.cleanup()
  }
})

test('the repo_wiki tool drives the same service the routes do', async () => {
  const harness = await mount()
  try {
    const tool = harness.toolDefinitions[0]
    const exec = { signal: new AbortController().signal, agent: undefined }

    const initial = await tool.execute({ action: 'status' }, exec)
    assert.equal(initial.ok, true)
    assert.match(initial.message, /No Wiki yet/)

    const generated = await tool.execute({ action: 'generate', language: 'en' }, exec)
    assert.equal(generated.ok, true)
    assert.match(generated.message, /generation started/)

    // A second generate while one runs is refused, not queued: two runs would
    // interleave their saves.
    const busy = await tool.execute({ action: 'generate' }, exec)
    assert.equal(busy.ok, false)
    assert.match(busy.message, /already running/)

    await settle(harness)

    const after = await tool.execute({ action: 'status' }, exec)
    assert.equal(after.ok, true)
    assert.match(after.message, /2\/2 pages done/)

    const list = await tool.execute({ action: 'list' }, exec)
    assert.equal(list.ok, true)
    assert.match(list.message, /1 workspace has a Wiki/)

    const pageId = JSON.parse(after.detail).wiki.pages[0].id
    const page = await tool.execute({ action: 'read', pageId }, exec)
    assert.equal(page.ok, true)
    assert.match(page.message, /src\/main\.js/)
    assert.match(page.detail, /Verified source locations/)

    const unknown = await tool.execute({ action: 'read' }, exec)
    assert.equal(unknown.ok, false, 'read without a pageId is refused with guidance')

    const refresh = await tool.execute({ action: 'refresh' }, exec)
    assert.equal(refresh.ok, true)
    assert.match(refresh.message, /unchanged/)

    const stopped = await tool.execute({ action: 'stop' }, exec)
    assert.equal(stopped.ok, false, 'nothing is running')

    const removed = await tool.execute({ action: 'remove' }, exec)
    assert.equal(removed.ok, true)
    const gone = await tool.execute({ action: 'status' }, exec)
    assert.match(gone.message, /No Wiki yet/)

    // The tool exposes the same undo the tab does.
    const restored = await tool.execute({ action: 'restore' }, exec)
    assert.equal(restored.ok, true)
    assert.match(restored.message, /Restored the .* Wiki version/)
    const back = await tool.execute({ action: 'status' }, exec)
    assert.match(back.message, /2\/2 pages done/)
  } finally {
    await harness.cleanup()
  }
})

test('the workspace root comes from the session, never from the caller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wiki-resolve-'))
  try {
    const workspaceRoot = join(root, 'ws')
    await mkdir(workspaceRoot, { recursive: true })

    // A session's creation metadata wins.
    const withSession = resolveWorkspaceRoot({ get: () => undefined }, {
      config: { workspaceRoot: 'ignored' },
      session: { header: { cwd: workspaceRoot } },
    })
    assert.equal(withSession, workspaceRoot)

    // Then the sandbox policy.
    const withPolicy = resolveWorkspaceRoot({
      get: (name) => (name === 'sandboxPolicy' ? { resolve: () => ({ workspaceRoot }) } : undefined),
    }, { config: {} })
    assert.equal(withPolicy, workspaceRoot)

    // Then the configured override, and finally the process working directory.
    assert.equal(
      resolveWorkspaceRoot({ get: () => undefined }, { config: { workspaceRoot } }),
      workspaceRoot,
    )
    assert.equal(
      resolveWorkspaceRoot({ get: () => undefined }, { config: {} }),
      process.cwd(),
    )

    // A session named by id is looked up through the sessions service.
    const byId = resolveWorkspaceRoot({
      get: (name) => (name === 'sessions' ? { get: (id) => (id === 's1' ? { header: { cwd: workspaceRoot } } : undefined) } : undefined),
    }, { config: {}, sessionId: 's1' })
    assert.equal(byId, workspaceRoot)

    const described = await describeWorkspace(workspaceRoot)
    assert.equal(described.root, workspaceRoot)
    assert.equal(described.name, 'ws')
    assert.match(described.id, /^[0-9a-f]{16}$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a status summary reads as one actionable line', () => {
  const absent = summarizeState({ exists: false, unreadable: null, stale: false, wiki: null, task: null })
  assert.match(absent, /No Wiki yet/)

  const generating = summarizeState({
    exists: false,
    unreadable: null,
    stale: false,
    wiki: null,
    task: { state: 'running', phase: 'pages', progress: { index: 3, total: 12, title: 'Main flow' } },
  })
  assert.match(generating, /Generating \(pages, 3\/12: Main flow\)/)

  const complete = summarizeState({
    exists: true,
    unreadable: null,
    stale: true,
    wiki: {
      counts: { done: 9, failed: 1, total: 12 },
      citations: { verified: 40, unverified: 2 },
      meta: { language: 'zh-CN' },
    },
    task: { state: 'done', progress: { index: 12, total: 12, title: null } },
  })
  assert.match(complete, /9\/12 pages done/)
  assert.match(complete, /1 failed/)
  assert.match(complete, /40 verified source locations/)
  assert.match(complete, /2 unverified/)
  assert.match(complete, /language zh-CN/)
  assert.match(complete, /code changed/)

  // An archived version says it is recoverable, and a delete says the same even
  // though no live Wiki exists.
  const dropped = summarizeState({
    exists: true,
    unreadable: null,
    stale: false,
    history: [{ id: 'x', done: 9, total: 12 }],
    wiki: { counts: { done: 2, failed: 0, total: 12 }, citations: { verified: 4, unverified: 0 }, meta: { language: 'en' } },
    task: { state: 'stopped', error: null, progress: { index: 3, total: 12, title: null } },
  })
  assert.match(dropped, /1 archived version kept; newest 9\/12 pages done/)

  const deleted = summarizeState({
    exists: false,
    unreadable: null,
    stale: false,
    history: [{ id: 'x', done: 12, total: 12 }],
    wiki: null,
    task: null,
  })
  assert.match(deleted, /No Wiki yet/)
  assert.match(deleted, /1 archived version kept; newest 12\/12 pages done/)
})
