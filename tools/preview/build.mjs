#!/usr/bin/env node
/**
 * Build `tools/preview/preview.html`: every diagram the plugin draws, rendered
 * through the real client bundle, in both themes, at both widths, with the
 * geometry findings printed to the console.
 *
 * Run it with no arguments:
 *
 * ```sh
 * node tools/preview/build.mjs
 * ```
 *
 * Options:
 *
 * ```
 * --wiki <path>     read diagrams from this wiki.json (default: the plugin's own cache)
 * --out <path>      write the page here (default: tools/preview/preview.html)
 * --no-open         (default) never open a browser
 * --json            print the findings as JSON instead of a text report
 * --quiet           print only the summary line
 * ```
 *
 * The exit code is 0 when the build succeeded, 1 when the bundle could not be
 * loaded, and 2 when `--strict` was passed and at least one `error`-severity
 * finding was produced. The build itself never fails because a diagram looks
 * wrong: finding the bad diagrams is the point.
 *
 * @module dsh-repo-wiki/tools/preview/build
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyzeSvg } from './analyze.mjs'
import { buildCorpus, DEFAULT_WIKI } from './corpus.mjs'
import { escapeText, loadClient, serializeTree } from './load.mjs'
import { loadTheme } from './theme.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

/** The two containers a diagram is read in. */
const WIDTHS = [
  { id: 'sidebar', width: 420, note: 'right sidebar (~420px)' },
  { id: 'lightbox', width: 900, note: 'lightbox (~900px)' },
]

/**
 * Read `--flag value` and `--flag` pairs from argv.
 * @param {string[]} argv - the arguments after the script name.
 * @returns {Record<string, string | boolean>} the parsed options.
 */
function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) continue
    const key = argument.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      options[key] = true
    } else {
      options[key] = next
      index += 1
    }
  }
  return options
}

/**
 * Pull the first `<svg>` out of a rendered tree.
 * @param {any} tree - the element tree.
 * @returns {any | null} the svg element.
 */
