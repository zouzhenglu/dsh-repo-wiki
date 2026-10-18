/**
 * The browser half, tested headlessly.
 *
 * There is no browser in this environment, so the client bundle is loaded the way
 * the shell loads it — by handing a stubbed `window.__ModuleLoader__` a factory —
 * and driven with a minimal React element implementation. That is enough to
 * assert the two things that would otherwise only fail in front of a user:
 *
 * 1. **The registration contract.** Which tab type, which slot registration keys,
 *    which locale namespace, and which CSS the plugin contributes. A wrong key
 *    there produces a tab that never opens, with no error anywhere.
 * 2. **What the views render.** The article views are pure functions of their
 *    props by design, so their element trees are asserted directly — including
 *    the distinction that matters most, between a verified source location that
 *    opens the file and a rejected one that does not pretend to be a link.
 *
 * @module dsh-repo-wiki/test/client-bundle
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

/**
 * A minimal React element implementation plus a single-pass hook runtime.
 *
 * Enough for a component that reads state and memoizes a value; deliberately not
 * a reconciler, because nothing here re-renders.
 * @returns {object} the React stand-in plus a `render` helper.
 */
function createReactShim() {
  /** @type {any[]} */
  let cells = []
  let cursor = 0

  const react = {
    /**
     * Build an element. Children land in `props.children`, flattened, with
     * `null`/`undefined`/`false` dropped exactly as React drops them.
     * @param type - the element type.
     * @param props - the element props.
     * @param children - the children.
     * @returns the element.
     */
    createElement(type, props, ...children) {
      const next = { ...(props ?? {}) }
      const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
      next.children = flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat
      return { type, props: next }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial
      return [cells[index], (value) => { cells[index] = typeof value === 'function' ? value(cells[index]) : value }]
    },
    useMemo(factory) {
      cursor += 1
      return factory()
    },
    useCallback(fn) {
      cursor += 1
      return fn
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in cells)) cells[index] = { current: initial }
      return cells[index]
    },
    useEffect() {
      cursor += 1
    },
  }

  return {
    react,
    /**
     * Run one render pass of a component.
     * @param component - the component function.
     * @param props - its props.
     * @returns the element tree.
     */
    render(component, props) {
      cells = []
      cursor = 0
      return component(props)
    },
  }
}

/**
 * Copy a value into this realm before comparing it.
 *
 * The client bundle runs inside a `vm` context, so the arrays and objects it
 * produces carry that realm's prototypes; a strict deep comparison against a
 * literal built here would fail on identity alone. Copying through JSON is the
 * smallest way to compare *content*, which is what these assertions are about.
 * @param value - the value to copy.
 * @returns the copy, in this realm.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Load `lib/client.js` the way the shell does.
 * @returns the plugin's exports, the captured module definition, and helpers.
 */
function loadClient() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  /** @type {object | null} */
  let definition = null
  /** @type {object[]} */
  const appended = []
  const documentStub = {
    createElement: () => ({ setAttribute: () => {}, remove: () => {}, textContent: '' }),
    head: { appendChild: (node) => appended.push(node) },
  }
  const windowStub = {
    __ModuleLoader__: { load: (value) => { definition = value } },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const sandbox = {
    window: windowStub,
    document: documentStub,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    Promise,
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })

  assert.notEqual(definition, null, 'the bundle must call window.__ModuleLoader__.load')
  const shim = createReactShim()
  const requested = []
  const exported = definition.factory((name) => {
    requested.push(name)
    if (name === 'react') return shim.react
    throw new Error(`the bundle required an undeclared module: ${name}`)
  })
  return { definition, exported, ...shim, requested, appended }
}

/**
 * Walk an element tree, collecting every element a predicate accepts.
 * @param tree - the element tree.
 * @param predicate - the test.
 * @returns the matching elements.
 */
function findAll(tree, predicate) {
  const found = []
  const visit = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (predicate(node)) found.push(node)
    if (node.props !== undefined) visit(node.props.children)
  }
  visit(tree)
  return found
}

/**
 * Collect every string in an element tree.
 * @param tree - the element tree.
 * @returns the concatenated text.
 */
function textOf(tree) {
  const parts = []
  const visit = (node) => {
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
      return
    }
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node.props !== undefined) visit(node.props.children)
  }
  visit(tree)
  return parts.join(' ')
}

/** The translator the tests use: the key itself, so assertions read literally. */
const t = (key) => key

test('the bundle loads through the module loader and requires only baseline modules', () => {
  const { definition, exported, requested } = loadClient()
  assert.equal(definition.id, 'dsh-repo-wiki')
  assert.equal(typeof definition.factory, 'function')
  assert.equal(typeof exported.apply, 'function')
  assert.deepStrictEqual(requested, ['react'], 'every import must be a baseline seed word')
  assert.deepStrictEqual(plain(exported.inject), ['slots', 'locale', 'sidebarRightTabs'])
})

