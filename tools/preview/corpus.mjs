/**
 * The diagram corpus the preview renders.
 *
 * Two halves:
 *
 * - **Real sources.** Every `` ```mermaid `` block inside the Wiki the plugin
 *   actually produced on this machine. These are the diagrams a user looks at,
 *   so they are the ones a renderer has to survive.
 * - **Tricky sources.** Hand-written flowcharts that pin down the shapes the
 *   real corpus does not happen to contain: a label on every edge, Chinese and
 *   `<br/>` labels, a cycle, a single node, twenty-plus nodes, an edge that has
 *   to cross a box it does not touch, and arrow directions that are not left to
 *   right.
 *
 * Every case carries a short `id` (used in the report and as the HTML anchor)
 * and a one-line `note` saying what the case is probing.
 *
 * @module dsh-repo-wiki/tools/preview/corpus
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The DSH home the plugin resolves its caches under, honouring `DSH_HOME`. */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * Find the most recently written Wiki in the plugin's cache.
 *
 * The cache directory is named after a hash of the analysed workspace, so it
 * differs per machine and per project. Picking the newest entry keeps this a
 * zero-configuration default without baking any machine path into the
 * repository; pass `--wiki <path>` to select one explicitly.
 * @returns {string} a `wiki.json` path; a path that need not exist.
 */
function discoverWiki() {
  const root = join(dshHome(), 'repo-wiki')
  let newest
  try {
    for (const nest of readdirSync(root)) {
      const nested = join(root, nest)
      if (!statSync(nested).isDirectory()) continue
      for (const key of readdirSync(nested)) {
        const file = join(nested, key, 'wiki.json')
        if (!existsSync(file)) continue
        const written = statSync(file).mtimeMs
        if (newest === undefined || written > newest.written) newest = { file, written }
      }
    }
  } catch {
    /* an absent or unreadable cache is not an error: the build falls back to the synthetic cases */
  }
  return newest === undefined ? join(root, 'wiki.json') : newest.file
}

/** Where the plugin stores the Wiki it wrote for the analysed project. */
export const DEFAULT_WIKI = discoverWiki()

/** A tolerant fence matcher: ```` ```mermaid ````, any indentation, CRLF or LF. */
const FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/g

/**
 * Pull every Mermaid fence out of a Wiki document.
 *
 * A page whose body is not a string, or a Wiki whose `pages` is not an array,
 * yields nothing rather than throwing: the preview must build even against a
 * Wiki written by an older version of the plugin.
 * @param {string} path - the `wiki.json` path.
 * @returns {{id: string, note: string, source: string}[]} the real diagram cases.
 */
export function readWikiDiagrams(path) {
  if (!existsSync(path)) {
    return []
  }
  const document = JSON.parse(readFileSync(path, 'utf8'))
  const pages = Array.isArray(document.pages) ? document.pages : []
  const cases = []
  for (const page of pages) {
    const markdown = typeof page?.markdown === 'string' ? page.markdown : ''
    FENCE.lastIndex = 0
    let match
    while ((match = FENCE.exec(markdown)) !== null) {
      const body = match[1].trim()
      if (body === '') continue
      const pageId = typeof page.id === 'string' ? page.id : `page-${cases.length}`
      const title = typeof page.title === 'string' ? page.title : pageId
      cases.push({
        id: `real-${String(cases.length + 1).padStart(2, '0')}-${pageId}`,
        note: `${title} — real Wiki page`,
        source: body,
      })
    }
  }
  return cases
}

/**
 * A long left-to-right chain, which is the shape that has to be scaled down to
 * fit the ~420px sidebar rather than overflowing it.
 * @param {number} count - how many nodes.
 * @param {'LR'|'RL'|'TD'} direction - the declared direction.
 * @returns {string} the Mermaid source.
 */
function chain(count, direction) {
  const lines = [`flowchart ${direction}`]
  for (let index = 0; index < count; index += 1) {
    lines.push(`  N${index}["步骤 ${index + 1} / step ${index + 1}"]`)
  }
  for (let index = 0; index + 1 < count; index += 1) {
    lines.push(`  N${index} --> N${index + 1}`)
  }
  return lines.join('\n')
}