function findSvg(tree) {
  let found = null
  const walk = (node) => {
    if (found !== null || node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (String(node.type) === 'svg') {
      found = node
      return
    }
    if (node.props !== undefined) walk(node.props.children)
  }
  walk(tree)
  return found
}

/**
 * Render one corpus case through `DiagramBlock`.
 *
 * `DiagramBlock` has to survive a source it cannot lay out by falling back to a
 * source view, so the caller is told which happened rather than guessing from
 * an empty string.
 * @param {ReturnType<typeof loadClient>} client - the loaded bundle.
 * @param {{id: string, source: string}} entry - the case.
 * @returns {{svg: any | null, markup: string, degraded: boolean, error: string | null}} the result.
 */
function renderCase(client, entry) {
  const translate = (key) => key
  try {
    const tree = client.render(client.internals.DiagramBlock, { source: entry.source, t: translate })
    const svg = findSvg(tree)
    return {
      svg,
      markup: serializeTree(svg ?? tree),
      degraded: svg === null,
      error: null,
    }
  } catch (error) {
    return {
      svg: null,
      markup: `<pre class="degenerate">${escapeText(entry.source)}</pre>`,
      degraded: true,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

/**
 * Render the page.
 *
 * @param {object} input - everything the page needs.
 * @returns {string} the HTML.
 */
function page(input) {
  const { cases, theme, pluginCss, bundleCss, generatedAt, clientPath, wikiPath } = input
  const sections = []

  sections.push(`<header class="head">
  <h1>repo-wiki diagram preview</h1>
  <p class="meta">Generated ${escapeText(generatedAt)} from <code>${escapeText(clientPath)}</code>${wikiPath === null ? '' : ` and <code>${escapeText(wikiPath)}</code>`}.</p>
  <p class="meta">Theme: <a class="themebtn" href="?dark=0">light</a> · <a class="themebtn" href="?dark=1">dark</a>. The current theme follows <code>?dark=1</code> and is applied to <code>&lt;body data-ds-dark-theme&gt;</code>, exactly like the app.</p>
  <p class="meta">Each diagram is shown at both real widths. The <strong>420px</strong> column is the right sidebar; the <strong>900px</strong> column is the lightbox. Geometry findings for each case are printed under it.</p>
</header>`)

  for (const entry of cases) {
    const rows = WIDTHS.map((size) => {
      const render = renderCase(input.client, entry)
      const report = render.svg === null ? null : analyzeSvg(render.svg, { width: size.width, caseName: `${entry.id}@${size.id}` })
      const badges = report === null
        ? ['<span class="badge bad">no svg</span>']
        : report.findings.length === 0
          ? ['<span class="badge good">clean</span>']
          : [...new Set(report.findings.map((finding) => finding.severity))].map((severity) => `<span class="badge ${severity === 'error' ? 'bad' : severity === 'warn' ? 'warn' : 'info'}">${severity === 'error' ? `${report.findings.filter((f) => f.severity === 'error').length} error` : severity}</span>`)
      const findings = report === null
        ? ''
        : report.findings.length === 0 ? '' : `<ol class="findings">${report.findings.map((finding) => `<li class="${finding.severity}"><span class="rule">${escapeText(finding.rule)}</span> ${escapeText(finding.detail)}<code class="coord">${escapeText(finding.coordinates)}</code></li>`).join('')}</ol>`
      const fit = report === null ? '' : `<p class="fit">viewBox ${report.viewBox.width}×${report.viewBox.height} · content box ${report.fit.available}px · scale ${Math.round(report.fit.scale * 100)}% · ${report.counts.nodes} nodes / ${report.counts.arrows} arrows / ${report.counts.pills} pills</p>`
      const renderError = render.error === null ? '' : `<p class="threw">renderer threw: <code>${escapeText(render.error)}</code></p>`
      const degraded = render.degraded && render.error === null ? '<p class="threw">renderer fell back to the source view (no <code>&lt;svg&gt;</code> was produced)</p>' : ''
      return `<div class="row" data-width="${size.id}">
  <div class="rowhead"><h3>${escapeText(size.note)}</h3><div class="badges">${[...new Set(badges)].join('')}</div></div>
  <div class="frame" style="width:${size.width}px">${render.markup}</div>
  ${fit}${renderError}${degraded}${findings}
</div>`
    }).join('\n')

    sections.push(`<section class="case" id="${escapeText(entry.id)}">
  <div class="casehead">
    <h2><a href="#${escapeText(entry.id)}">${escapeText(entry.id)}</a></h2>
    <p class="note">${escapeText(entry.note)}</p>
    <details><summary>Mermaid source</summary><pre>${escapeText(entry.source)}</pre></details>
  </div>
  ${rows}
</section>`)
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>repo-wiki diagram preview</title>
<style>
${theme.light}
</style>
<style id="dark-theme">
${theme.dark}
</style>
<style id="plugin-css">
${pluginCss}
</style>
<style id="bundle-css">
${bundleCss}
</style>
<style>
/* Preview chrome only: nothing below is part of the plugin. */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 24px; font-family: var(--dsw-font-family, system-ui, sans-serif); background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111); font-size: 13px; line-height: 1.5; }
.head { max-width: 1400px; margin: 0 auto 28px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.15)); padding-bottom: 14px; }
.head h1 { font-size: 20px; margin: 0 0 6px; }
.meta { margin: 2px 0; color: var(--dsw-alias-label-secondary, #555); }
.meta code { font-family: var(--ds-font-family-code, monospace); font-size: 11.5px; }
.themebtn { color: var(--dsw-alias-brand-primary, #3b6ef5); }
main { max-width: 1400px; margin: 0 auto; }
.case { margin: 0 0 40px; padding: 0 0 20px; border-bottom: 1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.15)); }
.casehead h2 { font-size: 15px; margin: 0 0 2px; }
.casehead h2 a { color: inherit; text-decoration: none; }
.casehead .note { margin: 0 0 8px; color: var(--dsw-alias-label-secondary, #555); }
.casehead details { margin: 0 0 12px; }
.casehead summary { cursor: pointer; color: var(--dsw-alias-label-tertiary, #777); font-size: 12px; }
.casehead pre { margin: 6px 0 0; padding: 8px 10px; overflow: auto; font-family: var(--ds-font-family-code, monospace); font-size: 11.5px; background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.04)); border-radius: 6px; max-height: 200px; }
.row { margin: 0 0 18px; }
.rowhead { display: flex; align-items: baseline; gap: 10px; }
.rowhead h3 { font-size: 12.5px; margin: 0 0 6px; color: var(--dsw-alias-label-secondary, #555); font-weight: 600; }
.badges { display: flex; gap: 6px; }
.badge { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; text-transform: lowercase; }
.badge.good { color: #1a7f37; }
.badge.bad { color: #c9252d; }
.badge.warn { color: #9a6700; }
.badge.info { color: var(--dsw-alias-label-tertiary, #777); }
/* The frame is the real container: same width as the sidebar / lightbox body,
   and it clips the way they do so an overflowing diagram is visible as clipped. */
.frame { border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.15)); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03)); overflow: hidden; }
.fit { margin: 4px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #777); font-variant-numeric: tabular-nums; }
.findings { margin: 6px 0 0; padding: 0 0 0 18px; font-size: 12px; }
.findings li { margin: 2px 0; }
.findings li.error .rule { color: #c9252d; }
.findings li.warn .rule { color: #9a6700; }
.findings li.info .rule { color: var(--dsw-alias-label-tertiary, #777); }
.findings .rule { font-family: var(--ds-font-family-code, monospace); font-size: 11px; }
.findings .coord { display: block; font-family: var(--ds-font-family-code, monospace); font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #777); }
.threw { margin: 4px 0 0; font-size: 12px; color: #c9252d; }
.degenerate { font-family: var(--ds-font-family-code, monospace); font-size: 11.5px; white-space: pre-wrap; padding: 10px; }
</style>
</head>
<body>
${sections.join('\n')}
<script>
// Follow ?dark=1 exactly the way the app follows its theme setting: by putting
// data-ds-dark-theme on <body>. Written as a tiny inline script (rather than a
// build-time choice) so the same file serves both themes.
(function () {
  var params = new URLSearchParams(location.search);
  var dark = params.get('dark') === '1';
  if (dark) document.body.setAttribute('data-ds-dark-theme', '');
  else document.body.removeAttribute('data-ds-dark-theme');
})();
</script>
</body>
</html>
`
}

/**
 * Format the findings as a text report.
 *
 * Findings are aggregated per (case, rule) first. A single broken layout rule
 * fires once per edge/text pair and produces dozens of near-identical lines; the
 * reader needs "this case breaks edge-covers-text in 14 places, worst at
 * (x,y)", not fourteen lines. `--verbose` prints every finding instead.
 *
 * @param {object[]} reports - every analysis.
 * @param {object} options - `{ quiet, verbose }`.
 * @returns {string} the report.
 */
function textReport(reports, options) {
  const lines = []
  let errors = 0
  let warnings = 0
  let clean = 0
  const byCase = new Map()

  for (const report of reports) {
    const caseId = report.caseName.split('@')[0]
    if (!byCase.has(caseId)) byCase.set(caseId, [])
    byCase.get(caseId).push(report)
    errors += report.findings.filter((finding) => finding.severity === 'error').length
    warnings += report.findings.filter((finding) => finding.severity === 'warn').length
    if (report.findings.length === 0) clean += 1
  }

  if (!options.quiet) {
    for (const [caseId, caseReports] of byCase) {
      const impacted = caseReports.filter((report) => report.findings.some((finding) => finding.severity === 'error'))
      if (impacted.length === 0) continue
      lines.push('')
      lines.push(`${caseId}${impacted.length === caseReports.length ? '' : `  (${impacted.map((report) => report.caseName.split('@')[1]).join(', ')} only)`}`)
      /** @type {Map<string, {severity: string, findings: object[]}>} */
      const grouped = new Map()
      for (const report of caseReports) {
        for (const finding of report.findings) {
          const key = `${report.caseName.split('@')[1]}/${finding.rule}`
          if (!grouped.has(key)) grouped.set(key, { severity: finding.severity, findings: [] })
          grouped.get(key).findings.push(finding)
        }
      }
      const ordered = [...grouped.entries()].sort((a, b) => {
        const weight = { error: 0, warn: 1, info: 2 }
        return (weight[a[1].severity] ?? 3) - (weight[b[1].severity] ?? 3) || b[1].findings.length - a[1].findings.length
      })
      for (const [key, group] of ordered) {
        const [width, rule] = key.split('/')
        const shown = options.verbose ? group.findings : group.findings.slice(0, 2)
        const more = group.findings.length > shown.length ? ` … and ${group.findings.length - shown.length} more` : ''
        lines.push(`  ${group.severity.padEnd(5)} ${rule.padEnd(28)} ×${String(group.findings.length).padEnd(4)} ${width === 'sidebar' ? '420px' : '900px'}${group.findings.length === 1 ? '' : ''}`)
        for (const finding of shown) {
          lines.push(`        ${finding.detail}`)
          if (finding.coordinates !== '—') lines.push(`        ${finding.coordinates}`)
        }
        if (more !== '') lines.push(`       ${more}`)
      }
    }
  }

  lines.push('')
  lines.push(`${reports.length} measurements across ${byCase.size} cases: ${clean} clean, ${errors} error(s), ${warnings} warning(s).`)
  return lines.join('\n')
}

/**
 * Build the preview.
 * @returns {number} the process exit code.
 */
function main() {
  const options = parseArgs(process.argv.slice(2))
  const clientPath = typeof options.client === 'string' ? resolve(repoRoot, options.client) : resolve(repoRoot, 'lib', 'client.js')
  const wikiPath = typeof options.wiki === 'string' ? resolve(options.wiki) : DEFAULT_WIKI
  const outPath = typeof options.out === 'string' ? resolve(options.out) : resolve(here, 'preview.html')

  let client
  try {
    client = loadClient(clientPath)
  } catch (error) {
    process.stderr.write(`could not load the client bundle at ${clientPath}\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    return 1
  }

  const corpus = buildCorpus(wikiPath)
  const real = corpus.filter((entry) => entry.real).length
  if (!options.quiet) {
    process.stdout.write(`corpus: ${corpus.length} diagrams (${real} from the Wiki, ${corpus.length - real} synthetic)\n`)
    process.stdout.write(`bundle: ${clientPath}\n`)
    process.stdout.write(`plugin stylesheet: ${client.css.length} bytes${client.appended.length > 0 ? ` (${client.appended.length} <style> element(s) injected at load)` : ''}\n`)
  }

  const theme = loadTheme()
  if (!options.quiet) {
    process.stdout.write(`theme tokens: ${theme.source === null ? 'fallback palette (theme package not found)' : theme.source}\n`)
  }

  const html = page({
    client,
    cases: corpus,
    theme,
    pluginCss: client.css,
    bundleCss: '',
    generatedAt: new Date().toISOString(),
    clientPath,
    wikiPath,
  })
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, html, 'utf8')

  // Measure every case at every width. This is a second pass deliberately: the
  // page embeds markup, but the *findings* come from the element tree, which is
  // the only place the numbers are exact.
  const reports = []
  const failures = []
  for (const entry of corpus) {
    for (const size of WIDTHS) {
      const render = renderCase(client, entry)
      if (render.svg === null) {
        failures.push({ caseName: `${entry.id}@${size.id}`, reason: render.error ?? 'no <svg> produced (fell back to the source view)' })
        continue
      }
      reports.push(analyzeSvg(render.svg, { width: size.width, caseName: `${entry.id}@${size.id}` }))
    }
  }

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify({ outPath, reports, failures }, null, 2)}\n`)
  } else {
    process.stdout.write(textReport(reports, { quiet: options.quiet === true, verbose: options.verbose === true }))
    if (failures.length > 0) {
      process.stdout.write('\n')
      for (const failure of failures) process.stdout.write(`no-svg ${failure.caseName}: ${failure.reason}\n`)
    }
    if (options.quiet !== true) process.stdout.write(`\nwrote ${outPath}\n`)
  }

  const errorCount = reports.reduce((total, report) => total + report.findings.filter((finding) => finding.severity === 'error').length, 0)
  if (options.strict === true && (errorCount > 0 || failures.length > 0)) return 2
  return 0
}

process.exitCode = main()