test('applying the plugin registers the tab type, both slot keys, the locale and the stylesheet', () => {
  const { exported, appended } = loadClient()
  /** @type {object[]} */
  const effects = []
  /** @type {object | null} */
  let tabType = null
  /** @type {{ name: string, key: string, locale?: string }[]} */
  const slots = []
  /** @type {object | null} */
  let dictionaries = null
  /** @type {string[]} */
  const injected = []

  const ctx = {
    effect: (callback, label) => {
      effects.push({ label, dispose: callback() })
    },
    locale: {
      bind: () => (key) => `t:${key}`,
      register: (namespace, dict) => {
        assert.equal(namespace, 'repoWiki')
        dictionaries = dict
        return () => {}
      },
    },
    sidebarRightTabs: {
      register: (definition) => {
        tabType = definition
        return () => {}
      },
    },
    slots: {
      inject: (name, callback) => {
        injected.push(name)
        callback()
        return () => {}
      },
      register: (options, component) => {
        slots.push({ ...options, component })
        return () => {}
      },
    },
  }

  exported.apply(ctx)

  assert.notEqual(tabType, null)
  assert.equal(tabType.id, 'dsh-repo-wiki')
  assert.equal(tabType.kind, 'repo-wiki')
  assert.equal(tabType.priority, 'extension')
  assert.equal(tabType.title(), 't:title')
  assert.equal(tabType.guide.length, 1)
  assert.equal(typeof tabType.guide[0].order, 'number')
  assert.equal(tabType.guide[0].title(), 't:guideTitle')

  assert.deepStrictEqual(injected, ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  assert.deepStrictEqual(slots.map((slot) => slot.key), ['dsh-repo-wiki', 'dsh-repo-wiki'])
  assert.deepStrictEqual(slots.map((slot) => slot.name), ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  assert.equal(slots[0].locale, 'repoWiki')
  assert.equal(typeof slots[0].component, 'function')
  assert.equal(typeof slots[1].component, 'function')

  assert.notEqual(dictionaries, null)
  assert.equal(Object.keys(dictionaries).length, 2)
  assert.equal(typeof dictionaries['zh-CN'].title, 'string')
  assert.equal(typeof dictionaries.en.title, 'string')
  // Every key the tab asks for exists in both languages, so no label can render
  // as a raw key in one language only.
  assert.deepStrictEqual(
    plain(Object.keys(dictionaries['zh-CN']).sort()),
    plain(Object.keys(dictionaries.en).sort()),
  )

  assert.equal(effects.length, 5, 'styles, dictionaries, tab type, body, title')
  assert.equal(appended.length, 1, 'the stylesheet is injected once')
  for (const effect of effects) assert.equal(typeof effect.dispose, 'function', `${effect.label} must be disposable`)
})

test('a source location is only a citation when it has a real range', () => {
  const { exported } = loadClient()
  const { matchCitation } = exported.__internals
  assert.deepStrictEqual(plain(matchCitation('src/a.ts:10-24')), { path: 'src/a.ts', start: 10, end: 24 })
  assert.deepStrictEqual(plain(matchCitation('src/a.ts:7')), { path: 'src/a.ts', start: 7, end: 7 })
  assert.deepStrictEqual(plain(matchCitation('src\\a.ts:1-2')), { path: 'src/a.ts', start: 1, end: 2 })
  assert.equal(matchCitation('src/a.ts'), null)
  assert.equal(matchCitation('src/a.ts:20-10'), null)
  assert.equal(matchCitation('src/a.ts:0'), null)
  assert.equal(matchCitation('see line 5'), null)
})

test('block parsing recognizes the shapes the page prompts ask for', () => {
  const { exported } = loadClient()
  const blocks = exported.__internals.parseBlocks([
    'Orientation paragraph.',
    '',
    '## Mechanism',
    '',
    '- one item',
    '- another item',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[One] --> B[Two]',
    '```',
    '',
    '> a quoted caution',
    '',
    'Closing paragraph.',
  ].join('\n'))

  assert.deepStrictEqual(plain(blocks.map((block) => block.type)), [
    'paragraph',
    'heading',
    'list',
    'code',
    'quote',
    'paragraph',
  ])
  assert.equal(blocks[1].level, 2)
  assert.equal(blocks[1].text, 'Mechanism')
  assert.deepStrictEqual(plain(blocks[2].items), ['one item', 'another item'])
  assert.equal(blocks[3].language, 'mermaid')
  assert.equal(blocks[4].text, 'a quoted caution')
})

test('a Markdown table parses into a head, an alignment row and a body', () => {
  const { exported } = loadClient()
  const blocks = exported.__internals.parseBlocks([
    'Prose before.',
    '',
    '| Layer | Owns | Notes |',
    '| :--- | ---: | :---: |',
    '| host | routes | `lib/index.js:1-2` |',
    '| client | views | narrow |',
    '',
    '---',
    '',
    'Prose after.',
  ].join('\n'))

  assert.deepStrictEqual(plain(blocks.map((block) => block.type)), ['paragraph', 'table', 'rule', 'paragraph'])
  assert.deepStrictEqual(plain(blocks[1].head), ['Layer', 'Owns', 'Notes'])
  assert.deepStrictEqual(plain(blocks[1].align), ['left', 'right', 'center'])
  assert.equal(blocks[1].rows.length, 2)
  assert.deepStrictEqual(plain(blocks[1].rows[0]), ['host', 'routes', '`lib/index.js:1-2`'])
})

test('a pipe in prose is not mistaken for a table', () => {
  const { exported } = loadClient()
  const blocks = exported.__internals.parseBlocks(['Use a | b carefully', '', '| a | b |'].join('\n'))
  assert.deepStrictEqual(plain(blocks.map((block) => block.type)), ['paragraph', 'paragraph'])
})

test('a flowchart parses into nodes and edges, and anything else is unsupported', () => {
  const { exported } = loadClient()
  const { parseMermaidFlowchart } = exported.__internals

  const graph = parseMermaidFlowchart([
    'flowchart LR',
    '  entry[Entry point] --> load{Load config}',
    '  load --> run([Run])',
    '  run --> entry',
  ].join('\n'))
  assert.equal(graph.kind, 'flowchart')
  assert.equal(graph.direction, 'LR')
  assert.deepStrictEqual(plain(graph.nodes.map((node) => node.id)), ['entry', 'load', 'run'])
  assert.equal(graph.nodes[0].label, 'Entry point')
  assert.equal(graph.nodes[1].label, 'Load config')
  assert.deepStrictEqual(plain(graph.edges), [
    { from: 'entry', to: 'load' },
    { from: 'load', to: 'run' },
    { from: 'run', to: 'entry' },
  ])

  assert.equal(parseMermaidFlowchart('sequenceDiagram\n  A->>B: hi').kind, 'unsupported')
  assert.equal(parseMermaidFlowchart('stateDiagram-v2\n  [*] --> A').kind, 'unsupported')
  assert.equal(parseMermaidFlowchart('').kind, 'unsupported')
})

test('layout layers a chain and terminates on a cycle', () => {
  const { exported } = loadClient()
  const { layoutFlowchart, parseMermaidFlowchart } = exported.__internals

  const chain = parseMermaidFlowchart('flowchart TD\n A --> B\n B --> C')
  const laid = layoutFlowchart(chain)
  assert.deepStrictEqual(plain(laid.layers), [['A'], ['B'], ['C']])
  // Positions are measured SVG coordinates, not layer indices: each layer sits
  // one node-thickness further down, so the offsets are strictly increasing.
  const ya = laid.positions.get('A').y
  const yb = laid.positions.get('B').y
  const yc = laid.positions.get('C').y
  assert.ok(ya < yb && yb < yc, `layers stack downwards: ${ya} < ${yb} < ${yc}`)
  assert.equal(laid.horizontal, false)

  const cyclic = parseMermaidFlowchart('flowchart LR\n A --> B\n B --> A')
  const cycleLayout = layoutFlowchart(cyclic)
  assert.equal(cycleLayout.layers.flat().sort().join(','), 'A,B', 'a cycle lays out without recursing forever')
  assert.equal(cycleLayout.horizontal, true)
})

test('no routed connector cuts through a box it does not belong to', () => {
  const { exported } = loadClient()
  const { layoutFlowchart, parseMermaidFlowchart } = exported.__internals

  /**
   * Walk a route the way the renderer draws it and report the boxes it enters.
   * @param {object} laid - the layout.
   * @param {string[]} ids - the node ids.
   * @param {object} edge - one routed edge.
   * @returns {string[]} ids of boxes strictly entered.
   */
  const boxesHit = (laid, ids, edge) => {
    const hits = []
    for (const id of ids) {
      const box = laid.boxOf(id)
      const left = box.x - box.width / 2 + 1.5
      const right = box.x + box.width / 2 - 1.5
      const top = box.y - box.height / 2 + 1.5
      const bottom = box.y + box.height / 2 - 1.5
      for (let index = 1; index < edge.curve.length; index += 1) {
        const from = edge.curve[index - 1]
        const to = edge.curve[index]
        for (let step = 0; step <= 240; step += 1) {
          const t = step / 240
          const x = from.x + (to.x - from.x) * t
          const y = from.y + (to.y - from.y) * t
          if (x > left && x < right && y > top && y < bottom) {
            hits.push(id)
            break
          }
        }
        if (hits.includes(id)) break
      }
    }
    return hits
  }

  // A hop from the first layer to the last in a horizontal picture: the row is
  // full of boxes, so the connector must leave the band rather than thread it.
  const long = parseMermaidFlowchart([
    'flowchart LR',
    '  A[start] --> B[step b]',
    '  B --> C[step c]',
    '  C --> D[step d]',
    '  D --> E[finish]',
    '  A --> E',
  ].join('\n'))
  const longLayout = layoutFlowchart(long)
  const ids = long.nodes.map((node) => node.id)
  for (const edge of longLayout.edges) {
    const ends = [edge.from, edge.to]
    const hit = boxesHit(longLayout, ids, edge).filter((id) => !ends.includes(id))
    assert.deepStrictEqual(hit, [], `edge ${edge.index} (${edge.from}→${edge.to}) enters ${hit.join(',') || 'nothing'}`)
  }

  // The same for a vertical diamond with a long shortcut.
  const skip = parseMermaidFlowchart('flowchart TD\n A --> B\n B --> C\n C --> D\n A --> D')
  const skipLayout = layoutFlowchart(skip)
  const skipIds = skip.nodes.map((node) => node.id)
  for (const edge of skipLayout.edges) {
    const ends = [edge.from, edge.to]
    const hit = boxesHit(skipLayout, skipIds, edge).filter((id) => !ends.includes(id))
    assert.deepStrictEqual(hit, [], `edge ${edge.index} (${edge.from}→${edge.to}) enters ${hit.join(',') || 'nothing'}`)
  }
})

test('a self-loop leaves its box and comes back to it', () => {
  const { exported } = loadClient()
  const { layoutFlowchart, parseMermaidFlowchart } = exported.__internals

  for (const direction of ['TD', 'LR']) {
    const graph = parseMermaidFlowchart(`flowchart ${direction}\n A[One] -- retry --> A`)
    const laid = layoutFlowchart(graph)
    const box = laid.boxOf('A')
    const route = laid.edges[0]
    assert.equal(route.kind, 'same', `${direction}: a self-edge is not a forward edge`)
    // The head has to arrive on the border, not somewhere inside the box.
    const halfWidth = box.width / 2
    const halfHeight = box.height / 2
    const dx = Math.abs(route.end.x - box.x)
    const dy = Math.abs(route.end.y - box.y)
    assert.ok(
      Math.abs(dx - halfWidth) < 1 || Math.abs(dy - halfHeight) < 1,
      `${direction}: the arrowhead at (${route.end.x}, ${route.end.y}) is not on the border of ${box.width}×${box.height} at (${box.x}, ${box.y})`,
    )
    // And the route must leave the box before coming back, or the head points
    // back into the box it started from.
    const leaves = route.curve.some((point) => Math.abs(point.x - box.x) > halfWidth + 2 || Math.abs(point.y - box.y) > halfHeight + 2)
    assert.ok(leaves, `${direction}: the loop never leaves the box`)
  }
})

test('a page view turns verified locations into controls and marks the rejected ones', () => {
  const { exported, render } = loadClient()
  const { PageView } = exported.__internals
  /** @type {object[]} */
  const citations = []
  const page = {
    id: 'p1',
    title: 'Main flow',
    brief: 'what runs in order',
    status: 'done',
    markdown: [
      'Orientation. `src/main.js:1-3`',
      '',
      '## Mechanism',
      '',
      'Also `src/invented.ts:9-12`.',
    ].join('\n'),
    sources: [{ path: 'src/main.js', start: 1, end: 3 }],
    unverifiedSources: [{ path: 'src/invented.ts', start: 9, end: 12, reason: 'no such file' }],
  }
  const tree = render(PageView, { page, t, onCite: (citation) => citations.push(citation) })

  const buttons = findAll(tree, (node) => node.type === 'button')
  const verified = buttons.find((node) => node.props.className === 'rw-cite')
  const rejected = buttons.find((node) => String(node.props.className).includes('rw-cite-unverified'))
  assert.notEqual(verified, undefined)
  assert.notEqual(rejected, undefined)
  assert.equal(verified.props.disabled, false)
  assert.equal(rejected.props.disabled, true, 'a rejected location is not clickable')

  verified.props.onClick()
  assert.deepStrictEqual(plain(citations), [{ path: 'src/main.js', start: 1, end: 3 }])
  assert.equal(rejected.props.onClick, undefined)

  // The rejected citation is also summarized, so it cannot be missed in a long page.
  const notice = findAll(tree, (node) => String(node.props.className).includes('rw-notice-warn'))
  assert.equal(notice.length, 1)
  assert.match(textOf(notice[0]), /src\/invented\.ts:9-12/)
  assert.match(textOf(tree), /Main flow/)
  assert.match(textOf(tree), /what runs in order/)
})

test('a page with no content says so rather than rendering an empty column', () => {
  const { exported, render } = loadClient()
  const { PageView } = exported.__internals
  const tree = render(PageView, {
    page: { id: 'x', title: 'Empty', status: 'done', markdown: '' },
    t,
    onCite: () => {},
  })
  assert.match(textOf(tree), /emptyPage/)
})

test('a queued or generating page shows its brief and live status instead of blanking', () => {
  const { exported, render } = loadClient()
  const { PageView } = exported.__internals
  const waiting = render(PageView, {
    page: { id: 'w', title: 'Queued page', brief: 'what this will say', status: 'waiting', markdown: '' },
    t,
    onCite: () => {},
  })
  const waitingText = textOf(waiting)
  assert.match(waitingText, /pageWaiting/)
  assert.match(waitingText, /what this will say/, 'the planned brief is shown')
  assert.match(waitingText, /pageWaitingHint/)

  const generating = render(PageView, {
    page: { id: 'g', title: 'Writing page', brief: 'in progress', status: 'generating', markdown: '' },
    t,
    onCite: () => {},
  })
  const generatingText = textOf(generating)
  assert.match(generatingText, /pageGenerating/)
  assert.match(generatingText, /in progress/)
  assert.equal(findAll(generating, (node) => String(node.props.className ?? '').includes('rw-spinner')).length, 1, 'a spinner marks the live page')
})

test('a failed or stopped page offers to regenerate just that page', () => {
  const { exported, render } = loadClient()
  const { PageView } = exported.__internals
  const retried = []
  const failed = render(PageView, {
    page: { id: 'f', title: 'Broken', status: 'failed', markdown: '', error: 'terminated' },
    t,
    onCite: () => {},
    onRetry: (pageId) => retried.push(pageId),
  })
  assert.match(textOf(failed), /terminated/)
  const buttons = findAll(failed, (node) => node.type === 'button')
  assert.equal(buttons.length, 1, 'exactly one action: retry this page')
  buttons[0].props.onClick()
  assert.deepStrictEqual(retried, ['f'])

  const stopped = render(PageView, {
    page: { id: 's', title: 'Cut off', status: 'stopped', markdown: 'partial body' },
    t,
    onCite: () => {},
    onRetry: (pageId) => retried.push(pageId),
  })
  assert.equal(findAll(stopped, (node) => node.type === 'button').length, 1, 'a stopped page can be retried too')
})

test('the reader phase stays out of the page status, so a finished page opens its body', () => {
  const { exported, render } = loadClient()
  const { PagePane, PageView, pageViewState } = exported.__internals

  // The host's read response carries the stored page record, whose `status` is
  // its generation state. That field must not shadow the pane's own phase.
  const ready = pageViewState('p1', {
    page: { id: 'p1', title: 'Main flow', status: 'done', markdown: 'The body text.', sources: [], unverifiedSources: [] },
  })
  assert.equal(ready.readState, 'ready')
  assert.equal(ready.status, 'done', 'the generation status survives the reader phase')
  assert.equal(pageViewState('gone', { status: 'not-found' }).readState, 'missing')

  const pane = render(PagePane, { page: ready, t, onCite: () => {} })
  assert.equal(textOf(pane).includes('loading'), false, 'a ready page is never the loading placeholder')
  const views = findAll(pane, (node) => node.type === PageView)
  assert.equal(views.length, 1, 'the article component is what a ready page renders')
  const article = render(PageView, views[0].props)
  assert.match(textOf(article), /The body text\./)

  // Every other pane phase says exactly what it is.
  assert.match(textOf(render(PagePane, { page: null, t, onCite: () => {} })), /pickPage/)
  assert.match(textOf(render(PagePane, { page: { readState: 'missing' }, t, onCite: () => {} })), /notFound/)
  assert.match(textOf(render(PagePane, { page: { readState: 'error', error: 'boom' }, t, onCite: () => {} })), /boom/)
  assert.match(textOf(render(PagePane, { page: { readState: 'loading' }, t, onCite: () => {} })), /loading/)
})

test('inline rendering splits around tokens without duplicating the prose', () => {
  const { exported } = loadClient()
  const { renderInline } = exported.__internals
  const context = { t, onCite: () => {}, verified: new Set(['src/a.ts:1-2']), unverified: new Set() }
  const nodes = renderInline('before `src/a.ts:1-2` middle `src/b.ts:3-4` after', context)
  // Exactly: text, citation button, text, unverified citation, text — nothing repeats.
  assert.equal(nodes.length, 5)
  assert.equal(nodes[0], 'before ')
  assert.equal(nodes[2], ' middle ')
  assert.equal(nodes[4], ' after')
  assert.equal(textOf(nodes).match(/before/g)?.length, 1, 'no duplicated prose')
  assert.equal(textOf(nodes).match(/after/g)?.length, 1, 'no duplicated tail')
})

test('every catalog row is clickable and unverified pages are flagged', () => {
  const { exported, render } = loadClient()
  const { CatalogTree } = exported.__internals
  const selected = []
  const pages = [
    { id: 'a', title: 'Alpha', depth: 0, status: 'done', sources: 2, unverified: 0, brief: 'first' },
    { id: 'b', title: 'Beta', depth: 1, status: 'waiting', sources: 0, unverified: 0, brief: 'second' },
    { id: 'c', title: 'Gamma', depth: 0, status: 'failed', sources: 0, unverified: 1, brief: 'third', error: 'boom' },
  ]
  const tree = render(CatalogTree, { pages, activeId: 'a', onSelect: (id) => selected.push(id), t })

  const rows = findAll(tree, (node) => node.props?.role === 'treeitem')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].props['aria-selected'], true)
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons[0].props.disabled, undefined, 'every row is clickable')
  assert.equal(buttons[1].props.disabled, undefined, 'a queued page opens too: it shows a placeholder, not a blank')
  assert.equal(buttons[2].props.disabled, undefined, 'a failed page can be opened: its body says why it failed')
  buttons[0].props.onClick()
  assert.deepStrictEqual(plain(selected), ['a'])
  buttons[1].props.onClick()
  assert.deepStrictEqual(plain(selected), ['a', 'b'], 'every row is selectable')

  assert.match(textOf(tree), /Alpha/)
  assert.equal(findAll(tree, (node) => node.props.className === 'rw-tree-warn').length, 1)
})

