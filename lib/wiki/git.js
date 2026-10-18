/**
 * Read the VCS state a Wiki describes, straight from the repository's files.
 *
 * A Wiki's metadata says which code state its pages describe, and a branch and
 * commit are what make that answer checkable: a reader who sees `main @ 1a2b3c4`
 * can compare it with what is checked out now instead of guessing whether the
 * guide has drifted.
 *
 * The state is read from `.git` rather than by shelling out to `git`, for three
 * reasons that all matter on the hosts this plugin runs on:
 *
 * - It works without `git` on PATH, which a Windows deployment may not have.
 * - It never spawns a process, so it cannot hang, inherit the session's
 *   environment, or be affected by a repository that defines aliases or hooks.
 * - It is a pure function of an injected filesystem, so the whole reader —
 *   including the worktree and packed-refs cases — is testable without a real
 *   repository.
 *
 * Everything here is best-effort. A workspace that is not a repository, a
 * repository with an unreadable `.git`, or a detached HEAD in a state this
 * reader does not recognise yields `null` for what could not be established
 * rather than an error: metadata is a courtesy, and it must never be able to
 * fail a generation.
 *
 * @module dsh-repo-wiki/wiki/git
 */

/**
 * Resolve a checked-out ref to the commit it points at.
 *
 * Three layouts, in the order git itself would consult them: a loose ref file,
 * then the packed-refs table (which is where a freshly cloned repository keeps
 * most of its refs), and finally nothing.
 *
 * @param gitDir - the `.git` directory (or a worktree's gitdir).
 * @param ref - the fully-qualified ref, e.g. `refs/heads/main`.
 * @param fs - the filesystem adapter.
 * @param join - the path joiner.
 * @returns the 40-hex commit, or null.
 */
