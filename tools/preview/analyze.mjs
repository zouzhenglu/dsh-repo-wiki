/**
 * Measure a rendered SVG against the things that make a diagram look broken.
 *
 * Everything here works on the *emitted geometry* — the element tree the bundle
 * returns, plus the markup it serialises to — never on the diagram source, so a
 * defect found here is a defect a reader would actually see. Text is measured
 * with an estimated advance width (see {@link measureText}), which is stated as
 * an estimate everywhere it is used: no browser is available, so exact font
 * metrics are unknowable, and pretending otherwise would make the report
 * dishonest. The checks are ordered so that the coarse, high-confidence ones
 * (clipping, box escaping, arrow attachment) come first and the estimated ones
 * (overlap) are reported with the number that produced them.
 *
 * Coordinate space: everything is compared in viewBox units, before the outer
 * `<svg>` is scaled to its container, because a defect is a property of the
 * drawing, not of the window.
 *
 * @module dsh-repo-wiki/tools/preview/analyze
 */

/**
 * per-character advance estimates, as a fraction of the font size, for the
 * fonts the theme stacks specify. CJK is full-width, Latin is narrower; the
 * values are deliberately a little generous so that a "fits" verdict is
 * conservative and a "clipped" verdict is not a false alarm.
 * @param {string} text - the string.
 * @param {number} fontSize - font size in px.
 * @returns {number} estimated advance width in px.
 */
export function measureText(text, fontSize) {
  let units = 0
  for (const char of String(text)) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x2e80) units += 1
    else if (code >= 0x2000 && code <= 0x206f) units += 0.6
    else if (/[A-Z]/.test(char)) units += 0.66
    else if (/[a-z0-9]/.test(char)) units += 0.55
    else if (/[\s]/.test(char)) units += 0.28
    else units += 0.35
  }
  return units * fontSize
}

/**
 * An axis-aligned rectangle.
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 */

/**
 * Overlap area of two rectangles.
 * @param {Rect} a - one rectangle.
 * @param {Rect} b - the other.
 * @returns {number} the overlapping area, zero when disjoint.
 */
export function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * Whether two rectangles share any area at all.
 * @param {Rect} a - one rectangle.
 * @param {Rect} b - the other.
 * @returns {boolean} true when they overlap.
 */
function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Whether `inner` is fully inside `outer` (with a tolerance).
 * @param {Rect} inner - the candidate.
 * @param {Rect} outer - the container.
 * @param {number} [tolerance] - allowed slop in px.
 * @returns {boolean} true when contained.
 */
function contains(outer, inner, tolerance = 0.01) {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance
}

/**
 * Round a number for display without lying about it.
 * @param {number} value - the number.
 * @returns {number} the value to one decimal place.
 */
const round = (value) => Math.round(value * 10) / 10

/**
 * Read a numeric attribute from an element's props, tolerating strings with a
 * `px` suffix because the renderer may emit either.
 * @param {any} value - the prop.
 * @param {number} [fallback] - the value to use when absent.
 * @returns {number} the number.
 */
function num(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/px$/, ''))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

/**
 * The class list of an element as a set.
 * @param {any} props - the element props.
 * @returns {string[]} the class names.
 */
function classesOf(props) {
  const value = props?.className ?? props?.class
  if (typeof value === 'string') return value.split(/\s+/).filter((part) => part !== '')
  if (Array.isArray(value)) return value.flatMap(classesOf).filter((part) => part !== '')
  return []
}

/**
 * Extract every text run from a `<text>` subtree, honouring `<tspan>` children.
 *
 * A label rendered as one line is one run; a label rendered as several
 * `<tspan>` lines is several runs, each with its own baseline. The distinction
 * matters: a multi-line label is not "clipped" merely because one line is short.
 *
 * @param {any} node - a `<text>` element.
 * @param {Array<{x: number, y: number, dx: number, dy: number, weight: number}>} inherited - the enclosing position.
 * @returns {{lines: string[], x: number, y: number}[]} one entry per line, positioned absolutely.
 */
function readTextRuns(node, inherited = { x: 0, y: 0, dx: 0, dy: 0 }) {
  const props = node.props ?? {}
  const x = num(props.x, inherited.x)
  const y = num(props.y, inherited.y)
  const dx = inherited.dx + num(props.dx, 0)
  const dy = inherited.dy + num(props.dy, 0)
  const children = props.children
  const list = Array.isArray(children) ? children.flat(Infinity) : [children]

  const hasTspan = list.some((child) => child !== null && typeof child === 'object' && String(child.type) === 'tspan')
  if (!hasTspan) {
    const text = list.filter((child) => typeof child === 'string' || typeof child === 'number').join('')
    return text === '' ? [] : [{ lines: [text], x: x + dx, y: y + dy }]
  }

  const runs = []
  for (const child of list) {
    if (child !== null && typeof child === 'object' && String(child.type) === 'tspan') {
      runs.push(...readTextRuns(child, { x: x + dx, y: y + dy, dx, dy }))
    } else if (typeof child === 'string' && child.trim() !== '') {
      runs.push({ lines: [child], x: x + dx, y: y + dy })
    }
  }
  return runs
}

