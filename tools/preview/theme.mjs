/**
 * Theme tokens for the preview page.
 *
 * The real app takes its colours from `@deepseek-ai/dsh-client-ui-theme`, whose
 * bundle contains large CSS strings. This module lifts the same `body{--dsw-…}`
 * and `body[data-ds-dark-theme]{--dsw-…}` blocks out of that bundle so the
 * preview uses the *real* tokens rather than a hand-picked palette — if a token
 * is renamed upstream, the preview changes with the app instead of drifting.
 *
 * No CSS parser is involved: every block is located by selector and read with
 * brace matching, which is enough because the blocks in question contain no
 * nested rules.
 *
 * @module dsh-repo-wiki/tools/preview/theme
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Where the theme bundle keeps its stylesheet. */
const THEME_ENTRY = '@deepseek-ai/dsh-client-ui-theme/lib/client.js'

/**
 * Find the theme bundle on disk.
 *
 * A plain `require.resolve` from this file's directory is enough when the
 * plugin is installed next to its dependencies, which is how the repo runs.
 * @returns {string | null} the bundle path, or null when it is not installed.
 */
function resolveThemeBundle() {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve(THEME_ENTRY)
  } catch {
    // Fall back to the repository's own node_modules, which is where the
    // development checkout keeps it.
    const fallback = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'node_modules', THEME_ENTRY)
    return existsSync(fallback) ? fallback : null
  }
}

/**
 * Read one CSS rule block by its exact selector prefix.
 *
 * @param {string} css - the stylesheet text.
 * @param {string} selector - the selector, e.g. `body[data-ds-dark-theme]`.
 * @param {boolean} [exact] - match the selector followed directly by `{`.
 * @returns {string[]} every matching rule's full text.
 */
function findRules(css, selector, exact = false) {
  const out = []
  let index = 0
  while (index < css.length) {
    const at = css.indexOf(selector, index)
    if (at < 0) break
    const brace = at + selector.length
    // `body` must not match `body[data-ds-dark-theme]` when exact.
    if (css[brace] === '{' || (!exact && /^[\[\s{,]/.test(css[brace]))) {
      const open = css.indexOf('{', at)
      if (open >= 0 && (exact ? open === brace : true)) {
        let depth = 0
        let end = open
        for (; end < css.length; end += 1) {
          if (css[end] === '{') depth += 1
          else if (css[end] === '}') {
            depth -= 1
            if (depth === 0) {
              end += 1
              break
            }
          }
        }
        out.push(css.slice(at, end))
        index = end
        continue
      }
    }
    index = at + selector.length
  }
  return out
}

/**
 * The tokens that make the plugin's own stylesheet legible, with the values
 * from the theme bundle where available and a neutral fallback where not.
 *
 * A diagram only ever uses `--dsw-alias-*` colours plus the font stack. If the
 * theme package is missing, the fallbacks keep the preview usable rather than
 * rendering an invisible white-on-white SVG.
 *
 * @returns {{light: string, dark: string, source: string | null}} CSS for both themes.
 */
export function loadTheme() {
  const path = resolveThemeBundle()
  if (path === null) {
    return {
      source: null,
      light: ':root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#f1f2f5;--dsw-alias-border-l1:rgba(0,0,0,.12);--dsw-alias-border-l2:rgba(0,0,0,.2);--dsw-alias-border-l3:rgba(0,0,0,.3);--dsw-alias-label-primary:#1b1c1e;--dsw-alias-label-secondary:#5a5f66;--dsw-alias-label-tertiary:#7b8087;--dsw-alias-brand-primary:#3b6ef5;--dsw-font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
      dark: 'body[data-ds-dark-theme]{--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#1e1e21;--dsw-alias-bg-layer-2:#25252a;--dsw-alias-border-l1:rgba(255,255,255,.14);--dsw-alias-border-l2:rgba(255,255,255,.22);--dsw-alias-border-l3:rgba(255,255,255,.3);--dsw-alias-label-primary:#e8eaed;--dsw-alias-label-secondary:#a9aeb5;--dsw-alias-label-tertiary:#8b9097;--dsw-alias-brand-primary:#5a86ff}',
    }
  }

  const bundle = readFileSync(path, 'utf8')
  const light = findRules(bundle, 'body', true)
  const dark = findRules(bundle, 'body[data-ds-dark-theme]', true)

  // `body{…}` sets the tokens on the body element. The preview wants them on
  // `:root` as well, because SVG text inside the page inherits from html in
  // some of the fallback paths — binding them to both costs nothing.
  const hoisted = light.map((rule) => rule.replace(/^body(?=[\s{])/, ':root, body'))
  const darkHoisted = dark.map((rule) => rule)

  return {
    source: path,
    light: [...hoisted, ':root, body{color-scheme:light}'].join('\n'),
    dark: [...darkHoisted, 'body[data-ds-dark-theme]{color-scheme:dark}'].join('\n'),
  }
}
