/**
 * The workspace reading view: containment, refusals, caching and bounds.
 *
 * These tests exercise the reader against the sample repository in
 * `helpers.mjs`, which deliberately contains a dependency tree, build output, a
 * gitignored log, a dotenv, a credential file, a symlink, and — the case worth
 * noticing — `config/tokenService.js`, ordinary source whose name contains a
 * credential word. If the policy were a substring filter, that last file would
 * be refused and the first ones might not be.
 *
 * @module dsh-repo-wiki/test/workspace
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { SAMPLE_TREE, virtualReader } from './helpers.mjs'

test('a listing separates readable entries from refused ones with reasons', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  const listing = await reader.list('')
  const byName = new Map(listing.entries.map((entry) => [entry.name, entry]))

  assert.equal(byName.get('src').excluded, false)
  assert.equal(byName.get('src').type, 'directory')
  assert.equal(byName.get('package.json').excluded, false)
  assert.equal(byName.get('README.md').excluded, false)

  assert.equal(byName.get('node_modules').excluded.reason, 'excluded-directory')
  assert.equal(byName.get('build').excluded.reason, 'excluded-directory')
  assert.equal(byName.get('.env').excluded.reason, 'secret-name')
  assert.equal(byName.get('link-to-src').type, 'symlink')
  assert.equal(byName.get('link-to-src').excluded.reason, 'symlink')

  // `.gitignore` itself is a scan input, not content to hand a model.
  assert.equal(byName.has('.gitignore'), false)
})

test('a gitignored file is listed with its reason rather than silently vanishing', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  const listing = await reader.list('src/util')
  const log = listing.entries.find((entry) => entry.name === 'strings.log')
  assert.notEqual(log, undefined)
  assert.equal(log.excluded.reason, 'gitignored')
})

test('an ordinary source file whose name contains a credential word is readable', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  const result = await reader.read('config/tokenService.js')
  assert.match(result.text, /tokenService/)
  assert.equal(reader.readPaths.has('config/tokenService.js'), true)
})

test('secret, dependency, build and gitignored paths are refused on read', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  const cases = [
    ['.env', 'secret-name'],
    ['config/credentials.json', 'secret-name'],
    ['node_modules/dep/index.js', 'excluded-directory'],
    ['build/out.js', 'excluded-directory'],
    ['src/util/strings.log', 'excluded'],
  ]
  for (const [path, code] of cases) {
    await assert.rejects(
      () => reader.read(path),
      (error) => {
        assert.equal(error.code, code, `${path} should fail with ${code}, got ${error.code}`)
        return true
      },
      `${path} must be refused`,
    )
  }
})

test('refusals explain themselves to a model', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  await assert.rejects(
    () => reader.read('.env'),
    (error) => {
      assert.match(error.message, /not in the Wiki reading view/)
      assert.match(error.message, /credential/)
      return true
    },
  )
})

test('the reader refuses to leave the workspace', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  for (const path of ['../outside.txt', 'src/../../escape.ts', '/etc/passwd', 'C:/Windows/win.ini', '//server/share']) {
    await assert.rejects(
      () => reader.read(path),
      (error) => {
        assert.equal(error.code, 'invalid-path', `${path} should be an invalid path`)
        return true
      },
      `${path} must be refused`,
    )
  }
  await assert.rejects(() => reader.list('../..'), (error) => error.code === 'invalid-path')
})

test('a symlink is never followed', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  await assert.rejects(() => reader.read('link-to-src'), (error) => error.code === 'symlink')
  await assert.rejects(
    () => reader.list('link-to-src'),
    (error) => error.code === 'symlink',
    'a symlinked directory must not be entered',
  )
})

test('a read aimed at an excluded directory names the exclusion, not "not a file"', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  await assert.rejects(
    () => reader.read('node_modules'),
    (error) => {
      assert.equal(error.code, 'excluded-directory')
      assert.match(error.message, /excluded directory/)
      return true
    },
  )
})

test('the byte cap and the binary sniff both refuse a file', async () => {
  const { reader } = await virtualReader({
    'small.txt': 'hello',
    'big.txt': 'x'.repeat(4096),
    'nul.bin.txt': 'before\u0000after',
  })
  assert.equal((await reader.read('small.txt')).text, 'hello')
  await assert.rejects(() => reader.read('big.txt', { maxBytes: 1024 }), (error) => error.code === 'tooLarge')
  await assert.rejects(() => reader.read('nul.bin.txt'), (error) => error.code === 'binary-extension')
})

test('a read is cached, and a missing file reports absence rather than a crash', async () => {
  const { reader, fs } = await virtualReader(SAMPLE_TREE)
  const first = await reader.read('src/main.js')
  const second = await reader.read('src/main.js')
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(fs.readLog.filter((path) => path === 'src/main.js').length, 1, 'the file is read once')
  assert.equal(reader.cachedBytes > 0, true)

  await assert.rejects(() => reader.read('src/nope.js'), (error) => error.code === 'not-found')
  await assert.rejects(() => reader.read('src'), (error) => error.code === 'not-a-file')
})

test('reading a directory is an error that points at the right call', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  await assert.rejects(
    () => reader.read('src'),
    (error) => {
      assert.equal(error.code, 'not-a-file')
      assert.match(error.message, /list it instead/)
      return true
    },
  )
})

test('the outline is bounded and reports what it hid', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  const outline = await reader.outline({ maxDepth: 3 })
  const text = outline.lines.join('\n')
  assert.match(text, /src\//)
  assert.match(text, /main\.js/)
  assert.match(text, /util\//)
  assert.doesNotMatch(text, /node_modules/)
  assert.doesNotMatch(text, /out\.js/)
  assert.equal(outline.truncated, false)
  assert.equal(
    outline.excludedNotes.some((note) => note.startsWith('node_modules')),
    true,
    'an excluded directory is reported so the guide can describe it',
  )

  const shallow = await reader.outline({ maxDepth: 0 })
  assert.equal(shallow.lines.some((line) => line.includes('main.js')), false, 'depth 0 lists only the root')
})

test('the fingerprint changes when a readable file changes and not otherwise', async () => {
  const { reader } = await virtualReader(SAMPLE_TREE)
  const before = await reader.fingerprint()

  const same = await virtualReader(SAMPLE_TREE)
  assert.equal((await same.reader.fingerprint()).fingerprint, before.fingerprint, 'same tree, same fingerprint')

  const added = await virtualReader({ ...SAMPLE_TREE, 'src/new.js': 'export const x = 1' })
  const after = await added.reader.fingerprint()
  assert.notEqual(after.fingerprint, before.fingerprint)
  assert.equal(after.files, before.files + 1)

  // A change confined to the excluded half of the tree must not move it: this
  // is exactly what stops a dependency install from triggering a refresh.
  const excluded = await virtualReader({ ...SAMPLE_TREE, 'node_modules/dep/extra.js': 'x', 'build/more.js': 'y' })
  assert.equal((await excluded.reader.fingerprint()).fingerprint, before.fingerprint)
})

test('a nested .gitignore constrains the subtree it lives in', async () => {
  const { reader } = await virtualReader({
    '.gitignore': 'dist/\n',
    'src/.gitignore': '*.gen.ts\n',
    'src/a.gen.ts': 'generated',
    'src/a.ts': 'real',
    'lib/b.gen.ts': 'not covered by src/.gitignore',
    'dist/out.js': 'build output',
  })
  await assert.rejects(() => reader.read('src/a.gen.ts'), (error) => error.code === 'excluded')
  assert.equal((await reader.read('src/a.ts')).text, 'real')
  assert.equal((await reader.read('lib/b.gen.ts')).text, 'not covered by src/.gitignore')
  await assert.rejects(() => reader.read('dist/out.js'), (error) => error.code === 'excluded-directory')
})

test('gitignore is optional, and a disabled matcher ignores nothing', async () => {
  const { reader } = await virtualReader(
    { '.gitignore': '*.log\n', 'a.log': 'kept' },
    { useGitignore: false },
  )
  assert.equal((await reader.read('a.log')).text, 'kept')
})