/** The font sizes the plugin's own stylesheet sets. */
const FONT_SIZE = {
  node: 11.5,
  edge: 10,
}

/** The font sizes the plugin's own stylesheet sets. */
export const STYLESHEET_FONT = FONT_SIZE

/**
 * Walk the `<svg>` subtree and collect the shapes that can be measured.
 * @param {any} svg - the `<svg>` element.
 * @returns {{
 *   boxes: {id: string, classNames: string[], rect: Rect}[],
 *   paths: {classNames: string[], d: string}[],
 *   lines: {classNames: string[], a: [number, number], b: [number, number], markerEnd: string | null, markerStart: string | null}[],
 *   texts: {classNames: string[], runs: {text: string, rect: Rect, isEdgeLabel: boolean}[]}[],
 *   viewBox: {x: number, y: number, width: number, height: number},
 * }}
 */
export function readScene(svg) {
  const props = svg.props ?? {}
  const raw = String(props.viewBox ?? '').trim().split(/[\s,]+/).map(Number)
  const viewBox = raw.length === 4 && raw.every(Number.isFinite)
    ? { x: raw[0], y: raw[1], width: raw[2], height: raw[3] }
    : { x: 0, y: 0, width: num(props.width, 0), height: num(props.height, 0) }

  /** @type {any[]} */
  const boxes = []
  /** @type {any[]} */
  const paths = []
  /** @type {any[]} */
  const lines = []
  /** @type {any[]} */
  const texts = []

  /**
   * Descend, recording measurable shapes.
   * @param {any} node - the current element.
   * @param {string[]} ancestors - class names inherited from enclosing elements, for edge-label pills drawn as a group.
   */
  const visit = (node, ancestors) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child, ancestors)
      return
    }
    const tag = String(node.type)
    const nodeProps = node.props ?? {}
    const classNames = classesOf(nodeProps)
    const context = [...ancestors, ...classNames]

    if (tag === 'rect') {
      boxes.push({
        tag,
        classNames,
        context,
        rect: {
          x: num(nodeProps.x),
          y: num(nodeProps.y),
          width: num(nodeProps.width),
          height: num(nodeProps.height),
        },
        rx: num(nodeProps.rx, 0),
      })
      return
    }
    if (tag === 'path') {
      paths.push({ classNames, context, d: String(nodeProps.d ?? ''), polyline: polylineOfPath(nodeProps.d) })
      return
    }
    if (tag === 'line') {
      lines.push({
        classNames,
        context,
        a: [num(nodeProps.x1), num(nodeProps.y1)],
        b: [num(nodeProps.x2), num(nodeProps.y2)],
        markerEnd: typeof nodeProps.markerEnd === 'string' ? nodeProps.markerEnd : nodeProps.markerEnd === undefined ? null : String(nodeProps.markerEnd),
        markerStart: typeof nodeProps.markerStart === 'string' ? nodeProps.markerStart : nodeProps.markerStart === undefined ? null : String(nodeProps.markerStart),
      })
      return
    }
    if (tag === 'text') {
      const runs = readTextRuns(node)
      const isEdgeLabel = context.some((name) => /edge-label/.test(name)) || (runs.length > 0 && nodeProps.className === undefined)
      const fontSize = nodeProps.fontSize !== undefined
        ? num(nodeProps.fontSize, FONT_SIZE.node)
        : context.some((name) => /edge-label/.test(name)) ? FONT_SIZE.edge : FONT_SIZE.node
      const anchor = String(nodeProps.textAnchor ?? 'start')
      texts.push({
        classNames,
        context,
        runs: runs.map((run) => {
          const text = run.lines.join('')
          const width = measureText(text, fontSize)
          const x = anchor === 'middle' ? run.x - width / 2 : anchor === 'end' ? run.x - width : run.x
          return {
            text,
            fontSize,
            anchor,
            isEdgeLabel,
            rect: { x, y: run.y - fontSize * 0.8, width, height: fontSize * 1.15 },
          }
        }),
      })
      return
    }
    if (nodeProps.children !== undefined) visit(nodeProps.children, context)
  }

  visit(props.children, [])

  return { boxes, paths, lines, texts, viewBox }
}