/** The hand-written tricky cases. */
const TRICKY = [
  {
    id: 'tricky-td-chain',
    note: 'vertical chain: node labels must never be crossed by the edges that leave them',
    source: ['flowchart TD', '  A[Request arrives] --> B[Parse the body]', '  B --> C[Validate]', '  C --> D[Persist]', '  D --> E[Reply]'].join('\n'),
  },
  {
    id: 'tricky-td-branch',
    note: 'vertical fan-out then fan-in: two boxes share one row',
    source: [
      'flowchart TD',
      '  ROOT[入口 entry] --> LEFT[左边分支]',
      '  ROOT --> RIGHT[右边分支 with a considerably longer label]',
      '  LEFT --> JOIN[汇合]',
      '  RIGHT --> JOIN',
      '  JOIN --> OUT[输出]',
    ].join('\n'),
  },
  {
    id: 'tricky-lr-chain-9',
    note: 'nine-node LR chain: at 420px this must scale down, never overflow',
    source: chain(9, 'LR'),
  },
  {
    id: 'tricky-lr-chain-12-plain-text',
    note: 'twelve-node LR chain with unbracketed ids (the parser falls back to the id as label)',
    source: ['flowchart LR', '  a --> b --> c', '  c --> d --> e', '  e --> f --> g', '  g --> h --> i', '  i --> j --> k', '  k --> l'].join('\n'),
  },
  {
    id: 'tricky-dense-edge-labels',
    note: 'a label on every edge: pills must not overlap boxes or each other',
    source: [
      'flowchart LR',
      '  S["Session start"] -->|load| L["loadWiki"]',
      '  L -->|read document| V["validate"]',
      '  V -->|downgrade| N["normalize"]',
      '  L -->|bump| M["tasks map"]',
      '  V -->|onPage| P["save"]',
      '  P -->|atomic| D["disk"]',
    ].join('\n'),
  },
  {
    id: 'tricky-arrow-syntax-labels',
    note: '`A -- onPage --> B` and `-- "quoted label" -->` forms from the real Wiki',
    source: [
      'flowchart LR',
      '  IDX["lib/index.js: apply"] --> SVC["WikiService"]',
      '  SVC -- onPage --> STORE["WikiStore.save"]',
      '  SVC -- "HTTP /api/repoWiki.*" --> API["route handlers"]',
      '  API -- "readGitState" --> GIT[".git files"]',
    ].join('\n'),
  },
  {
    id: 'tricky-br-multiline',
    note: '`<br/>` in a label: two visual lines inside a 40px box',
    source: [
      'flowchart TD',
      '  IDX["lib/index.js<br/>路由/工具/命令"] --> SVC["wiki/service.js<br/>任务与版本"]',
      '  SVC --> PIPE["wiki/pipeline.js<br/>四阶段<br/>且这一行相当长"]',
      '  PIPE --> MODEL["wiki/model.js<br/>schema+引用校验"]',
    ].join('\n'),
  },
  {
    id: 'tricky-chinese-wrap',
    note: 'unbroken Chinese labels, which have no spaces to wrap on',
    source: [
      'flowchart TD',
      '  A["开始：创建任务并读取工作区状态"] --> B["分析：目录结构与项目概要"]',
      '  B --> C["生成：逐页写入并校验引用来源"]',
      '  C --> D["保存：原子落盘并记录版本历史"]',
    ].join('\n'),
  },
  {
    id: 'tricky-cycle',
    note: 'a cycle: layering must terminate and the loop edge must stay visible',
    source: [
      'flowchart TD',
      '  Pages["#pages"] --> Ev["#evidence"]',
      '  Ev --> Reply["page request"]',
      '  Reply --> Verify["verifyCitations"]',
      '  Verify --> Save["store.save"]',
      '  Save --> Pages',
    ].join('\n'),
  },
  {
    id: 'tricky-single-node',
    note: 'one node and nothing else: viewBox must not be degenerate',
    source: ['flowchart TD', '  ONLY["the only node"]'].join('\n'),
  },
  {
    id: 'tricky-twenty-five-nodes',
    note: '25 nodes in a wide vertical fan: height and readability at 420px',
    source: (() => {
      const lines = ['flowchart TD', '  HUB["coordinator"]']
      for (let index = 0; index < 24; index += 1) {
        lines.push(`  HUB --> M${index}["module ${index}"]`)
      }
      return lines.join('\n')
    })(),
  },
  {
    id: 'tricky-edge-crosses-box',
    note: 'a long edge that has to pass a layer it does not touch (A-->E skips B,C,D)',
    source: [
      'flowchart TD',
      '  A["start"] --> B["step b"]',
      '  B --> C["step c"]',
      '  C --> D["step d"]',
      '  D --> E["finish"]',
      '  A --> E',
    ].join('\n'),
  },
  {
    id: 'tricky-self-loop',
    note: 'a self edge and a two-node cycle',
    source: ['flowchart TD', '  R["retry loop"] --> R', '  R --> Q["queue"]', '  Q --> R'].join('\n'),
  },
  {
    id: 'tricky-diamond-shapes',
    note: 'decision shapes `{...}` and round `(...)`, plus `A --- B` (no arrow)',
    source: [
      'flowchart TD',
      '  S([start]) --> D{ok?}',
      '  D -->|yes| Y["do it"]',
      '  D -->|no| N["skip"]',
      '  Y --- Z["log"]',
      '  N --- Z',
    ].join('\n'),
  },
  {
    id: 'tricky-rl-direction',
    note: 'RL: arrows run right to left, arrowheads must still sit on the target border',
    source: ['flowchart RL', '  A["alpha"] --> B["beta"]', '  B --> C["gamma"]', '  C --> D["delta"]'].join('\n'),
  },
  {
    id: 'tricky-very-long-label',
    note: 'a single label far longer than the box: must wrap or ellipsize without clipping',
    source: [
      'flowchart LR',
      '  LONG["this label is much longer than any box a 168px fixed width could ever hope to contain and it keeps going"] --> NEXT["next"]',
    ].join('\n'),
  },
  {
    id: 'tricky-comment-and-blank-lines',
    note: 'indented, commented and blank-line-separated source',
    source: ['flowchart TD', '', '  %% a comment the parser must ignore', '  A["alpha"]   -->   B["beta"]', '', '  B --> C["gamma"]', ''].join('\n'),
  },
]

/**
 * The whole corpus: the real Wiki diagrams first, then the tricky cases.
 * @param {string} [wikiPath] - the `wiki.json` to read.
 * @returns {{id: string, note: string, source: string, real: boolean}[]} the cases.
 */
export function buildCorpus(wikiPath = DEFAULT_WIKI) {
  const real = readWikiDiagrams(wikiPath).map((entry) => ({ ...entry, real: true }))
  const tricky = TRICKY.map((entry) => ({ ...entry, real: false }))
  return [...real, ...tricky]
}

export { TRICKY }
