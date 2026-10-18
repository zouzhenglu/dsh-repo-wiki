/**
 * A gitignore matcher, restricted to the rule scope a Wiki scan needs.
 *
 * The Wiki scan must never hand the model a file that the repository already
 * declares as excluded, so this module implements the real `.gitignore`
 * grammar rather than a substring filter: comments, blank lines, `!`
 * re-inclusion, trailing `/` directory-only rules, leading or embedded `/`
 * anchoring, and the `*`, `?`, `[...]` and `**` wildcards. Rules are evaluated
 * in order and the LAST matching rule decides, which is what makes a trailing
 * `!keep.ts` work.
 *
 * Precedence follows git in two ways that a naive implementation gets wrong:
 *
 * - **Deeper files win.** A nested `.gitignore` states its patterns relative to
 *   its own directory, and its decisions override the root's. {@link
 *   createIgnoreResolver} therefore merges every matcher into one ordered rule
 *   stream (shallowest file first) instead of stopping at the first file that
 *   has an opinion.
 * - **An excluded directory cannot be re-included.** Git states plainly that
 *   re-including a file is impossible when a parent directory is excluded, so
 *   ancestor exclusion is a hard OR and takes no part in last-match-wins.
 *
 * Two deliberate departures from git, both documented because a reader will
 * otherwise expect them:
 *
 * - Only `.gitignore` files are read. `.git/info/exclude` and the global
 *   `core.excludesFile` are outside a workspace scan's authority: the first
 *   lives in a directory the scan never enters, and the second is machine
 *   state the repository does not carry.
 * - `.gitignore` files are read as UTF-8 with an optional BOM. Git treats a
 *   non-UTF8 ignore file's bytes as bytes; a scan of arbitrary repositories
 *   would rather decode than fail, so invalid sequences become U+FFFD and can
 *   only ever make a rule match less.
 *
 * @module dsh-repo-wiki/wiki/gitignore
 */

/** A leading byte-order mark, removed before a document is parsed. */
const BOM = '\uFEFF'

/** Regex-escape every character that is special outside a character class. */
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\/]/g

/**
 * Strip trailing whitespace from one pattern line the way git does: trailing
 * spaces are ignored unless they are backslash-escaped, in which case the
 * escape survives and the whitespace is significant.
 * @param line - the raw line, without its terminator.
 * @returns the line with git's trailing-whitespace rule applied.
 */
function stripTrailingSpace(line) {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) {
    // Count the backslashes immediately before this whitespace character: an
    // odd count means the whitespace is escaped and therefore significant.
    let backslashes = 0
    let cursor = end - 2
    while (cursor >= 0 && line[cursor] === '\\') {
      backslashes += 1
      cursor -= 1
    }
    if (backslashes % 2 === 1) break
    end -= 1
  }
  return line.slice(0, end)
}

/**
 * Translate one glob pattern body into a regular-expression source string.
 *
 * `**` is context sensitive, so it is resolved before the single-character
 * wildcards: a leading or medial `**&#47;` matches zero or more directories, a
 * trailing `/**` matches everything below the prefix, and a bare `**` matches
 * anything including separators.
 * @param glob - the pattern body, already stripped of `!`, anchor and trailing slash.
 * @returns a RegExp source fragment, without anchors.
 */
export function globToRegExpSource(glob) {
  let source = ''
  let index = 0
  while (index < glob.length) {
    const char = glob[index]
    if (char === '*') {
      let end = index
      while (glob[end] === '*') end += 1
      const starCount = end - index
      const atSegmentStart = index === 0 || glob[index - 1] === '/'
      const atSegmentEnd = end === glob.length || glob[end] === '/'
      if (starCount >= 2 && atSegmentStart && (glob[end] === '/')) {
        // `**/` — zero or more whole directories.
        source += '(?:[^/]+/)*'
        index = end + 1
        continue
      }
      if (starCount >= 2 && atSegmentStart && atSegmentEnd) {
        // A bare or trailing `**` — anything, separators included.
        source += '.*'
        index = end
        continue
      }
      if (starCount >= 2) {
        // `a**b` is not a globstar in git; both stars behave as `*`.
        source += '[^/]*'
        index = end
        continue
      }
      source += '[^/]*'
      index += 1
      continue
    }
    if (char === '?') {
      source += '[^/]'
      index += 1
      continue
    }
    if (char === '[') {
      // Find the class terminator, honouring a leading `!`/`^` negation and a
      // `]` that is the class's first member.
      let cursor = index + 1
      let negated = false
      if (glob[cursor] === '!' || glob[cursor] === '^') {
        negated = true
        cursor += 1
      }
      if (glob[cursor] === ']') cursor += 1
      while (cursor < glob.length && glob[cursor] !== ']') cursor += 1
      if (cursor >= glob.length) {
        // An unterminated class: git treats the `[` as a literal.
        source += '\\['
        index += 1
        continue
      }
      const start = index + 1 + (negated ? 1 : 0)
      const body = glob.slice(start, cursor)
      // Escape the characters that are unsafe inside a JS character class.
      const escaped = body.replace(/[\\\]^]/g, (match) => `\\${match}`)
      source += `[${negated ? '^' : ''}${escaped}]`
      index = cursor + 1
      continue
    }
    if (char === '\\' && index + 1 < glob.length) {
      source += glob[index + 1].replace(REGEXP_SPECIALS, (match) => `\\${match}`)
      index += 2
      continue
    }
    source += char.replace(REGEXP_SPECIALS, (match) => `\\${match}`)
    index += 1
  }
  return source
}

