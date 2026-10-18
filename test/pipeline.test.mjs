/**
 * The generation pipeline, end to end, with a scripted model.
 *
 * These are the tests that decide whether the feature works at all. The pipeline
 * is driven through a real {@link WorkspaceReader} over the sample repository
 * and a model whose every reply is chosen by the test, so each assertion is
 * about the Wiki's own behaviour: that the four stages run in order, that the
 * model's exploration loop is bounded and dispatched correctly, that a page
 * which fails does not lose the pages that succeeded, that a stop keeps what was
 * finished, and that a citation naming a file nobody read cannot reach the
 * finished document.
 *
 * @module dsh-repo-wiki/test/pipeline
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { WikiGenerationError, WikiGenerator, scorePath, stripWrappingFence, tokenize } from '../lib/wiki/pipeline.js'
import { EXPLORE_TOOLS } from '../lib/wiki/prompts.js'
import { SAMPLE_TREE, createScriptedModel, virtualReader } from './helpers.mjs'

const WORKSPACE = { id: 'w1', name: 'sample', root: '/work' }

/** A catalog reply with two pages. */
const CATALOG_REPLY = JSON.stringify({
  catalog: [
    { title: 'Project identity', brief: 'what this project is' },
    { title: 'Main flow', brief: 'what runs in order' },
  ],
})

/**
 * Classify a request into the pipeline stage it belongs to.
 *
 * The pipeline sends no stage label in the request — a model sees prompts, not
 * phases — so the test reads the prompts the same way a model would.
 * @param request - the model request.
 * @returns `'explore' | 'brief' | 'catalog' | 'page' | 'repair'`.
 */
function stageOf(request) {
  const text = request.messages.map((message) => message.content ?? '').join('\n')
  if (text.includes('cited locations that do not exist')) return 'repair'
  if (text.includes('"catalog"')) return 'catalog'
  if (text.includes('Write the page') || text.includes('架构导读中的页面')) return 'page'
  if (request.tools !== undefined && request.tools.some((tool) => tool.name === 'finish')) return 'explore'
  return 'brief'
}

/** A page body whose citations all name files the sample repository really has. */
function pageMarkdown(title) {
  return [
    `${title}: two sentences of orientation. \`src/main.js:1-3\``,
    '',
    '## Mechanism',
    '',
    'What happens, and why. `src/run.js:1-3`',
    '',
    '## Source locations',
    '- src/main.js:1-3',
    '- src/run.js:1-3',
  ].join('\n')
}

/**
 * Build a generator over the sample repository.
 * @param options - the harness options.
 * @returns the generator, the model, and the pages persisted so far.
 */
async function harness(options = {}) {
  const { reader } = await virtualReader(options.tree ?? SAMPLE_TREE)
  /** @type {object[]} */
  const saved = []
  const model = createScriptedModel(async (request, index) => {
    const stage = stageOf(request)
    if (options.onRequest !== undefined) {
      const override = await options.onRequest({ request, stage, index, saved })
      if (override !== undefined) return override
    }
    if (stage === 'explore') {
      if (!request.messages.some((message) => message.role === 'tool')) {
        return {
          text: '',
          toolCalls: [
            { id: 'c1', name: 'list_directory', arguments: { path: 'src' } },
            { id: 'c2', name: 'read_file', arguments: { path: 'src/main.js' } },
            { id: 'c3', name: 'read_file', arguments: { path: 'node_modules/dep/index.js' } },
          ],
        }
      }
      return {
        text: '',
        toolCalls: [{
          id: 'c4',
          name: 'finish',
          arguments: {
            summary: 'A sample project that doubles a value.',
            stack: ['JavaScript', 'Node'],
            entrypoints: ['src/main.js'],
            notes: 'None.',
          },
        }],
      }
    }
    if (stage === 'brief') {
      return JSON.stringify({
        summary: 'A sample project that doubles a value.',
        stack: ['JavaScript'],
        entrypoints: ['src/main.js'],
        notes: '',
      })
    }
    if (stage === 'catalog') return CATALOG_REPLY
    if (stage === 'repair') {
      return `Repaired. \`src/main.js:1-3\`\n\n## Source locations\n- src/main.js:1-3`
    }
    const title = /"([^"]+)"/.exec(request.messages.at(-1).content)?.[1] ?? 'Page'
    return pageMarkdown(title)
  }, { supportsTools: options.supportsTools !== false })

  const generator = new WikiGenerator({
    reader,
    model,
    workspace: WORKSPACE,
    options: options.generatorOptions,
    onEvent: options.onEvent,
    onPage: options.onPage ?? ((document) => {
      saved.push(JSON.parse(JSON.stringify(document)))
    }),
  })
  return { generator, model, reader, saved }
}