/**
 * Find the node boxes: the rectangles that carry a node class, falling back to
 * every rectangle when the renderer does not classify them. A renderer that
 * emits unclassed rectangles is still measured — the preview must not be able
 * to pass by simply not labelling anything.
 * @param {ReturnType<typeof readScene>} scene - the scene.
 * @returns {{id: string, classNames: string[], rect: Rect}[]} the boxes.
 */
export function nodeBoxes(scene) {
  const labelled = scene.boxes.filter((box) => box.classNames.some((name) => /node|-box|-card/.test(name)))
  const chosen = labelled.length > 0 ? labelled : scene.boxes.filter((box) => box.rect.width > 8 && box.rect.height > 8)
  return chosen.map((box, index) => ({
    id: box.classNames.find((name) => /node/.test(name)) !== undefined ? `${box.classNames.find((name) => /node/.test(name))}#${index}` : `rect#${index}`,
    classNames: box.classNames,
    context: box.context,
    rect: box.rect,
  }))
}

/**
 * Find the edge-label pills: rectangles that are not node boxes and that are
 * either classed as a label background or sit behind edge-label text.
 * @param {ReturnType<typeof readScene>} scene - the scene.
 * @param {{rect: Rect}[]} boxes - the node boxes, so pills are not double counted.
 * @returns {{id: string, rect: Rect}[]} the pills.
 */
export function edgePills(scene, boxes) {
  const nodeRects = boxes.map((box) => box.rect)
  return scene.boxes
    .filter((box) => {
      if (box.classNames.some((name) => /node/.test(name))) return false
      if (nodeRects.some((rect) => rect.x === box.rect.x && rect.y === box.rect.y && rect.width === box.rect.width && rect.height === box.rect.height)) return false
      return box.context.some((name) => /label|pill|badge|chip/.test(name)) || (box.rect.width < 400 && box.rect.height < 40 && box.rect.width > 4)
    })
    .map((box, index) => ({ id: `pill#${index}`, rect: box.rect }))
}

/**
 * All text runs, flattened, with the rectangle each one occupies.
 * @param {ReturnType<typeof readScene>} scene - the scene.
 * @returns {{text: string, rect: Rect, isEdgeLabel: boolean, fontSize: number}[]} the runs.
 */
export function textRuns(scene) {
  return scene.texts.flatMap((text) => text.runs.map((run) => ({
    text: run.text,
    rect: run.rect,
    isEdgeLabel: run.isEdgeLabel,
    fontSize: run.fontSize,
  })))
}

/**
 * Which node box, if any, a rectangle sits inside.
 * @param {{rect: Rect}[]} boxes - the node boxes.
 * @param {Rect} rect - the rectangle.
 * @returns {{rect: Rect} | null} the containing box.
 */
function boxContaining(boxes, rect) {
  return boxes.find((box) => contains(box.rect, rect, 0.5)) ?? null
}

/**
 * The point where a segment first leaves a rectangle.
 * @param {Rect} rect - the rectangle.
 * @param {[number, number]} inside - a point inside.
 * @param {[number, number]} outside - a point outside.
 * @returns {[number, number] | null} the exit point, or null when the geometry is degenerate.
 */
function exitPoint(rect, inside, outside) {
  const dx = outside[0] - inside[0]
  const dy = outside[1] - inside[1]
  if (dx === 0 && dy === 0) return null
  let t = Infinity
  if (dx > 0) t = Math.min(t, (rect.x + rect.width - inside[0]) / dx)
  if (dx < 0) t = Math.min(t, (rect.x - inside[0]) / dx)
  if (dy > 0) t = Math.min(t, (rect.y + rect.height - inside[1]) / dy)
  if (dy < 0) t = Math.min(t, (rect.y - inside[1]) / dy)
  if (!Number.isFinite(t) || t < 0) return null
  return [inside[0] + dx * t, inside[1] + dy * t]
}

/**
 * Distance from a point to a rectangle's boundary (zero when inside).
 * @param {Rect} rect - the rectangle.
 * @param {[number, number]} point - the point.
 * @returns {number} the distance.
 */