test('an empty catalog shows the shape of what is coming while a run is in flight', () => {
  const { exported, render } = loadClient()
  const { CatalogTree } = exported.__internals
  const generating = render(CatalogTree, { pages: [], pending: true, activeId: null, onSelect: () => {}, t })
  assert.equal(findAll(generating, (node) => node.props.className === 'rw-skeleton').length > 0, true)
  assert.equal(generating.props['aria-busy'], 'true')

  const idle = render(CatalogTree, { pages: [], pending: false, activeId: null, onSelect: () => {}, t })
  assert.match(textOf(idle), /noPagesYet/)
})

test('a failed or stopped catalog row carries its own regenerate control', () => {
  const { exported, render } = loadClient()
  const { CatalogTree } = exported.__internals
  const retried = []
  const pages = [
    { id: 'a', title: 'Alpha', depth: 0, status: 'done', sources: 2, unverified: 0 },
    { id: 'b', title: 'Broken', depth: 0, status: 'failed', sources: 0, unverified: 0, error: 'boom' },
    { id: 'c', title: 'Cut off', depth: 0, status: 'stopped', sources: 0, unverified: 0 },
  ]
  const tree = render(CatalogTree, {
    pages,
    activeId: null,
    onSelect: () => {},
    onRetry: (pageId) => retried.push(pageId),
    t,
    busy: false,
  })
  const retryButtons = findAll(tree, (node) => node.type === 'button' && String(node.props.className).includes('rw-tree-retry'))
  assert.equal(retryButtons.length, 2, 'only the failed and stopped rows offer a rewrite')
  assert.match(retryButtons[0].props['aria-label'], /retryPage: Broken/)
  retryButtons[0].props.onClick()
  assert.deepStrictEqual(plain(retried), ['b'])

  const busyTree = render(CatalogTree, {
    pages,
    activeId: null,
    onSelect: () => {},
    onRetry: () => {},
    t,
    busy: true,
  })
  for (const button of findAll(busyTree, (node) => String(node.props.className ?? '').includes('rw-tree-retry'))) {
    assert.equal(button.props.disabled, true, 'a retry is not offered while a run is in flight')
  }
  assert.equal(findAll(tree, (node) => String(node.props.className ?? '').includes('rw-tree-retry')).length, 2, 'the idle tree keeps them enabled')
})

