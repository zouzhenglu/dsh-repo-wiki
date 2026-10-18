/**
 * Load `lib/client.js` outside a browser, and serialise what it renders.
 *
 * The client bundle is a browser artifact: it registers itself on
 * `window.__ModuleLoader__`, imports React and appends a stylesheet to
 * `document.head`. The test suite loads it with a `vm` sandbox plus a tiny React
 * stand-in, and this module does the same thing — deliberately mirroring
 * `test/client-bundle.test.mjs` so the preview renders through exactly the path
 * the tests (and the app) use.
 *
 * The difference is what happens afterwards. The tests assert on element trees;
 * the preview needs *markup*, so {@link serializeTree} turns the tree into real
 * SVG/HTML. That is not a formality: React props are camelCase
 * (`className`, `markerEnd`, `textAnchor`, `strokeWidth`) and SVG attributes are
 * not, `style` is an object rather than a string, and `x1={12}` must serialise as
 * `x1="12"`. A generic JSON dump would look plausible and be wrong in every
 * arrow.
 *
 * @module dsh-repo-wiki/tools/preview/load
 */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * React prop name → SVG/HTML attribute name.
 *
 * Three kinds of entry live here, and getting any of them wrong is invisible
 * until the picture is wrong:
 *
 * - camelCase SVG attributes that keep their case in markup (`refX`, `viewBox`);
 * - camelCase React props that hyphenate (`markerEnd` → `marker-end`);
 * - camelCase DOM props that rename (`className` → `class`).
 *
 * Anything not listed falls back to the hyphenating rule, which is what React
 * itself does for unknown props.
 */
const CAMEL_ATTRIBUTES = new Map([
  // Case-preserved SVG attributes.
  ['refX', 'refX'],
  ['refY', 'refY'],
  ['markerWidth', 'markerWidth'],
  ['markerHeight', 'markerHeight'],
  ['markerUnits', 'markerUnits'],
  ['gradientUnits', 'gradientUnits'],
  ['gradientTransform', 'gradientTransform'],
  ['preserveAspectRatio', 'preserveAspectRatio'],
  ['patternUnits', 'patternUnits'],
  ['patternContentUnits', 'patternContentUnits'],
  ['clipPathUnits', 'clipPathUnits'],
  ['patternTransform', 'patternTransform'],
  ['primitiveUnits', 'primitiveUnits'],
  ['spreadMethod', 'spreadMethod'],
  ['stdDeviation', 'stdDeviation'],
  ['baseFrequency', 'baseFrequency'],
  ['numOctaves', 'numOctaves'],
  ['filterUnits', 'filterUnits'],
  ['textLength', 'textLength'],
  ['lengthAdjust', 'lengthAdjust'],
  ['startOffset', 'startOffset'],
  ['pathLength', 'pathLength'],
  ['viewBox', 'viewBox'],
  // Hyphenated presentation attributes.
  ['fillRule', 'fill-rule'],
  ['clipRule', 'clip-rule'],
  ['clipPath', 'clip-path'],
  ['shapeRendering', 'shape-rendering'],
  ['textRendering', 'text-rendering'],
  ['vectorEffect', 'vector-effect'],
  ['pointerEvents', 'pointer-events'],
  ['paintOrder', 'paint-order'],
  ['stopColor', 'stop-color'],
  ['stopOpacity', 'stop-opacity'],
  ['markerEnd', 'marker-end'],
  ['markerStart', 'marker-start'],
  ['markerMid', 'marker-mid'],
  ['textAnchor', 'text-anchor'],
  ['dominantBaseline', 'dominant-baseline'],
  ['alignmentBaseline', 'alignment-baseline'],
  ['baselineShift', 'baseline-shift'],
  ['fontFamily', 'font-family'],
  ['fontSize', 'font-size'],
  ['fontWeight', 'font-weight'],
  ['fontStyle', 'font-style'],
  ['letterSpacing', 'letter-spacing'],
  ['strokeWidth', 'stroke-width'],
  ['strokeDasharray', 'stroke-dasharray'],
  ['strokeDashoffset', 'stroke-dashoffset'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['strokeOpacity', 'stroke-opacity'],
  ['fillOpacity', 'fill-opacity'],
  ['transformOrigin', 'transform-origin'],
  // DOM renames.
  ['className', 'class'],
  ['tabIndex', 'tabindex'],
  ['htmlFor', 'for'],
])

/** HTML attributes that take a plain string in markup. */
const BOOLEANISH = new Set(['hidden', 'checked', 'selected', 'disabled', 'open', 'readonly', 'required'])

/** Tags whose content is escaped as text and never descended into. */
const RAW_TEXT = false

/**
 * A minimal React Element implementation plus a single-pass hook runtime.
 *
 * Identical in behaviour to the one the tests use: hooks read from a cell array
 * that is reset on every `render` call, which is all a component that reads
 * state and memoises needs. Nothing here re-renders, so initial state is the
 * only state — which is exactly right for a static preview of the first paint.
 * @returns {object} the React stand-in plus a `render` helper.
 */
function createReactShim() {
  /** @type {any[]} */
  let cells = []
  let cursor = 0

  const react = {
    createElement(type, props, ...children) {
      const next = { ...(props ?? {}) }
      const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
      next.children = flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat
      return { type, props: next }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial
      return [cells[index], (value) => {
        cells[index] = typeof value === 'function' ? value(cells[index]) : value
      }]
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
    useLayoutEffect() {
      cursor += 1
    },
    useReducer(reducer, initial) {
      const index = cursor++
      if (!(index in cells)) cells[index] = initial
      return [cells[index], (action) => {
        cells[index] = reducer(cells[index], action)
      }]
    },
  }

  return {
    react,
    render(component, props) {
      cells = []
      cursor = 0
      return component(props)
    },
  }
}

/**
 * Load the client bundle the way the shell does.
 *
 * @param {string} path - `lib/client.js`.
 * @returns {{
 *   exported: any,
 *   internals: Record<string, any>,
 *   css: string,
 *   render: (component: Function, props: object) => any,
 *   react: object,
 * }}
 * @throws when the bundle never registers, or imports a module the shell would
 *   not have seeded. Both are hard failures: a bundle that does not load cannot
 *   be previewed and silently substituting something else would be a lie.
 */
export function loadClient(path) {
  const source = readFileSync(path, 'utf8')
  /** @type {object | null} */
  let definition = null
  const appended = []
  const documentStub = {
    createElement: () => ({ setAttribute: () => {}, remove: () => {}, textContent: '', dataset: {} }),
    head: { appendChild: (node) => appended.push(node) },
    querySelector: () => null,
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
  vm.runInNewContext(source, sandbox, { filename: path })

  if (definition === null) {
    throw new Error(`${path} never called window.__ModuleLoader__.load`)
  }
  const shim = createReactShim()
  /** @type {string[]} */
  const requested = []
  const exported = definition.factory((name) => {
    requested.push(name)
    if (name === 'react') return shim.react
    throw new Error(`the bundle required an undeclared module: ${name}`)
  })
  const internals = exported.__internals
  if (internals === undefined || internals === null) {
    throw new Error('the bundle must export __internals for the preview to reach its renderer')
  }
  return { exported, internals, css: typeof internals.CSS === 'string' ? internals.CSS : '', render: shim.render, react: shim.react, requested, appended }
}

/**
 * Turn a React `style` value into a CSS declaration string.
 * @param {object | string | undefined} style - the style prop.
 * @returns {string | null} the declaration string, or null when empty.
 */
function styleToCss(style) {
  if (style === undefined || style === null) return null
  if (typeof style === 'string') return style
  const parts = []
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null || value === '') continue
    // React allows `--custom-props` and falls back to hyphenating camelCase.
    const name = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    parts.push(`${name}:${String(value)}`)
  }
  return parts.length === 0 ? null : parts.join(';')
}

/**
 * Escape text for use as element content or an attribute value.
 * @param {string} text - the raw text.
 * @returns {string} the escaped text.
 */
export function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Serialise one element's props into markup attributes.
 * @param {Record<string, any>} props - the element props.
 * @returns {string} a leading-space attribute string (possibly empty).
 */
function serializeProps(props) {
  const out = []
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'key' || key === 'ref') continue
    if (value === undefined || value === null || value === false) continue
    if (typeof value === 'function' || typeof value === 'symbol') continue
    if (key === 'style') {
      const css = styleToCss(value)
      if (css !== null) out.push(` style="${escapeText(css)}"`)
      continue
    }
    const name = CAMEL_ATTRIBUTES.get(key) ?? (key.startsWith('data-') || key.startsWith('aria-') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))
    if (value === true) {
      out.push(BOOLEANISH.has(name) ? ` ${name}="${name}"` : ` ${name}="true"`)
      continue
    }
    // `viewBox` and friends keep their case; everything else is lower-kebab.
    const attribute = name === 'viewBox' ? name : name
    out.push(` ${attribute}="${escapeText(String(value))}"`)
  }
  return out.join('')
}

