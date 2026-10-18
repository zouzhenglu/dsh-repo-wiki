/**
 * Verify that this plugin is correctly installed into a DSH profile.
 *
 * The parts of an installation that can silently go wrong are all checkable
 * without booting the application, so this script checks them directly and
 * reports a single pass/fail with the evidence for each step:
 *
 * 1. **The profile resolves the package by name** — the loader looks a bundle up
 *    from the profile directory, so a package that resolves from this workspace
 *    but not from the profile would load for a test and not for the product.
 * 2. **The module exposes the loader's contract** — `name`, `inject`, `Config`,
 *    `apply`.
 * 3. **The composed config validates** — the composed row is read back out of
 *    `dsh --profile <name> --dump-config` and passed through the plugin's own
 *    schema, which is exactly what the loader does before `apply`. A schema
 *    mismatch here is the failure that looks like "the plugin silently never
 *    loads", so it is worth an explicit check.
 * 4. **The client half is discoverable** — `dsh.client`, the `./client` export,
 *    and the file it points at, which is what the modules node half scans.
 * 5. **The bundle declaration is present** — `dsh.bundle.patch` and the patch
 *    file it names.
 *
 * Usage: `node scripts/verify-install.mjs [profileName]` (default `web`).
 * Exit code 0 means every step passed.
 *
 * @module dsh-repo-wiki/scripts/verify-install
 */

import { access, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

const profileName = process.argv[2] ?? 'web'
// A profile name is an identifier, not a command fragment. It is interpolated
// into a shell command on Windows (see the `dsh --dump-config` step), so accept
// only the characters DSH itself accepts in a profile name and refuse anything
// else before it can reach a shell.
if (!/^[A-Za-z0-9._-]+$/.test(profileName)) {
  console.error(`invalid profile name ${JSON.stringify(profileName)}: expected letters, digits, '.', '_' or '-'`)
  process.exit(1)
}
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)

/** @type {{ name: string, ok: boolean, detail: string }[]} */
const steps = []
/**
 * Record one check.
 * @param name - the step's name.
 * @param ok - whether it passed.
 * @param detail - the evidence.
 */
function record(name, ok, detail) {
  steps.push({ name, ok, detail })
}

// 1. The profile resolves the package by name.
let profileResolved = null
try {
  const requireFromProfile = createRequire(join(profileDir, 'package.json'))
  profileResolved = requireFromProfile.resolve(packageManifest.name)
  record('profile resolves the package by name', true, profileResolved)
} catch (error) {
  record('profile resolves the package by name', false, error.message)
}

// 2. The module exposes the loader's contract.
let plugin = null
const entry = profileResolved === null
  ? pathToFileURL(join(packageRoot, 'lib/index.js')).href
  : pathToFileURL(profileResolved).href
try {
  plugin = await import(entry)
  const problems = []
  if (typeof plugin.name !== 'string') problems.push('name must be a string')
  if (!Array.isArray(plugin.inject)) problems.push('inject must be an array')
  if (typeof plugin.apply !== 'function') problems.push('apply must be a function')
  if (plugin.Config === undefined) problems.push('Config must be a schema')
  record(
    'module exposes the cordis plugin contract',
    problems.length === 0,
    problems.length === 0
      ? `name=${plugin.name} inject=[${plugin.inject.join(', ')}] Config=yes apply=yes`
      : problems.join('; '),
  )
} catch (error) {
  record('module exposes the cordis plugin contract', false, error.message)
}

/**
 * Read one YAML scalar the way the loader's parser would.
 *
 * The dump is YAML, so `180000` is a number and `true` is a boolean. Reading
 * them as strings would make this check report a schema violation that the real
 * loader never sees — a false alarm is worse than no check, so the scalars are
 * coerced here.
 * @param raw - the scalar text.
 * @returns the coerced value.
 */
function coerceScalar(raw) {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === '[]') return []
  if (text === '{}') return {}
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10)
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text)
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1)
  }
  return text
}