test('the progress bar reports the stage, the counter and the stop control', () => {
  const { exported, render } = loadClient()
  const { ProgressBar } = exported.__internals
  for (const phase of ['analyzing', 'catalog', 'pages', 'saving']) {
    const tree = render(ProgressBar, {
      task: { phase, progress: { index: 3, total: 12, done: 3, failed: 1 }, events: [] },
      t,
      onStop: () => {},
    })
    assert.match(textOf(tree), new RegExp(phase), `${phase} has its own caption text`)
    assert.match(textOf(tree), /3\/12/)
  }
  const tree = render(ProgressBar, {
    task: { phase: 'pages', progress: { index: 1, total: 4, done: 1, failed: 0 }, events: [] },
    t,
    onStop: () => {},
  })
  assert.equal(findAll(tree, (node) => node.type === 'button').length, 1, 'exactly one control: stop')
})

test('the progress bar shows a degradation warning rather than failing silently', () => {
  const { exported, render } = loadClient()
  const { ProgressBar } = exported.__internals
  const tree = render(ProgressBar, {
    task: {
      phase: 'pages',
      progress: { index: 1, total: 8, done: 1, failed: 0, title: 'Project identity' },
      events: [{ type: 'warning', message: 'catalog fell back to the template' }],
    },
    t,
    onStop: () => {},
  })
  assert.match(textOf(tree), /catalog fell back to the template/)
  assert.match(textOf(tree), /Project identity/, 'the page being written is named')
})

