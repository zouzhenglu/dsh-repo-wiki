/**
 * What a Wiki scan is allowed to read.
 *
 * ZCode's Wiki reads the workspace through a dedicated, narrower view than any
 * other feature, and states the exclusions explicitly: VCS metadata,
 * dependency trees, build output, caches and local runtime state; the root
 * `.gitignore`'s rules; files whose names suggest keys or credential
 * configuration; and files reached through symlinks. This module is that
 * policy as pure predicates, so every rule is unit-testable without a
 * filesystem and the reader in `workspace.js` stays a thin enforcement layer.
 *
 * One nuance carries most of the weight: a name-based secret rule must not
 * disqualify ordinary source code. ZCode says so directly — `tokenService.ts`
 * is a normal source file — so the token test only fires for a file that is
 * *not* written in a programming language. The rule is therefore
 * "a credential-ish name in a non-source file", never "the word token
 * anywhere".
 *
 * @module dsh-repo-wiki/wiki/policy
 */

/**
 * Directory names never entered, at any depth. Each entry is a fact about the
 * ecosystem that produced it rather than a guess: dependency trees, build and
 * distribution output, tool caches, and local editor/OS state.
 */
export const DEFAULT_EXCLUDED_DIRECTORIES = Object.freeze([
  // Version control and its local metadata.
  '.git',
  '.hg',
  '.svn',
  '.jj',
  // Dependency trees, one per ecosystem.
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'third_party',
  'Pods',
  'Carthage',
  '.venv',
  'venv',
  'virtualenv',
  'site-packages',
  '.tox',
  '.nox',
  '.conda',
  '.cargo',
  '.gradle',
  '.m2',
  '.nuget',
  'packages.lock.json.d',
  // Build, distribution and packaging output.
  'dist',
  'build',
  'out',
  'output',
  'target',
  'bin',
  'obj',
  'Debug',
  'Release',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.vercel',
  '.netlify',
  '.parcel-cache',
  '.turbo',
  '.vite',
  'coverage',
  '.nyc_output',
  'htmlcov',
  'cmake-build-debug',
  'cmake-build-release',
  // Caches and local runtime state.
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.cache',
  '.sass-cache',
  '.eslintcache',
  '.tsbuildinfo',
  'tmp',
  'temp',
  'logs',
  'log',
  '.local',
  '.dsh',
  '.zcode',
  '.idea',
  '.vs',
  '.vscode',
  '.history',
  '.ssh',
  '.gnupg',
])

/**
 * File suffixes whose bytes are never sent to a model. The list covers what a
 * repository actually contains rather than what could exist: compiled objects,
 * archives, media, fonts, documents, databases, and machine-readable
 * credential stores.
 */
export const DEFAULT_EXCLUDED_EXTENSIONS = Object.freeze([
  // Compiled artifacts and debug symbols.
  '.o',
  '.obj',
  '.a',
  '.lib',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.bin',
  '.elf',
  '.class',
  '.jar',
  '.pyc',
  '.pyo',
  '.wasm',
  '.pdb',
  '.map',
  // Archives and packaged output.
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.whl',
  '.nupkg',
  '.vsix',
  '.dmg',
  '.iso',
  '.deb',
  '.rpm',
  '.msi',
  '.appx',
  '.ipa',
  '.apk',
  '.aar',
  '.asar',
  // Images, audio, video and fonts.
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.icns',
  '.webp',
  '.avif',
  '.tiff',
  '.svgz',
  '.psd',
  '.ai',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  // Databases, indexes and binary documents.
  '.db',
  '.sqlite',
  '.sqlite3',
  '.mdb',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  // Credential stores and key material. These are excluded by suffix in
  // addition to the name rule below, because a `.pem` is never source.
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.ppk',
  '.asc',
  '.gpg',
  '.kdbx',
  '.ovpn',
])

/**
 * Extensions that identify a programming language. A credential-ish word in a
 * file with one of these extensions is an identifier inside source code, which
 * is exactly the `tokenService.ts` case ZCode carves out; anything else with
 * such a word is treated as suspected credential material.
 */
export const SOURCE_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi', '.rb', '.php', '.pl', '.pm', '.lua', '.r', '.jl',
  '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.groovy', '.clj',
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.m', '.mm',
  '.cs', '.fs', '.vb', '.swift', '.dart', '.zig', '.nim', '.v', '.sv', '.vhd',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.cmd', '.bat',
  '.sql', '.graphql', '.gql', '.proto', '.thrift',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl', '.vue', '.svelte', '.astro',
  '.ex', '.exs', '.erl', '.hrl', '.ml', '.mli', '.hs', '.elm', '.purs',
  '.tf', '.hcl', '.bicep', '.nix', '.dockerfile',
])

/**
 * Filenames and suffixes that are credential material by convention, matched
 * case-insensitively against a basename. These are excluded even when the
 * extension looks like source, because `.npmrc` carries a token and `id_rsa`
 * carries a key.
 */