// 3. The composed row validates against the plugin's own schema.
let composedConfig = null
const dumpResult = spawnSync('dsh', ['--profile', profileName, '--dump-config'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  windowsHide: true,
  cwd: packageRoot,
})
if (dumpResult.status !== 0) {
  record('composed config validates against the plugin schema', false, `--dump-config exited ${dumpResult.status}: ${(dumpResult.stderr ?? '').slice(0, 400)}`)
} else {
  const lines = (dumpResult.stdout ?? '').split(/\r?\n/)
  const marker = lines.findIndex((line) => line.trim() === `# == ${packageManifest.name}`)
  if (marker === -1) {
    record('composed config validates against the plugin schema', false, `no "== ${packageManifest.name}" section; is the package in dsh.profile.bundles?`)
  } else {
    // The composed YAML writes one flat `key: value` block per row; the row's own
    // keys are those indented under `config:`.
    const block = []
    let inside = false
    for (const line of lines.slice(marker + 1)) {
      if (line.startsWith('# == ')) break
      if (/^ {2}config:\s*$/.test(line)) {
        inside = true
        continue
      }
      if (!inside) continue
      const match = /^ {4}([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line)
      if (match === null) {
        if (line.trim() !== '' && !line.startsWith('    ')) break
        continue
      }
      block.push([match[1], coerceScalar(match[2])])
    }
    composedConfig = Object.fromEntries(block)
    try {
      const validated = plugin.Config(composedConfig)
      record(
        'composed config validates against the plugin schema',
        true,
        `keys=${Object.keys(composedConfig).join(', ') || '(none)'} → ${Object.keys(validated).join(', ')}`,
      )
    } catch (error) {
      record('composed config validates against the plugin schema', false, `Config rejected the composed row: ${error.message}`)
    }
  }
}

// 4. The client half is discoverable.
const client = packageManifest.dsh?.client
if (client === undefined) {
  record('client half is declared and present', false, 'package.json has no dsh.client block')
} else {
  const clientPath = join(packageRoot, 'lib/client.js')
  let exists = true
  try {
    await access(clientPath)
  } catch {
    exists = false
  }
  const problems = []
  if (client.platform !== 'web') problems.push(`platform must be "web", got ${JSON.stringify(client.platform)}`)
  if (packageManifest.exports?.['./client'] === undefined) problems.push('exports["./client"] is missing')
  if (!exists) problems.push('lib/client.js is missing')
  record(
    'client half is declared and present',
    problems.length === 0,
    problems.length === 0
      ? `platform=${client.platform} inject=[${(client.inject ?? []).join(', ')}] → lib/client.js`
      : problems.join('; '),
  )
}

// 5. The bundle declaration is present.
const patch = packageManifest.dsh?.bundle?.patch
if (patch === undefined) {
  record('bundle patch is declared and present', false, 'package.json has no dsh.bundle.patch')
} else {
  const patchPath = join(packageRoot, patch)
  let present = true
  let contents = ''
  try {
    contents = await readFile(patchPath, 'utf8')
  } catch {
    present = false
  }
  const inserts = present && contents.includes(`name: ${packageManifest.name}`)
  record(
    'bundle patch is declared and present',
    present && inserts,
    present
      ? inserts
        ? `${patch} inserts a row named ${packageManifest.name}`
        : `${patch} does not insert a row named ${packageManifest.name}`
      : `${patch} is missing`,
  )
}

// Report.
console.log(`dsh-repo-wiki install verification for profile "${profileName}"`)
console.log(`  profile: ${profileDir}`)
console.log(`  package: ${packageRoot}`)
console.log('')
let failed = 0
for (const step of steps) {
  const mark = step.ok ? 'PASS' : 'FAIL'
  if (!step.ok) failed += 1
  console.log(`  [${mark}] ${step.name}`)
  console.log(`         ${step.detail}`)
}
console.log('')
if (composedConfig !== null) console.log(`  composed row: ${JSON.stringify(composedConfig)}`)
console.log('')
console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