test('the progress panel names the model, the token cost and narrates the log', () => {
  const { exported, render } = loadClient()
  const { ProgressBar } = exported.__internals
  const tree = render(ProgressBar, {
    task: {
      phase: 'pages',
      state: 'running',
      startedAt: new Date().toISOString(),
      progress: { index: 2, total: 8, done: 2, failed: 0, title: 'Main flow' },
      model: { provider: 'p1', model: 'm1', source: 'session' },
      usage: { requests: 5, inputTokens: 1200, outputTokens: 300 },
      events: [
        { at: '2026-01-02T03:04:05.000Z', type: 'phase', phase: 'analyzing' },
        { at: '2026-01-02T03:05:00.000Z', type: 'page', pageId: 'a', title: 'Alpha', index: 0, total: 8, status: 'done', sources: 4 },
      ],
    },
    t,
    onStop: () => {},
  })
  const text = textOf(tree)
  assert.match(text, /p1\/m1/, 'the model route is named')
  assert.match(text, /1500/, 'input and output tokens are summed')
  assert.match(text, /Alpha/, 'the log narrates the finished page')
  // The four stages of the stepper are all labelled.
  for (const phase of ['analyzing', 'catalog', 'pages', 'saving']) assert.match(text, new RegExp(phase))
})

test('the outcome card reports a failed run with its error and a regenerate action', () => {
  const { exported, render } = loadClient()
  const { OutcomeCard } = exported.__internals
  const regenerated = []
  const tree = render(OutcomeCard, {
    kind: 'failed',
    task: {
      state: 'failed',
      error: 'model request failed (error): terminated',
      finishedAt: '2026-01-02T03:04:05.000Z',
      progress: { done: 3, failed: 2, total: 12 },
    },
    t,
    onRegenerate: () => regenerated.push(true),
    busy: false,
  })
  const text = textOf(tree)
  assert.match(text, /runFailed/)
  assert.match(text, /terminated/, 'the actual error is shown, not swallowed')
  assert.match(text, /3\/12/)
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 1)
  buttons[0].props.onClick()
  assert.equal(regenerated.length, 1, 'the card offers to regenerate')
})