test('a full run produces a catalog, pages, verified citations and metadata', async () => {
  const { generator, model, saved } = await harness()
  const document = await generator.run({ language: 'en', diagrams: false, fingerprint: 'fp-1' })

  assert.equal(document.version, 1)
  assert.equal(document.meta.language, 'en')
  assert.equal(document.meta.fingerprint, 'fp-1')
  assert.equal(document.meta.project.summary, 'A sample project that doubles a value.')
  assert.deepEqual(document.meta.project.entrypoints, ['src/main.js'])

  assert.equal(document.catalog.length, 2)
  assert.deepEqual(document.pages.map((page) => page.title), ['Project identity', 'Main flow'])
  assert.deepEqual(document.pages.map((page) => page.status), ['done', 'done'])
  assert.equal(document.pages[0].sources.length, 2)
  assert.equal(document.pages[0].unverifiedSources.length, 0)
  assert.equal(document.pages[0].markdown.includes('## Mechanism'), true)

  // Every page was persisted as it finished, which is what makes a stop safe.
  assert.equal(saved.length >= 3, true)
  assert.equal(saved.at(-1).pages.every((page) => page.status === 'done'), true)

  // The four stages ran, in ZCode's order.
  const phases = []
  const stages = model.requests.map(stageOf)
  assert.deepEqual(stages.slice(0, 2), ['explore', 'explore'])
  assert.equal(stages[2], 'catalog')
  phases.push(stages[2])
  assert.equal(stages[3], 'page')
})

test('the exploration loop dispatches tools, refuses excluded paths, and stops on finish', async () => {
  const { generator, model, reader } = await harness()
  await generator.run({ language: 'en' })

  // The first turn asked for three tools; the second turn is the finish call.
  const toolMessage = model.requests[1].messages.find((message) => message.role === 'tool')
  assert.equal(toolMessage.toolResults.length, 3)
  assert.match(toolMessage.toolResults[0].content, /src\/main\.js/)
  assert.match(toolMessage.toolResults[1].content, /import \{ run \}/)
  assert.match(
    toolMessage.toolResults[2].content,
    /REFUSED/,
    'a dependency file is refused rather than read, and the model is told why',
  )
  assert.equal(reader.readPaths.has('node_modules/dep/index.js'), false)
  assert.equal(model.requests.length, 2 + 1 + 2, 'one catalog call and two page calls follow the two exploration turns')
})

test('without tool support the analysis stage sends one prepared brief', async () => {
  const { generator, model } = await harness({ supportsTools: false })
  const document = await generator.run({ language: 'en' })
  assert.deepEqual(model.requests.map(stageOf), ['brief', 'catalog', 'page', 'page'])
  assert.equal(document.meta.project.summary, 'A sample project that doubles a value.')
})

test('an unverified citation is repaired once, then recorded if it survives', async () => {
  let pageCalls = 0
  const { generator } = await harness({
    onRequest: ({ stage }) => {
      if (stage !== 'page') return undefined
      pageCalls += 1
      if (pageCalls === 1) {
        return 'Bad. `src/invented.ts:1-5` and `src/exists-not-read.ts:1-2`'
      }
      return undefined
    },
  })
  const document = await generator.run({ language: 'en' })
  assert.equal(pageCalls, 2, 'the first page was rewritten once')
  assert.equal(document.pages[0].unverifiedSources.length, 0)
  assert.match(document.pages[0].markdown, /Repaired/)
})

test('a citation that survives repair is recorded as unverified rather than dropped', async () => {
  const { generator } = await harness({
    onRequest: ({ stage }) => (stage === 'page' || stage === 'repair'
      ? 'Claim. `src/invented.ts:1-5`'
      : undefined),
  })
  const document = await generator.run({ language: 'en' })
  assert.equal(document.pages[0].status, 'done')
  assert.equal(document.pages[0].sources.length, 0)
  assert.equal(document.pages[0].unverifiedSources.length, 1)
  assert.match(document.pages[0].unverifiedSources[0].reason, /no such file/)
})

test('a page that fails every attempt does not fail the run', async () => {
  const { generator, saved } = await harness({
    onRequest: ({ stage, request }) => {
      if (stage !== 'page') return undefined
      if (request.messages.at(-1).content.includes('"Main flow"')) {
        throw new Error('provider exploded')
      }
      return undefined
    },
  })
  const document = await generator.run({ language: 'en', retries: 1 })

  assert.equal(document.pages[0].status, 'done')
  assert.equal(document.pages[1].status, 'failed')
  assert.match(document.pages[1].error, /provider exploded/)
  assert.equal(saved.at(-1).pages[1].status, 'failed', 'the failure is persisted too')
})