function distanceToRect(rect, point) {
  const dx = Math.max(rect.x - point[0], 0, point[0] - (rect.x + rect.width))
  const dy = Math.max(rect.y - point[1], 0, point[1] - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

/**
 * The arrows the renderer emits: either `<line>` elements with a marker, or
 * `<path>` elements whose class marks them as edges. Both are normalised to a
 * start and an end point plus an `arrowAtEnd` flag.
 * @param {ReturnType<typeof readScene>} scene - the scene.
 * @returns {{index: number, a: [number, number], b: [number, number], arrowAtEnd: boolean, arrowAtStart: boolean, kind: string}[]} the arrows.
 */
export function arrows(scene) {
  const out = scene.lines.map((line, index) => ({
    index,
    a: line.a,
    b: line.b,
    arrowAtEnd: line.markerEnd !== null && line.markerEnd !== 'none',
    arrowAtStart: line.markerStart !== null && line.markerStart !== 'none',
    kind: 'line',
  }))
  for (const path of scene.paths) {
    if (path.classNames.some((name) => /arrow|marker|head/.test(name))) continue
    if (!path.context.some((name) => /edge|arrow|connector|link/.test(name))) continue
    const points = endpointsOfPath(path.d)
    if (points === null) continue
    out.push({
      index: out.length,
      a: points[0],
      b: points[1],
      polyline: path.polyline ?? [],
      arrowAtEnd: true,
      arrowAtStart: false,
      kind: 'path',
    })
  }
  return out
}

/**
 * The points an arrow passes through, spaced densely enough to catch a crossing.
 *
 * A connector drawn as a path carries its real route, so it is measured on
 * that route; a straight `<line>` is sampled along its span. Sampling the chord
 * of a routed connector instead would report crossings the router avoided.
 * @param {{a: number[], b: number[], polyline?: number[][]}} arrow - the arrow.
 * @returns {number[][]} the sampled points.
 */
function sampleArrow(arrow) {
  const route = Array.isArray(arrow.polyline) && arrow.polyline.length > 1 ? arrow.polyline : [arrow.a, arrow.b]
  const points = []
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1]
    const to = route[index]
    const steps = Math.max(2, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 2))
    for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps
      points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])
    }
  }
  return points
}

/**
 * First and last coordinate pair of an SVG path `d` string.
 *
 * Only absolute and relative `M`/`L`/`H`/`V`/`C`/`Q` commands are needed: a
 * renderer that draws elbow connectors always starts with `M` and ends with a
 * straight or curved segment, and the *endpoint* is what the arrowhead sits on.
 * @param {string} d - the path data.
 * @returns {[[number, number], [number, number]] | null} start and end, or null.
 */
function endpointsOfPath(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (tokens === null || tokens.length === 0) return null
  let index = 0
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let first = null
  let last = [0, 0]
  let command = 'M'
  const take = () => Number.parseFloat(tokens[index++])

  while (index < tokens.length) {
    const token = tokens[index]
    if (/^[A-Za-z]$/.test(token)) {
      command = token
      index += 1
      if (command === 'Z' || command === 'z') {
        x = startX
        y = startY
        last = [x, y]
        continue
      }
    }
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'M': {
        const nx = take()
        const ny = take()
        x = relative ? x + nx : nx
        y = relative ? y + ny : ny
        startX = x
        startY = y
        if (first === null) first = [x, y]
        last = [x, y]
        // Subsequent pairs after a moveto are line-to.
        command = relative ? 'l' : 'L'
        break
      }
      case 'L': {
        const nx = take()
        const ny = take()
        x = relative ? x + nx : nx
        y = relative ? y + ny : ny
        last = [x, y]
        break
      }
      case 'H': {
        const nx = take()
        x = relative ? x + nx : nx
        last = [x, y]
        break
      }
      case 'V': {
        const ny = take()
        y = relative ? y + ny : ny
        last = [x, y]
        break
      }
      case 'C': {
        // A cubic's *endpoint* is what an arrowhead attaches to, which is all
        // this function needs; the control points only decide the shape.
        take(); take()
        take(); take()
        const x3 = take()
        const y3 = take()
        x = relative ? x + x3 : x3
        y = relative ? y + y3 : y3
        last = [x, y]
        break
      }
      case 'S': {
        take(); take()
        const x2 = take()
        const y2 = take()
        x = relative ? x + x2 : x2
        y = relative ? y + y2 : y2
        last = [x, y]
        break
      }
      case 'Q': {
        take(); take()
        const x2 = take()
        const y2 = take()
        x = relative ? x + x2 : x2
        y = relative ? y + y2 : y2
        last = [x, y]
        break
      }
      case 'T': {
        const x2 = take()
        const y2 = take()
        x = relative ? x + x2 : x2
        y = relative ? y + y2 : y2
        last = [x, y]
        break
      }
      case 'A': {
        take(); take(); take(); take(); take()
        const x2 = take()
        const y2 = take()
        x = relative ? x + x2 : x2
        y = relative ? y + y2 : y2
        last = [x, y]
        break
      }
      default: {
        // An unsupported command: skip its arguments conservatively.
        index += 1
        if (index >= tokens.length) return first === null ? null : [first, last]
        break
      }
    }
  }
  return first === null ? null : [first, last]
}