test('the interrupted card reads the persisted document, not the live task', () => {
  const { exported, render } = loadClient()
  const { OutcomeCard } = exported.__internals
  const tree = render(OutcomeCard, {
    kind: 'interrupted',
    wiki: {
      meta: { lastTask: { state: 'stopped', finishedAt: '2026-01-02T03:04:05.000Z' } },
      counts: { done: 5, failed: 0, waiting: 7, generating: 0, total: 12 },
    },
    t,
    onRegenerate: () => {},
    busy: false,
  })
  const text = textOf(tree)
  assert.match(text, /interruptedRun/)
  assert.match(text, /5\/12/, 'the persisted page counts are the story')
})

test('a partial outcome retries the failed pages first and the whole Wiki second', () => {
  const { exported, render } = loadClient()
  const { OutcomeCard } = exported.__internals
  /** @type {string[]} */
  const actions = []
  const tree = render(OutcomeCard, {
    kind: 'partial',
    wiki: {
      meta: { lastTask: { state: 'done', finishedAt: '2026-01-02T03:04:05.000Z', done: 5, failed: 2 } },
      counts: { done: 5, failed: 2, waiting: 0, generating: 0, total: 7 },
    },
    t,
    onRegenerate: () => actions.push('all'),
    onRetryFailed: () => actions.push('failed'),
    busy: false,
  })
  assert.match(textOf(tree), /partialFailure/)
  assert.match(textOf(tree), /retryFailed/, 'the card names the failed-page action')
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 2, 'one action for the gaps, one for the whole Wiki')
  const primary = buttons.find((node) => String(node.props.className).includes('rw-button-primary'))
  const quiet = buttons.find((node) => String(node.props.className).includes('rw-button-quiet'))
  assert.notEqual(primary, undefined)
  assert.notEqual(quiet, undefined)
  primary.props.onClick()
  quiet.props.onClick()
  assert.deepStrictEqual(plain(actions), ['failed', 'all'], 'the gaps are the primary action')
})

test('the event log lines cover the shapes a task emits', () => {
  const { exported } = loadClient()
  const { describeEvent } = exported.__internals
  assert.match(describeEvent({ type: 'phase', phase: 'pages' }, t), /pages/)
  assert.match(describeEvent({ type: 'catalog', total: 12 }, t), /12/)
  assert.match(describeEvent({ type: 'page', status: 'done', title: 'Alpha', sources: 3 }, t), /Alpha/)
  assert.match(describeEvent({ type: 'page', status: 'failed', title: 'Beta', error: 'boom' }, t), /boom/)
  assert.match(describeEvent({ type: 'model', provider: 'p', model: 'm' }, t), /p\/m/)
  assert.match(describeEvent({ type: 'warning', message: 'careful' }, t), /careful/)
  assert.equal(describeEvent({ type: 'usage', requests: 1 }, t), null, 'usage is a chip, not a log line')
})