test('a transient page failure succeeds on the retry and records the attempt count', async () => {
  let attempts = 0
  const { generator } = await harness({
    onRequest: ({ stage, request }) => {
      if (stage !== 'page') return undefined
      if (!request.messages.at(-1).content.includes('"Main flow"')) return undefined
      attempts += 1
      if (attempts === 1) throw new Error('rate limited')
      return pageMarkdown('Main flow')
    },
  })
  const document = await generator.run({ language: 'en', retries: 2 })
  assert.equal(document.pages[1].status, 'done')
  assert.equal(document.pages[1].attempts, 2)
})

test('when every page fails the run fails as a whole and says so', async () => {
  const { generator } = await harness({
    onRequest: ({ stage }) => {
      if (stage === 'page') throw new Error('every page is doomed')
      return undefined
    },
  })
  await assert.rejects(
    () => generator.run({ language: 'en' }),
    (error) => {
      assert.equal(error instanceof WikiGenerationError, true)
      assert.equal(error.phase, 'pages')
      assert.match(error.message, /every one of the 2 pages failed/)
      return true
    },
  )
})

test('a stop keeps the pages already finished and marks the rest', async () => {
  const { generator, saved } = await harness({
    onRequest: ({ stage, request, saved: persisted }) => {
      // Stop as soon as the first page has been written.
      if (stage === 'page' && request.messages.at(-1).content.includes('"Main flow"')) {
        assert.equal(persisted.at(-1).pages[0].status, 'done', 'the first page is already on disk')
        generator.abort('stopped by the user')
      }
      return undefined
    },
  })
  await assert.rejects(
    () => generator.run({ language: 'en' }),
    (error) => {
      assert.equal(error.stopped, true)
      return true
    },
  )
  const last = saved.at(-1)
  assert.equal(last.pages[0].status, 'done', 'the finished page survives')
  assert.equal(last.pages[1].status, 'stopped')
})

test('a catalog that times out falls back to the seed template and still generates', async () => {
  /** @type {object[]} */
  const events = []
  const { generator } = await harness({
    onEvent: (event) => events.push(event),
    onRequest: ({ stage }) => {
      if (stage !== 'catalog') return undefined
      const error = new Error('WIKI_MODEL_TIMEOUT after 180000ms')
      throw error
    },
  })
  const document = await generator.run({ language: 'en' })

  // The run does not fail: it produces pages from the built-in template.
  assert.equal(document.catalog.length, 8)
  assert.equal(document.pages.length, 8)
  assert.deepEqual(document.pages.map((page) => page.status), Array(8).fill('done'))
  assert.equal(document.meta.catalogDegraded, true, 'the document records that the structure is generic')

  const warning = events.find((event) => event.type === 'warning')
  assert.notEqual(warning, undefined, 'the degradation is reported, never silent')
  assert.match(warning.message, /WIKI_MODEL_TIMEOUT/)
})

test('a catalog the model does not answer in JSON falls back the same way', async () => {
  const { generator } = await harness({
    onRequest: ({ stage }) => (stage === 'catalog' ? 'I think a good guide would cover…' : undefined),
  })
  const document = await generator.run({ language: 'zh-CN' })
  assert.equal(document.catalog.length, 8)
  assert.equal(document.meta.catalogDegraded, true)
  assert.match(document.pages[0].title, /\S/, 'the seed titles are localized, not empty')
})

test('a real catalog is used and is not marked degraded', async () => {
  const { generator } = await harness()
  const document = await generator.run({ language: 'en' })
  assert.equal(document.catalog.length, 2)
  assert.equal(document.meta.catalogDegraded, false)
})

test('the seed catalog is localized for the Wiki language', async () => {
  const { generator } = await harness({
    onRequest: ({ stage }) => (stage === 'catalog' ? 'not json at all' : undefined),
  })
  const document = await generator.run({ language: 'zh-CN' })
  assert.equal(document.catalog[0].title, '项目身份')
})

test('the exploration tool schemas are valid JSON Schema, not registry shorthand', () => {
  for (const tool of EXPLORE_TOOLS) {
    const schema = tool.parameters
    assert.equal(schema.type, 'object', `${tool.name}: parameters is an object schema`)
    assert.equal(Array.isArray(schema.required), true, `${tool.name}: required must be a top-level array`)
    for (const [name, property] of Object.entries(schema.properties)) {
      // `required: true` inside a property is invalid per the JSON Schema
      // metaschema; providers that compile tool schemas (guided decoding)
      // reject the whole request with a 400 instead of ignoring it.
      assert.equal(property.required, undefined, `${tool.name}.${name}: property-level required is invalid`)
    }
    for (const name of schema.required) {
      assert.equal(name in schema.properties, true, `${tool.name}: required ${name} must be a property`)
    }
  }
})