/**
 * Sample the points a connector path actually passes through.
 *
 * A curve or an elbow routed around the boxes is not its chord: measuring the
 * straight line from the first point to the last would report an edge crossing
 * a box it deliberately steps around. Every command's destination point is
 * recorded, and curves are additionally sampled across their span so a bowed
 * connector is measured where it really runs.
 * @param {string} d - the SVG path data.
 * @returns {[number, number][]} the sampled points, outermost first.
 */
function polylineOfPath(d) {
  const tokens = String(d ?? '').match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (tokens === null || tokens.length === 0) return []
  const points = []
  let index = 0
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let command = 'M'
  const take = () => Number.parseFloat(tokens[index++])
  const push = () => {
    const last = points[points.length - 1]
    if (last === undefined || Math.abs(last[0] - x) > 1e-9 || Math.abs(last[1] - y) > 1e-9) points.push([x, y])
  }
  while (index < tokens.length) {
    const token = tokens[index]
    if (/^[A-Za-z]$/.test(token)) {
      command = token
      index += 1
      if (command === 'Z' || command === 'z') {
        x = startX
        y = startY
        push()
        continue
      }
    }
    const relative = command === command.toLowerCase()
    const upper = command.toUpperCase()
    if (upper === 'H' || upper === 'V') {
      const value = take()
      if (upper === 'H') x = relative ? x + value : value
      else y = relative ? y + value : value
      push()
      continue
    }
    if (upper === 'Z') {
      x = startX
      y = startY
      push()
      continue
    }
    const fromX = x
    const fromY = y
    const nx = take()
    const ny = take()
    x = relative ? x + nx : nx
    y = relative ? y + ny : ny
    if (upper === 'M') {
      startX = x
      startY = y
      push()
      continue
    }
    // A curve reaches its end point only after wandering, so walk the span to
    // keep the samples near the ink.
    const bowed = upper === 'C' || upper === 'S' || upper === 'Q' || upper === 'T' || upper === 'A'
    if (bowed) {
      const steps = 8
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps
        points.push([fromX + (x - fromX) * t, fromY + (y - fromY) * t])
      }
    }
    push()
  }
  return points
}

/**
 * Run every check over one rendered diagram.
 *
 * @param {any} svg - the `<svg>` element, before serialisation.
 * @param {object} options - what the container is.
 * @param {number} options.width - the available width in CSS px.
 * @param {number} [options.padding] - horizontal padding deducted from the width.
 * @param {string} options.caseName - the case name, echoed into every finding.
 * @returns {{
 *   caseName: string,
 *   viewBox: {x: number, y: number, width: number, height: number},
 *   counts: {nodes: number, arrows: number, pills: number, texts: number},
 *   fit: {available: number, natural: number, scale: number, overflows: boolean, svgWidthAttribute: string | null},
 *   findings: {severity: string, rule: string, detail: string, coordinates: string}[]
 * }}
 */