test('the pre-generation card offers the four options and a generate control', () => {
  const { exported, render } = loadClient()
  const { StatusCard } = exported.__internals
  const tree = render(StatusCard, {
    options: { language: 'zh-CN', model: '', diagrams: true, retries: 0 },
    providers: [{ provider: 'p1', providerName: 'Provider One', models: [{ id: 'm1', name: 'Model One' }] }],
    t,
    onChange: () => {},
    onGenerate: () => {},
    busy: false,
  })
  const text = textOf(tree)
  assert.match(text, /language/)
  assert.match(text, /model/)
  assert.match(text, /diagrams/)
  assert.match(text, /retries/)
  assert.match(text, /Provider One · Model One/, 'the model picker lists the available routes')
  assert.equal(findAll(tree, (node) => node.type === 'select').length, 2)
  assert.equal(findAll(tree, (node) => node.type === 'input').length, 2)
  const primary = findAll(tree, (node) => String(node.props.className ?? '').includes('rw-button-primary'))
  assert.equal(primary.length, 1, 'exactly one primary action')
  assert.match(textOf(primary[0]), /generate/)
})

test('the metadata panel reports the code state the pages describe', () => {
  const { exported, render } = loadClient()
  const { MetadataPanel } = exported.__internals
  const tree = render(MetadataPanel, {
    t,
    wiki: {
      meta: {
        branch: 'main',
        commit: 'abcdef1234567890',
        language: 'zh-CN',
        updatedAt: '2026-01-02T03:04:05.000Z',
        fileCount: 128,
        project: { summary: 'A sample project.' },
      },
      counts: { done: 9, total: 12 },
      citations: { verified: 41, unverified: 2 },
    },
  })
  const text = textOf(tree)
  assert.match(text, /main/)
  assert.match(text, /abcdef1/, 'the commit is abbreviated the way git prints it')
  assert.equal(text.includes('abcdef1234567890'), false, 'the full hash is not shown')
  assert.match(text, /zh-CN/)
  assert.match(text, /128/)
  assert.match(text, /9\/12/)
  assert.match(text, /41/)
  assert.match(text, /A sample project\./)
})

test('a supported diagram renders as SVG; an unsupported one falls back to its source', () => {
  const { exported, render } = loadClient()
  const { DiagramBlock } = exported.__internals

  const flow = render(DiagramBlock, { source: 'flowchart TD\n A[One] --> B[Two]\n B --> C[Three]', t })
  const boxes = findAll(flow, (node) => node.type === 'rect' && /rw-diagram-node/.test(String(node.props.className)))
  assert.equal(boxes.length, 3, 'one box per node')
  const edges = findAll(flow, (node) => node.type === 'path' && /rw-diagram-edge/.test(String(node.props.className)))
  assert.equal(edges.length, 2, 'one routed path per edge')
  assert.match(textOf(flow), /One/)
  assert.match(textOf(flow), /Three/)
  assert.equal(findAll(flow, (node) => node.type === 'svg').length, 1)

  // The assertion that was missing while the drawing code and the layout drifted
  // apart: every box must land inside the viewBox the figure declares, or the
  // diagram is clipped no matter how correct the layout maths is.
  const svg = findAll(flow, (node) => node.type === 'svg')[0]
  const [, , viewWidth, viewHeight] = String(svg.props.viewBox).split(/\s+/).map(Number)
  assert.ok(viewWidth > 0 && viewHeight > 0, `the viewBox has a size: ${svg.props.viewBox}`)
  for (const box of boxes) {
    const { x, y, width, height } = box.props
    for (const value of [x, y, width, height]) assert.ok(Number.isFinite(value), 'box geometry is numeric')
    assert.ok(x >= 0 && y >= 0, `box starts inside the viewBox: ${x},${y}`)
    assert.ok(x + width <= viewWidth, `box fits horizontally: ${x + width} <= ${viewWidth}`)
    assert.ok(y + height <= viewHeight, `box fits vertically: ${y + height} <= ${viewHeight}`)
  }

  const sequence = render(DiagramBlock, { source: 'sequenceDiagram\n  A->>B: hi', t })
  assert.equal(findAll(sequence, (node) => node.type === 'svg').length, 0)
  assert.match(textOf(sequence), /diagramUnsupported/)
  assert.match(textOf(sequence), /sequenceDiagram/, 'the source is shown so the diagram is not lost')
})

test('the tab body and chip mount from slot props without throwing', () => {
  const { exported, render } = loadClient()
  const { WikiBody, WikiTitle } = exported.__internals
  const tree = render(WikiBody, {
    sessionId: 'session-1',
    t,
    useTabInfo: () => ({ sidebar: { expanded: true, fullscreen: false }, panel: { id: 'pane' }, tab: { actions: {} } }),
  })
  assert.match(textOf(tree), /loading/, 'the first paint is the loading state, before any fetch resolves')
  assert.equal(findAll(tree, (node) => node.props.className === 'rw-root').length, 1)

  const title = render(WikiTitle, {
    t,
    useTabInfo: () => ({ tab: { navigation: { params: {} } } }),
  })
  assert.match(textOf(title), /title/)
})