/**
 * Serialise a React element tree into markup.
 *
 * Supports function components (called with their props, exactly as React would
 * on a first pass), arrays, strings and numbers. `null`/`undefined`/`false`
 * children vanish, matching React.
 *
 * @param {any} node - the element, array, or text.
 * @returns {string} markup.
 */
export function serializeTree(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string') return escapeText(node)
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(serializeTree).join('')
  if (typeof node !== 'object') return ''
  if (typeof node.type === 'function') {
    const shim = createReactShim()
    return serializeTree(shim.render(node.type, node.props ?? {}))
  }
  const tag = String(node.type)
  const props = node.props ?? {}
  const inner = RAW_TEXT === false && (tag === 'style' || tag === 'script') ? String(props.children ?? '') : serializeTree(props.children)
  if (tag === 'svg' || tag === 'path' || tag === 'rect' || tag === 'circle' || tag === 'line' || tag === 'polyline' || tag === 'polygon' || tag === 'ellipse' || tag === 'marker' || tag === 'defs' || tag === 'g' || tag === 'text' || tag === 'tspan' || tag === 'use' || tag === 'pattern' || tag === 'linearGradient' || tag === 'stop' || tag === 'clipPath' || tag === 'foreignObject' || tag === 'image' || tag === 'title' || tag === 'desc') {
    return `<${tag}${serializeProps(props)}>${inner}</${tag}>`
  }
  return `<${tag}${serializeProps(props)}>${inner}</${tag}>`
}

/**
 * Walk an element tree, calling `visit` for every element.
 * @param {any} tree - the tree.
 * @param {(node: any, depth: number, parent: any) => void} visit - the callback.
 * @param {number} [depth] - the starting depth.
 * @returns {void}
 */
export function walk(tree, visit, depth = 0, parent = null) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return
  if (Array.isArray(tree)) {
    for (const child of tree) walk(child, visit, depth, parent)
    return
  }
  visit(tree, depth, parent)
  if (tree.props !== undefined) walk(tree.props.children, visit, depth + 1, tree)
}

/**
 * Collect every string in a tree, in document order.
 * @param {any} tree - the tree.
 * @returns {string} the text.
 */
export function textOf(tree) {
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