test('a provider that rejects the tool-carrying request degrades to the brief analysis', async () => {
  /** @type {object[]} */
  const events = []
  const { generator, model } = await harness({
    onEvent: (event) => events.push(event),
    onRequest: ({ stage }) => {
      if (stage === 'explore') throw new Error('400: {"code":"400","message":"Invalid request parameters"}')
      return undefined
    },
  })
  const document = await generator.run({ language: 'en', diagrams: false })

  assert.equal(document.meta.project.summary, 'A sample project that doubles a value.')
  assert.equal(document.pages.every((page) => page.status === 'done'), true, 'the run completes without tools')
  const warning = events.find((event) => event.type === 'warning' && event.message.includes('retrying without tools'))
  assert.notEqual(warning, undefined, 'the degradation is reported, never silent')
  assert.match(warning.message, /Invalid request parameters/, 'the provider rejection travels with the warning')
  assert.equal(
    model.requests.some((request) => request.tools === undefined && stageOf(request) === 'brief'),
    true,
    'the fallback request goes out tool-free',
  )
})

test('a deliberate stop during exploration is not papered over by the brief fallback', async () => {
  const { generator } = await harness({
    onRequest: ({ stage }) => {
      if (stage === 'explore') {
        const error = new Error('stopped by the user')
        error.stopped = true
        throw error
      }
      return undefined
    },
  })
  await assert.rejects(() => generator.run({ language: 'en' }), (error) => error.stopped === true)
})

test('an abort before any page leaves the whole catalog in the document', async () => {
  const { generator, saved } = await harness({
    onRequest: ({ stage }) => {
      if (stage === 'catalog') generator.abort('cancelled early')
      return undefined
    },
  })
  await assert.rejects(() => generator.run({ language: 'en' }), (error) => error.stopped === true)
  const last = saved.at(-1)
  assert.equal(last.pages.length, 2, 'the catalog is published before pages are written')
  assert.equal(last.pages.every((page) => page.status === 'waiting'), true)
})

test('the catalog is published before the first page is written', async () => {
  /** @type {number[]} */
  const pageCountsAtSave = []
  const { generator } = await harness({
    onPage: (document) => {
      pageCountsAtSave.push(document.pages.length)
    },
  })
  await generator.run({ language: 'en' })
  assert.equal(pageCountsAtSave[0], 0, 'the analysis result is saved before the catalog exists')
  assert.equal(pageCountsAtSave[1], 2, 'the catalog is saved before pages are generated')
})

test('evidence retrieval attaches the corpus within its budget, never an excluded file', async () => {
  const { generator, model } = await harness()
  await generator.run({ language: 'en' })
  const pageRequest = model.requests.find((request) => stageOf(request) === 'page')
  const content = pageRequest.messages.at(-1).content
  assert.match(content, /src\/main\.js/, 'the entrypoint is attached')
  assert.match(content, /src\/run\.js/, 'a file the exploration read is attached')
  assert.match(content, /package\.json/, 'an orienting file is attached')
  assert.equal(content.includes('API_TOKEN=super-secret'), false)
  assert.equal(content.includes('hunter2'), false)
  assert.equal(content.includes('compiled output that must not be read'), false)
})

test('a page request never contains an excluded file, whatever the page is about', async () => {
  const { generator, model } = await harness({
    onRequest: ({ stage }) => (stage === 'catalog'
      ? JSON.stringify({ catalog: [{ title: 'tokenService and .env and secrets', brief: 'credentials' }] })
      : undefined),
  })
  await generator.run({ language: 'en' })
  for (const request of model.requests) {
    const text = request.messages.map((message) => message.content ?? '').join('\n')
    assert.equal(text.includes('API_TOKEN=super-secret'), false, 'the dotenv value never reaches a model')
    assert.equal(text.includes('hunter2'), false, 'the credential file never reaches a model')
    assert.equal(text.includes('a runtime log that must not be read'), false)
    assert.equal(text.includes('compiled output that must not be read'), false)
  }
})

test('relevance scoring favours a filename match over a directory match', () => {
  const terms = tokenize('Main flow')
  // A file *named* for the term is stronger evidence than one merely filed under
  // a directory whose name matches.
  assert.equal(scorePath('src/main.js', terms) > scorePath('src/main/util.js', terms), true)
  assert.equal(scorePath('src/main/util.js', terms) > 0, true, 'a directory match still scores')
  assert.equal(scorePath('docs/guide.md', terms), 0)
  assert.equal(tokenize('项目身份').length > 0, true, 'CJK bigrams are searchable')
})

test('a whole-reply fence is unwrapped, an inner one is not', () => {
  assert.equal(stripWrappingFence('```markdown\n# Title\nbody\n```'), '# Title\nbody')
  assert.equal(stripWrappingFence('# Title\n\n```js\ncode\n```'), '# Title\n\n```js\ncode\n```')
  assert.equal(stripWrappingFence('plain'), 'plain')
})