test('the host routes the client calls are the ones the host registers', () => {
  const { exported } = loadClient()
  const { API } = exported.__internals
  assert.deepStrictEqual(plain(API), {
    state: '/api/repoWiki.state',
    generate: '/api/repoWiki.generate',
    stop: '/api/repoWiki.stop',
    read: '/api/repoWiki.read',
    remove: '/api/repoWiki.remove',
    refresh: '/api/repoWiki.refresh',
    models: '/api/repoWiki.models',
    regeneratePage: '/api/repoWiki.regeneratePage',
    restore: '/api/repoWiki.restore',
  })
})

test('the previous version is offered only when it recovers something the live Wiki lost', () => {
  const { exported } = loadClient()
  const { restorableBackup, fillTemplate, DICTIONARIES, confirmOverwrite } = exported.__internals

  // A stopped or failed regeneration leaves fewer completed pages than the copy.
  assert.equal(restorableBackup({ counts: { done: 0, total: 8 } }, { done: 8, total: 8 }), true)
  assert.equal(restorableBackup({ counts: { done: 3, total: 8 } }, { done: 8, total: 8 }), true)
  // A complete regeneration lost nothing, so no recovery banner is shown.
  assert.equal(restorableBackup({ counts: { done: 8, total: 8 } }, { done: 8, total: 8 }), false)
  assert.equal(restorableBackup({ counts: { done: 9, total: 9 } }, { done: 8, total: 8 }), false)
  // A delete leaves only the copy, and the copy is still offered.
  assert.equal(restorableBackup(null, { done: 8, total: 8 }), true)
  // Nothing to offer: no copy, or a copy with no usable page.
  assert.equal(restorableBackup({ counts: { done: 0, total: 8 } }, null), false)
  assert.equal(restorableBackup(null, null), false)
  assert.equal(restorableBackup({ counts: { done: 0, total: 2 } }, { done: 0, total: 2 }), false, 'an empty copy is not a recovery')

  // The page count travels into the sentence rather than being hard-coded.
  assert.equal(fillTemplate('keep {done}/{total}', { done: 3, total: 8 }), 'keep 3/8')
  assert.equal(fillTemplate('no placeholders', { done: 3 }), 'no placeholders')
  assert.equal(fillTemplate('missing {other}', { done: 3 }), 'missing {other}', 'an unknown placeholder is left visible')

  // Every destructive action says recovery is available, in both languages.
  for (const language of ['zh-CN', 'en']) {
    const dictionary = DICTIONARIES[language]
    assert.equal(typeof dictionary.restore, 'string', `${language} names the undo`)
    assert.equal(typeof dictionary.restored, 'string')
    assert.equal(typeof dictionary.purge, 'string', `${language} names the permanent delete`)
    assert.match(dictionary.purgeConfirm, /无法恢复|cannot be undone/i)
    assert.equal(typeof dictionary.backupAvailable, 'string')
    assert.equal(typeof dictionary.history, 'string', `${language} names the version history`)
    assert.equal(typeof dictionary.restoreVersion, 'string')
    assert.match(dictionary.historyHint, /\{days\}/)
    assert.match(dictionary.backupSummary, /\{done\}.*\{total\}/)
    assert.match(dictionary.regenerateConfirm, /\{done\}/)
    assert.match(dictionary.refreshConfirm, /\{done\}/)
    assert.match(dictionary.removeConfirm, /恢复|restore/i)
    assert.match(dictionary.backupHint, /恢复|找回|recover/i)
  }

  // The confirmation is skipped only when there is nothing to lose, fills in
  // the page count when there is, and a dismissed dialog cancels the action.
  const translate = (key) => (key === 'regenerateConfirm' ? 'replace {done} pages?' : key === 'refreshConfirm' ? 'refresh {done}?' : key)
  /** @type {string[]} */
  const asked = []
  assert.equal(confirmOverwrite(0, translate, (text) => { asked.push(text); return true }), true, 'an empty Wiki needs no dialog')
  assert.deepEqual(asked, [])
  assert.equal(confirmOverwrite(3, translate, (text) => { asked.push(text); return false }), false, 'a dismissed dialog cancels the run')
  assert.deepEqual(asked, ['replace 3 pages?'])
  assert.equal(confirmOverwrite(3, translate, () => true), true)
  assert.equal(confirmOverwrite(3, translate, undefined), true, 'a host without confirm cannot be blocked')
  assert.equal(confirmOverwrite(2, translate, (text) => { asked.push(text); return true }, 'refreshConfirm'), true)
  assert.equal(asked.at(-1), 'refresh 2?', 'a refresh asks with its own sentence')
})

test('the version history lists every archived version with its own restore control', () => {
  const { exported, render } = loadClient()
  const { HistoryPanel } = exported.__internals
  const translate = (key) => (key === 'historyHint' ? 'last {days} days' : key)
  /** @type {string[]} */
  const restored = []
  const history = [
    { id: '1700000002000-8of8-aaaaaaaaaaaa', archivedAt: '2026-10-17T10:00:00.000Z', done: 8, total: 8 },
    { id: '1700000001000-3of8-bbbbbbbbbbbb', archivedAt: '2026-10-16T09:00:00.000Z', done: 3, total: 8 },
  ]
  const tree = render(HistoryPanel, {
    history,
    retentionDays: 3,
    t: translate,
    onRestore: (id) => restored.push(id),
    busy: false,
  })
  const text = textOf(tree)
  assert.match(text, /history \(2\)/)
  assert.match(text, /8\/8/)
  assert.match(text, /3\/8/)
  assert.match(text, /last 3 days/)
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 2, 'one restore control per archived version')
  for (const button of buttons) button.props.onClick()
  assert.deepEqual(restored, history.map((entry) => entry.id), 'each control restores its own version')

  assert.equal(render(HistoryPanel, { history: [], t: translate, onRestore: () => {}, busy: false }), null)
})
