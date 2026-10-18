/**
 * Canary for the preview harness: render and analyse a diagram WITHOUT the
 * project bundle, so the harness can be proven working while lib/client.js is
 * unparsable.
 *
 * Builds the smallest bundle that satisfies the loader's contract (exports
 * `__internals` with `CSS`, `DiagramBlock`, `parseMermaidFlowchart`,
 * `layoutFlowchart`) and pushes one deliberately defective diagram through the
 * full path: serializer -> SVG markup -> geometry analysis.
 *
 * Expected result: the analysis reports the planted defects, which proves both
 * the loader and the analyzer are live.
 */

import { analyzeSvg } from './analyze.mjs'
import { serializeTree } from './load.mjs'

// A tiny stand-in bundle: two boxes, one edge drawn centre-to-centre (the exact
// old-renderer bug), with the label of the first node under the line.
const bundleSource = `window.__ModuleLoader__.load({
  id: "canary",
  factory: function (require) {
    var message = "canary bundle loaded"
    var diagram = {
      css: ".rw-diagram-stage{overflow:auto}.rw-diagram-label{font-size:11.5px}"
    }
    var exports = {
      message: message,
      __internals: {
        CSS: diagram.css,
        parseMermaidFlowchart: function (source) {
          return { kind: "flowchart", direction: "TD", nodes: [{ id: "A", label: "Alpha" }, { id: "B", label: "Beta" }], edges: [{ from: "A", to: "B" }] }
        },
        layoutFlowchart: function () {
          return { horizontal: false, layers: [["A"], ["B"]], positions: new Map([["A", { x: 0, y: 0 }], ["B", { x: 0, y: 1 }]]) }
        },
        DiagramBlock: function (props) {
          return null
        }
      }
    }
    return exports
  }
})
`

/**
 * Render the planted defective diagram, using the same React shim the real
 * build uses. Returns both the element tree (which is what `analyzeSvg`
 * consumes) and its serialized markup (which is what lands in preview.html).
 * @param {any} react - the react shim handed to the bundle.
 * @returns {{tree: any, markup: string}} the tree and markup.
 */
function canaryDiagram(react) {
  const h = react.createElement
  const tree = h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 400 200',
      className: 'rw-diagram-svg',
      style: { maxWidth: '100%', height: 'auto' },
    },
    // The planted bug: an edge drawn centre-to-centre, straight through both labels.
    h('line', { x1: 100, y1: 60, x2: 100, y2: 140, className: 'rw-diagram-edge', markerEnd: 'url(#rw-arrow)' }),
    h('rect', { x: 16, y: 20, width: 168, height: 40, rx: 8, className: 'rw-diagram-node' }),
    h('text', { x: 100, y: 44, textAnchor: 'middle', className: 'rw-diagram-label' }, 'Alpha'),
    h('rect', { x: 16, y: 160, width: 168, height: 40, rx: 8, className: 'rw-diagram-node' }),
    h('text', { x: 100, y: 184, textAnchor: 'middle', className: 'rw-diagram-label' }, 'Beta'),
  )
  return { tree, markup: serializeTree(tree) }
}

/**
 * Also prove the loader parses a real module through the vm sandbox.
 * @returns {Promise<void>} resolves when done.
 */
async function main() {
  const { loadClient } = await import('./load.mjs')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  // Loader canary: write the bundle above and load it exactly like the real one.
  const directory = mkdtempSync(join(tmpdir(), 'canary-'))
  const bundlePath = join(directory, 'bundle.js')
  writeFileSync(bundlePath, bundleSource, 'utf8')
  const loaded = loadClient(bundlePath)
  console.log('loader  : loaded canary bundle; exports =', Object.keys(loaded.exported).join(', '))
  console.log('loader  : CSS from __internals =', JSON.stringify(loaded.css))
  console.log('loader  : layoutFlowchart return =', JSON.stringify(loaded.internals.layoutFlowchart()?.layers))

  // Serializer canary: use the react shim the loader handed the bundle, so the
  // element shape is exactly what a real DiagramBlock produces.
  const diagram = canaryDiagram(loaded.react)
  const svg = diagram.markup
  console.log('\nserializer output (first 300 chars):\n' + svg.slice(0, 300))
  const expectations = [
    ['marker-end attribute', /marker-end="url\(#rw-arrow\)"/.test(svg)],
    ['text-anchor attribute', /text-anchor="middle"/.test(svg)],
    ['viewBox case preserved', /viewBox="0 0 400 200"/.test(svg)],
    ['className -> class', /class="rw-diagram-svg"/.test(svg)],
    ['style object -> css string', /style="max-width:100%;height:auto"/.test(svg)],
    ['numeric x emitted bare', /x="16"/.test(svg)],
  ]
  console.log('')
  let failed = 0
  for (const [name, ok] of expectations) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`)
    if (!ok) failed += 1
  }

  // Analyzer canary: the planted defect is a line through both labels.
  // analyzeSvg takes the element tree, which is what build.mjs passes too.
  const report = analyzeSvg(diagram.tree, { width: 420, padding: 14, caseName: 'canary-planted-defect' })
  console.log('\nanalyzer: counts =', JSON.stringify(report.counts))
  console.log('analyzer: fit    =', JSON.stringify(report.fit))
  const rules = [...new Set(report.findings.map((finding) => finding.rule))]
  console.log('analyzer: rules fired =', rules.join(', ') || '(none)')
  const covers = report.findings.filter((finding) => finding.rule === 'edge-covers-text')
  console.log(`analyzer: edge-covers-text x${covers.length} (planted, expected > 0)`)
  for (const finding of covers.slice(0, 2)) console.log(`   ${finding.detail} ${finding.coordinates}`)

  console.log(`\ncanary ${failed === 0 && covers.length > 0 ? 'PASSED' : 'FAILED'}`)
  if (failed !== 0 || covers.length === 0) process.exitCode = 1
}

await main()