export const SECRET_FILE_PATTERNS = Object.freeze([
  /^\.env(?:\..*)?$/i,
  /^\.envrc$/i,
  /^\.npmrc$/i,
  /^\.yarnrc(?:\.yml)?$/i,
  /^\.netrc$/i,
  /^_netrc$/i,
  /^\.htpasswd$/i,
  /^\.pgpass$/i,
  /^\.my\.cnf$/i,
  /^\.git-credentials$/i,
  /^\.pypirc$/i,
  /^\.dockercfg$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^known_hosts$/i,
  /^authorized_keys$/i,
  /^credentials?(?:\..*)?$/i,
  /^secrets?(?:\..*)?$/i,
  /^master\.key$/i,
  /^\.terraformrc$/i,
  /^terraform\.tfstate(?:\..*)?$/i,
  /^\.s3cfg$/i,
  /^\.aws$/i,
  /^shadow$/i,
  /^passwd$/i,
])

/**
 * Words that, in a filename, suggest credential material rather than a
 * subject. Matched case-insensitively as substrings of the basename.
 */
export const SECRET_NAME_TOKENS = Object.freeze([
  'token',
  'secret',
  'credential',
  'password',
  'passwd',
  'api-key',
  'api_key',
  'apikey',
  'private-key',
  'private_key',
  'privatekey',
  'access-key',
  'access_key',
  'accesskey',
  'auth-key',
  'authkey',
  'client-secret',
  'client_secret',
])

/**
 * Basenames that are OS or editor state rather than project content. They are
 * matched exactly and never carry architecture information.
 */
export const DEFAULT_EXCLUDED_FILES = Object.freeze([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.gitignore.swp',
])

/** Maximum file size a Wiki scan will read into a model context, in bytes. */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024

/** Maximum number of files one scan will enumerate before reporting truncation. */
export const DEFAULT_MAX_FILES = 20000

/**
 * Normalize a name for comparison: lower case, with a leading dot preserved so
 * `.env` and `env` stay distinct.
 * @param name - a basename.
 * @returns the comparison form.
 */
export function normalizeName(name) {
  return name.toLowerCase()
}

/**
 * Extract a lowercase extension including its dot, treating a leading-dot
 * basename as a dotfile with no extension (`.env` → `''`, `a.ts` → `'.ts'`).
 * @param basename - the file's name.
 * @returns the extension, or an empty string.
 */
export function extensionOf(basename) {
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return ''
  return basename.slice(dot).toLowerCase()
}

/**
 * Decide whether a basename is programming source.
 * @param basename - the file's name.
 * @param extraExtensions - deployment-added source extensions.
 * @returns whether the file is source code.
 */
export function isSourceFile(basename, extraExtensions = []) {
  const extension = extensionOf(basename)
  if (extension === '') return false
  return SOURCE_EXTENSIONS.includes(extension) || extraExtensions.includes(extension)
}

/**
 * Classify why a file must not be read, if it must not be.
 *
 * The order matters: convention-based credential names are checked before the
 * extension rules so the reported reason names the strongest evidence, and the
 * source-code carve-out is applied last so a name like `tokenService.ts`
 * survives every earlier test.
 *
 * @param basename - the file's name.
 * @param options - deployment additions.
 * @param options.excludedExtensions - extra suffixes to exclude.
 * @param options.excludedFiles - extra basenames to exclude.
 * @param options.sourceExtensions - extra extensions to count as source.
 * @returns `null` when the file is readable, otherwise `{ reason, detail }`.
 */
export function classifyFile(basename, options = {}) {
  const {
    excludedExtensions = [],
    excludedFiles = [],
    sourceExtensions = [],
  } = options

  if (DEFAULT_EXCLUDED_FILES.includes(basename) || excludedFiles.includes(basename)) {
    return { reason: 'local-state', detail: 'operating-system or editor state file' }
  }

  const lower = normalizeName(basename)

  // A name that is credential material by convention is refused outright: the
  // source-code carve-out below exists for *words inside* source, not for a
  // file whose whole name is the credential. `.env.ts` is still a dotenv.
  for (const pattern of SECRET_FILE_PATTERNS) {
    if (pattern.test(lower)) {
      return { reason: 'secret-name', detail: `matches credential convention ${String(pattern)}` }
    }
  }

  const extension = extensionOf(basename)
  const allExcludedExtensions = [...DEFAULT_EXCLUDED_EXTENSIONS, ...excludedExtensions]
  for (const candidate of allExcludedExtensions) {
    if (extension === candidate) {
      const credentialish = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk', '.kdbx'].includes(extension)
      return {
        reason: credentialish ? 'secret-extension' : 'binary-extension',
        detail: `suffix ${candidate}`,
      }
    }
  }

  // A credential-ish word only disqualifies a file that is not source code.
  const token = SECRET_NAME_TOKENS.find((candidate) => lower.includes(candidate))
  if (token !== undefined && !isSourceFile(basename, sourceExtensions)) {
    return { reason: 'secret-name', detail: `filename contains ${JSON.stringify(token)} and is not source code` }
  }

  return null
}

/**
 * Decide whether a directory must not be entered.
 * @param basename - the directory's name.
 * @param options - deployment additions.
 * @param options.excludedDirectories - extra directory names to exclude.
 * @returns `null` when the directory is readable, otherwise `{ reason, detail }`.
 */
export function classifyDirectory(basename, options = {}) {
  const { excludedDirectories = [] } = options
  if (DEFAULT_EXCLUDED_DIRECTORIES.includes(basename) || excludedDirectories.includes(basename)) {
    return { reason: 'excluded-directory', detail: `directory name ${JSON.stringify(basename)}` }
  }
  return null
}