/**
 * One compiled `.gitignore` rule.
 * @typedef {object} GitignoreRule
 * @property {string} source - the rule as written, for diagnostics.
 * @property {boolean} negated - whether a match re-includes the path.
 * @property {boolean} directoryOnly - whether the rule needs a directory.
 * @property {RegExp} regex - the compiled matcher over a `/`-separated relative path.
 */

/**
 * Compile one line into a rule.
 * @param line - one raw line of a `.gitignore` file.
 * @returns the compiled rule, or null for a blank line, a comment, or `!` alone.
 */
export function compileRule(line) {
  const trimmed = stripTrailingSpace(line)
  if (trimmed.length === 0) return null
  if (trimmed.startsWith('#')) return null

  let pattern = trimmed
  let negated = false
  if (pattern.startsWith('!')) {
    negated = true
    pattern = pattern.slice(1)
  } else if (pattern.startsWith('\\!') || pattern.startsWith('\\#')) {
    // An escaped leading `!`/`#` is a literal character.
    pattern = pattern.slice(1)
  }
  if (pattern.length === 0) return null

  let directoryOnly = false
  if (pattern.endsWith('/')) {
    directoryOnly = true
    pattern = pattern.slice(0, -1)
  }
  if (pattern.length === 0) return null

  // A pattern is anchored when it starts with a slash or contains an inner one;
  // an unanchored pattern matches a whole path segment at any depth.
  const anchored = pattern.startsWith('/') || pattern.includes('/')
  const body = pattern.startsWith('/') ? pattern.slice(1) : pattern
  const prefix = anchored ? '' : '(?:[^/]+/)*'
  return {
    source: trimmed,
    negated,
    directoryOnly,
    regex: new RegExp(`^${prefix}${globToRegExpSource(body)}$`),
  }
}

/**
 * Parse a `.gitignore` document into rules, dropping comments and blanks.
 * @param text - the file's decoded contents.
 * @returns the compiled rules in file order.
 */
export function parseGitignore(text) {
  const rules = []
  const normalized = text.startsWith(BOM) ? text.slice(BOM.length) : text
  for (const line of normalized.split(/\r\n|\n|\r/)) {
    const rule = compileRule(line)
    if (rule !== null) rules.push(rule)
  }
  return rules
}

/**
 * One `.gitignore` file's rules together with the directory that owns them.
 */
export class GitignoreLayer {
  /**
   * @param rules - compiled rules, in the order they must be evaluated.
   * @param base - workspace-relative directory holding the file, `''` for the root.
   */
  constructor(rules, base = '') {
    /** @type {GitignoreRule[]} */
    this.rules = rules
    /** @type {string} */
    this.base = base
    /** @type {number} nest depth, used to order layers from shallowest to deepest. */
    this.depth = base === '' ? 0 : base.split('/').length
  }

  /** @returns {boolean} whether this layer contributes any rule. */
  get isEmpty() {
    return this.rules.length === 0
  }

  /**
   * Re-express one workspace-relative path relative to this layer, so a nested
   * file's patterns are matched against the paths it actually describes.
   * @param relativePath - `/`-separated path relative to the workspace root.
   * @returns the layer-relative path, or null when the path is outside this layer.
   */
  scope(relativePath) {
    if (this.base === '') return relativePath
    const prefix = `${this.base}/`
    return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : null
  }

  /**
   * Apply this layer's rules to exactly one path, updating a running decision.
   * @param relativePath - `/`-separated path relative to the workspace root.
   * @param isDirectory - whether the path names a directory.
   * @param decision - the running last-match decision, or null when nothing matched yet.
   * @returns the updated decision.
   */
  apply(relativePath, isDirectory, decision) {
    const scoped = this.scope(relativePath)
    if (scoped === null || scoped.length === 0) return decision
    let next = decision
    for (const rule of this.rules) {
      if (rule.directoryOnly && !isDirectory) continue
      if (rule.regex.test(scoped)) next = !rule.negated
    }
    return next
  }
}

/**
 * Merge every `.gitignore` layer in scope into one decision function.
 *
 * Layers are ordered shallowest first, so a deeper file's later rules land
 * later in the stream and win — git's documented precedence. The returned
 * function is the scanner's single ignore authority.
 *
 * @param layers - the layers collected for this workspace, in any order.
 * @returns a predicate `(relativePath, isDirectory) => boolean` answering
 * whether the path is excluded.
 */
export function createIgnoreResolver(layers) {
  const ordered = [...layers]
    .filter((layer) => !layer.isEmpty)
    .sort((left, right) => left.depth - right.depth)

  /**
   * Last-match-wins over one path alone, with no ancestor inheritance.
   * @param relativePath - `/`-separated path relative to the workspace root.
   * @param isDirectory - whether the path names a directory.
   * @returns true, false, or null when no rule matched.
   */
  const decide = (relativePath, isDirectory) => {
    let decision = null
    for (const layer of ordered) decision = layer.apply(relativePath, isDirectory, decision)
    return decision
  }

  return (relativePath, isDirectory) => {
    // An excluded directory cannot be re-included, so ancestor exclusion is a
    // hard OR that no deeper negation can lift.
    const segments = relativePath.split('/')
    for (let end = 1; end < segments.length; end += 1) {
      if (decide(segments.slice(0, end).join('/'), true) === true) return true
    }
    return decide(relativePath, isDirectory) === true
  }
}