export function analyzeSvg(svg, options) {
  const scene = readScene(svg)
  const boxes = nodeBoxes(scene)
  const pills = edgePills(scene, boxes)
  const runs = textRuns(scene)
  const arrowList = arrows(scene)
  const findings = []
  const add = (severity, rule, detail, coordinates) => findings.push({ severity, rule, detail, coordinates })

  const svgProps = svg.props ?? {}
  const padding = options.padding ?? 14
  const available = Math.max(0, options.width - padding * 2)
  const natural = scene.viewBox.width
  const scaleAttribute = typeof svgProps.width === 'string' ? svgProps.width : typeof svgProps.width === 'number' ? `${svgProps.width}px` : null
  const style = svgProps.style ?? {}
  const scale = natural > 0 ? available / natural : 1
  const clipHost = [...boxes, ...pills]

  // ---- 1. Does the drawing fit the container it is placed in? -------------
  const overflows = natural > available + 0.5
  if (overflows) {
    const isPercent = scaleAttribute === '100%'
    add(
      isPercent ? 'info' : 'error',
      'container-overflow',
      isPercent
        ? `viewBox is ${round(natural)}px wide against ${round(available)}px of content box; it scales to ${round(scale * 100)}%, so text shrinks to ${round(FONT_SIZE.node * scale)}px (edge labels ${round(FONT_SIZE.edge * scale)}px)`
        : `viewBox is ${round(natural)}px wide against ${round(available)}px of content box and the svg does not scale (width="${scaleAttribute}"), so it overflows by ${round(natural - available)}px`,
      `viewBox="0 0 ${round(natural)} ${round(scene.viewBox.height)}"`,
    )
    if (isPercent && scale < 0.62) {
      add('warn', 'unreadable-at-sidebar-width', `scaling to ${round(scale * 100)}% puts node labels at ${round(FONT_SIZE.node * scale)}px and edge labels at ${round(FONT_SIZE.edge * scale)}px`, `scale=${round(scale)}`)
    }
  }

  // ---- 2. Is any text clipped by its own box? ----------------------------
  for (const run of runs) {
    if (run.isEdgeLabel) continue
    const owner = boxContaining(boxes, run.rect)
    if (owner === null) continue
    const inset = 2
    const inner = { x: owner.rect.x + inset, y: owner.rect.y + inset, width: owner.rect.width - inset * 2, height: owner.rect.height - inset * 2 }
    if (!contains(inner, run.rect, 0.5)) {
      const overLeft = round(Math.max(0, inner.x - run.rect.x))
      const overRight = round(Math.max(0, run.rect.x + run.rect.width - (inner.x + inner.width)))
      const overTop = round(Math.max(0, inner.y - run.rect.y))
      const overBottom = round(Math.max(0, run.rect.y + run.rect.height - (inner.y + inner.height)))
      add(
        'error',
        'text-clipped',
        `label "${run.text}" is clipped by its box: over by left ${overLeft} / right ${overRight} / top ${overTop} / bottom ${overBottom} px`,
        `text="${run.text}" box=(${round(owner.rect.x)},${round(owner.rect.y)} ${round(owner.rect.width)}×${round(owner.rect.height)}) textBox=(${round(run.rect.x)},${round(run.rect.y)} ${round(run.rect.width)}×${round(run.rect.height)})`,
      )
    }
  }

  // ---- 3. Does any text escape outside the drawing? ----------------------
  for (const run of runs) {
    const outside = !(
      run.rect.x >= scene.viewBox.x - 0.5
      && run.rect.y >= scene.viewBox.y - 0.5
      && run.rect.x + run.rect.width <= scene.viewBox.x + scene.viewBox.width + 0.5
      && run.rect.y + run.rect.height <= scene.viewBox.y + scene.viewBox.height + 0.5
    )
    if (outside) {
      add('error', 'text-outside-viewBox', `label "${run.text}" extends past the viewBox and will be cut off`, `text=(${round(run.rect.x)},${round(run.rect.y)} ${round(run.rect.width)}×${round(run.rect.height)}) viewBox=0 0 ${round(scene.viewBox.width)} ${round(scene.viewBox.height)}`)
    }
  }

  // ---- 4. Do two node labels overlap each other? -------------------------
  const nodeRuns = runs.filter((run) => !run.isEdgeLabel && boxContaining(boxes, run.rect) !== null)
  for (let i = 0; i < nodeRuns.length; i += 1) {
    for (let j = i + 1; j < nodeRuns.length; j += 1) {
      const area = overlapArea(nodeRuns[i].rect, nodeRuns[j].rect)
      if (area > 0.5) {
        add('error', 'node-label-overlap', `"${nodeRuns[i].text}" and "${nodeRuns[j].text}" overlap by ${round(area)}px²`, `a=(${round(nodeRuns[i].rect.x)},${round(nodeRuns[i].rect.y)} ${round(nodeRuns[i].rect.width)}×${round(nodeRuns[i].rect.height)}) b=(${round(nodeRuns[j].rect.x)},${round(nodeRuns[j].rect.y)} ${round(nodeRuns[j].rect.width)}×${round(nodeRuns[j].rect.height)})`)
      }
    }
  }

  // ---- 5. Do any two node boxes overlap? ---------------------------------
  for (let i = 0; i < boxes.length; i += 1) {
    if (!boxes[i].classNames.some((name) => /node/.test(name))) continue
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (!boxes[j].classNames.some((name) => /node/.test(name))) continue
      const area = overlapArea(boxes[i].rect, boxes[j].rect)
      if (area > 0.5) {
        add('error', 'node-box-overlap', `two node boxes overlap by ${round(area)}px²`, `a=(${round(boxes[i].rect.x)},${round(boxes[i].rect.y)} ${round(boxes[i].rect.width)}×${round(boxes[i].rect.height)}) b=(${round(boxes[j].rect.x)},${round(boxes[j].rect.y)} ${round(boxes[j].rect.width)}×${round(boxes[j].rect.height)})`)
      }
    }
  }

  // ---- 6. Do edge-label pills collide with boxes or each other? ----------
  const labelledPills = pills.filter((pill) => {
    // A pill is only interesting if there is edge-label text on it.
    return runs.some((run) => run.isEdgeLabel && contains(pill.rect, run.rect, 3))
  })
  const pillHost = labelledPills.length > 0 ? labelledPills : pills
  for (let i = 0; i < pillHost.length; i += 1) {
    for (let j = 0; j < boxes.length; j += 1) {
      if (!boxes[j].classNames.some((name) => /node/.test(name)) && nodeBoxes(scene).length !== scene.boxes.length) continue
      const area = overlapArea(pillHost[i].rect, boxes[j].rect)
      if (area > 0.5) {
        add('error', 'pill-overlaps-node', `edge-label pill ${pillHost[i].id} overlaps a node box by ${round(area)}px²`, `pill=(${round(pillHost[i].rect.x)},${round(pillHost[i].rect.y)} ${round(pillHost[i].rect.width)}×${round(pillHost[i].rect.height)}) node=(${round(boxes[j].rect.x)},${round(boxes[j].rect.y)} ${round(boxes[j].rect.width)}×${round(boxes[j].rect.height)})`)
      }
    }
    for (let j = i + 1; j < pillHost.length; j += 1) {
      const area = overlapArea(pillHost[i].rect, pillHost[j].rect)
      if (area > 0.5) {
        add('error', 'pill-overlap-pill', `${pillHost[i].id} and ${pillHost[j].id} overlap by ${round(area)}px²`, `a=(${round(pillHost[i].rect.x)},${round(pillHost[i].rect.y)} ${round(pillHost[i].rect.width)}×${round(pillHost[i].rect.height)}) b=(${round(pillHost[j].rect.x)},${round(pillHost[j].rect.y)} ${round(pillHost[j].rect.width)}×${round(pillHost[j].rect.height)})`)
      }
    }
  }

  // ---- 7. Does edge-label text escape its own pill? ----------------------
  for (const run of runs) {
    if (!run.isEdgeLabel) continue
    const owner = pillHost.find((pill) => contains(pill.rect, run.rect, 6)) ?? null
    if (owner === null) {
      if (pillHost.length > 0) {
        add('warn', 'edge-label-unpilled', `edge label "${run.text}" has no background pill, so the line will run through the text`, `text=(${round(run.rect.x)},${round(run.rect.y)} ${round(run.rect.width)}×${round(run.rect.height)})`)
      }
      continue
    }
    if (!contains(owner.rect, run.rect, 1.5)) {
      add('error', 'edge-label-clipped', `edge label "${run.text}" overflows its pill`, `text=(${round(run.rect.x)},${round(run.rect.y)} ${round(run.rect.width)}×${round(run.rect.height)}) pill=(${round(owner.rect.x)},${round(owner.rect.y)} ${round(owner.rect.width)}×${round(owner.rect.height)})`)
    }
  }

  // ---- 8. Do arrowheads sit on the box border, pointing at the box? ------
  for (const arrow of arrowList) {
    const segments = [
      { tip: arrow.b, tail: arrow.a, hasArrow: arrow.arrowAtEnd, role: 'head' },
      { tip: arrow.a, tail: arrow.b, hasArrow: arrow.arrowAtStart, role: 'tail' },
    ]
    if (!arrow.arrowAtEnd && !arrow.arrowAtStart) {
      add('warn', 'edge-without-arrowhead', `edge ${arrow.index} (${round(arrow.a[0])},${round(arrow.a[1])})→(${round(arrow.b[0])},${round(arrow.b[1])}) has no arrowhead at all`, `edge=${arrow.index}`)
      continue
    }
    for (const segment of segments) {
      if (!segment.hasArrow) continue
      const tip = segment.tip
      const distances = boxes.map((box) => ({ box, distance: distanceToRect(box.rect, tip) }))
      const nearest = distances.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best), { box: null, distance: Infinity })
      if (nearest.box === null || nearest.distance > 4) {
        add('error', 'arrowhead-detached', `arrow ${segment.role} of edge ${arrow.index} ends at (${round(tip[0])},${round(tip[1])}), ${round(nearest.distance)}px away from the nearest box border`, `tip=(${round(tip[0])},${round(tip[1])}) nearest=${nearest.box === null ? 'none' : `(${round(nearest.box.rect.x)},${round(nearest.box.rect.y)} ${round(nearest.box.rect.width)}×${round(nearest.box.rect.height)})`}`)
    continue
      }
      // The tail must be outside the box the tip touches, otherwise the line
      // enters the box and the arrow points the wrong way.
      const tailInside = contains(nearest.box.rect, { x: segment.tail[0], y: segment.tail[1], width: 0.01, height: 0.01 })
      if (tailInside) {
        add('error', 'arrow-direction-wrong', `arrow ${segment.role} of edge ${arrow.index} points into the box it starts from (tip and tail both inside the same box)`, `tip=(${round(tip[0])},${round(tip[1])}) tail=(${round(segment.tail[0])},${round(segment.tail[1])})`)
        continue
      }
      // And the tail must be strictly further out, i.e. the segment leaves the
      // box in the direction of the tip.
      const awayDistance = distanceToRect(nearest.box.rect, segment.tail)
      if (awayDistance <= nearest.distance + 1) {
        add('error', 'arrow-direction-wrong', `arrow ${segment.role} of edge ${arrow.index} is not aimed at the box: its tail is ${round(awayDistance)}px from the border vs the tip's ${round(nearest.distance)}px`, `tip=(${round(tip[0])},${round(tip[1])}) tail=(${round(segment.tail[0])},${round(segment.tail[1])})`)
      }
    }
  }

  // ---- 9. Do edges cut through boxes they are not attached to? -----------
  for (const arrow of arrowList) {
    const attached = boxes.filter((box) => distanceToRect(box.rect, arrow.a) <= 4 || distanceToRect(box.rect, arrow.b) <= 4
      || contains(box.rect, { x: arrow.a[0], y: arrow.a[1], width: 0.01, height: 0.01 })
      || contains(box.rect, { x: arrow.b[0], y: arrow.b[1], width: 0.01, height: 0.01 }))
    for (const box of boxes) {
      if (attached.some((candidate) => candidate.rect === box.rect)) continue
      // Measure the route the connector really takes: a routed path steps around
      // the boxes, and its chord would report crossings that do not exist. A
      // connector that runs along a border grazes it rather than crossing it, so
      // only points meaningfully inside the box count.
      const crossed = sampleArrow(arrow).some((point) => contains(box.rect, { x: point[0], y: point[1], width: 0.01, height: 0.01 }, -1.5))
      if (crossed) {
        add('warn', 'edge-crosses-node', `edge ${arrow.index} passes through a box it is not attached to`, `edge (${round(arrow.a[0])},${round(arrow.a[1])})→(${round(arrow.b[0])},${round(arrow.b[1])}) crosses box=(${round(box.rect.x)},${round(box.rect.y)} ${round(box.rect.width)}×${round(box.rect.height)})`)
      }
    }
  }

  // ---- 10. Does any text sit under an edge line it is not the label of? --
  //
  // An edge whose endpoint is the centre of a box necessarily runs across that
  // box's label; that is the "edge covers text" defect in its most common form,
  // and it is reported once per (edge, text) pair. Sampling every 2px means a
  // 40px box cannot be stepped over.
  for (const run of runs) {
    if (run.isEdgeLabel) continue
    if (pillHost.some((pill) => contains(pill.rect, run.rect, 3))) continue
    for (const arrow of arrowList) {
      for (const point of sampleArrow(arrow)) {
        if (!contains(run.rect, { x: point[0], y: point[1], width: 0.01, height: 0.01 }, 0)) continue
        add('error', 'edge-covers-text', `edge ${arrow.index} runs through the text "${run.text}"`, `edge (${round(arrow.a[0])},${round(arrow.a[1])})→(${round(arrow.b[0])},${round(arrow.b[1])}) text=(${round(run.rect.x)},${round(run.rect.y)} ${round(run.rect.width)}×${round(run.rect.height)})`)
        break
      }
    }
  }

  // ---- 11. Is anything degenerate? --------------------------------------
  if (scene.viewBox.width <= 0 || scene.viewBox.height <= 0) {
    add('error', 'degenerate-viewBox', `viewBox is ${round(scene.viewBox.width)}×${round(scene.viewBox.height)}`, 'viewBox')
  }
  if (boxes.length === 0) {
    add('error', 'no-nodes', 'the drawing contains no node box at all', '—')
  }
  for (const box of boxes) {
    if (box.rect.x < scene.viewBox.x - 0.5 || box.rect.y < scene.viewBox.y - 0.5
      || box.rect.x + box.rect.width > scene.viewBox.x + scene.viewBox.width + 0.5
      || box.rect.y + box.rect.height > scene.viewBox.y + scene.viewBox.height + 0.5) {
      add('error', 'node-outside-viewBox', 'a node box extends past the viewBox and will be cut off', `box=(${round(box.rect.x)},${round(box.rect.y)} ${round(box.rect.width)}×${round(box.rect.height)}) viewBox=0 0 ${round(scene.viewBox.width)} ${round(scene.viewBox.height)}`)
    }
  }

  return {
    caseName: options.caseName,
    viewBox: scene.viewBox,
    counts: { nodes: boxes.length, arrows: arrowList.length, pills: pills.length, texts: runs.length },
    fit: {
      available: round(available),
      natural: round(natural),
      scale: round(scale),
      overflows: Boolean(overflows),
      svgWidthAttribute: scaleAttribute,
      clipHostHeight: clipHost.length === 0 ? 0 : round(Math.max(...clipHost.map((entry) => entry.rect.y + entry.rect.height))),
    },
    findings,
  }
}