async function resolveRef(gitDir, ref, fs, join) {
  const loose = await readTrimmed(join(gitDir, ref.replace(/\//g, '/')), fs)
  if (loose !== null && isCommit(loose)) return loose

  const packed = await readTrimmed(join(gitDir, 'packed-refs'), fs)
  if (packed !== null) {
    for (const line of packed.split(/\r?\n/)) {
      // A packed line is either "<sha> <ref>" or, for a peeled annotated tag,
      // "^<sha>" on the following line — which is not a ref name and is skipped
      // by the same test.
      if (line.startsWith('#') || line.startsWith('^')) continue
      const space = line.indexOf(' ')
      if (space === -1) continue
      const sha = line.slice(0, space).trim()
      if (line.slice(space + 1).trim() === ref && isCommit(sha)) return sha
    }
  }
  return null
}

/**
 * Read a file and return its trimmed text, or null when it is unreadable.
 * @param path - the absolute path.
 * @param fs - the filesystem adapter.
 * @returns the text, or null.
 */
async function readTrimmed(path, fs) {
  try {
    const value = await fs.readFile(path, 'utf8')
    return typeof value === 'string' ? value.trim() : null
  } catch {
    return null
  }
}

/**
 * Whether a string looks like a git object id.
 * @param value - the candidate.
 * @returns true for a 40- or 64-hex id.
 */
function isCommit(value) {
  return /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(value)
}

/**
 * Find the `.git` directory governing a workspace, walking up from its root.
 *
 * A repository may live above the workspace (a monorepo opened at a package
 * subdirectory), so the walk continues until it finds a `.git` entry or runs out
 * of parents. It stops at a filesystem root and never follows `..` past it.
 *
 * Both repository layouts are handled: a directory (a normal clone) and a file
 * (a linked worktree, whose contents are a single `gitdir: …` line).
 *
 * @param root - the workspace root.
 * @param fs - the filesystem adapter.
 * @param join - the path joiner.
 * @param [isAbsolute] - whether a path is absolute; defaults to a
 *   drive-letter/UNC/slash test, which covers both POSIX and Windows forms.
 * @returns the git directory, or null when the workspace is not a repository.
 */
async function findGitDir(root, fs, join, isAbsolute = (value) => /^([A-Za-z]:)?[\\/]|^\\\\/.test(value)) {
  let current = String(root).replace(/[\\/]+$/, '')
  // A bounded walk: a path cannot have more parents than it has separators.
  for (let depth = 0; depth < 64; depth += 1) {
    const candidate = join(current, '.git')
    try {
      const stat = await fs.lstat(candidate)
      if (typeof stat?.isDirectory === 'function' && stat.isDirectory()) return candidate
      if (typeof stat?.isFile === 'function' && stat.isFile()) {
        const text = await readTrimmed(candidate, fs)
        const match = text === null ? null : /^gitdir:\s*(.+)$/.exec(text)
        if (match !== null) {
          const target = match[1].trim()
          // A linked worktree's gitdir is usually absolute; a relative one is
          // resolved against the directory holding the `.git` file.
          return isAbsolute(target) ? target : join(current, target)
        }
      }
    } catch {
      // No `.git` here; walk up.
    }
    const parent = parentOf(current)
    if (parent === null || parent === current) return null
    current = parent
  }
  return null
}

/**
 * The parent directory of a path, in a form that works on both separators.
 * @param path - the path.
 * @returns the parent, or null at a filesystem root.
 */
function parentOf(path) {
  const unified = String(path).replace(/\\/g, '/').replace(/\/+$/, '')
  if (unified === '') return null
  // `C:/` and `//server/share` are roots; stripping a further segment from them
  // would be wrong.
  const drive = /^[A-Za-z]:\/?$/.test(unified)
  if (drive) return null
  const slash = unified.lastIndexOf('/')
  if (slash === -1) return null
  const parent = unified.slice(0, slash)
  return parent === '' ? '/' : parent
}

/**
 * Read the branch and commit a workspace is checked out at.
 *
 * A repository in the middle of an operation — an unborn branch after `git
 * init`, a rebase in progress — has no meaningful answer, and reports `null`
 * rather than a placeholder that would look authoritative.
 *
 * @param root - the workspace root.
 * @param options - the filesystem to read through.
 * @param options.fs - an adapter with `readFile` and `lstat`.
 * @param options.join - `(directory, segment) => path`.
 * @returns `{ branch, commit }`, each null when unknown.
 */
export async function readGitState(root, options) {
  const empty = { branch: null, commit: null }
  if (root === undefined || root === null || root === '') return empty
  const fs = options?.fs
  const join = options?.join
  if (fs === undefined || fs === null || typeof fs.readFile !== 'function') return empty
  if (typeof join !== 'function') return empty

  try {
    const gitDir = await findGitDir(root, fs, join)
    if (gitDir === null) return empty

    const head = await readTrimmed(join(gitDir, 'HEAD'), fs)
    if (head === null || head === '') return empty

    // A symbolic HEAD names the checked-out branch: `ref: refs/heads/main`.
    const symbolic = /^ref:\s*(.+)$/.exec(head)
    if (symbolic !== null) {
      const ref = symbolic[1].trim()
      const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
      return { branch: branch === '' ? null : branch, commit: await resolveRef(gitDir, ref, fs, join) }
    }
    // A detached HEAD holds the commit directly.
    if (isCommit(head)) return { branch: null, commit: head }
    return empty
  } catch {
    // Whatever went wrong, the answer is "unknown" — never a failed generation.
    return empty
  }
}

/**
 * Format a commit for display.
 *
 * A reader compares this against `git rev-parse --short HEAD`, so the short form
 * git itself would print is the useful one.
 * @param commit - the full commit, or null.
 * @param [length] - how many hex digits to keep; defaults to 7, git's own.
 * @returns the abbreviated commit, or null.
 */
export function shortCommit(commit, length = 7) {
  if (typeof commit !== 'string' || commit === '') return null
  return commit.slice(0, Math.max(1, length))
}
