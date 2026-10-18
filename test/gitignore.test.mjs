/**
 * The `.gitignore` matcher.
 *
 * A matcher that is subtly wrong is worse than none: it either leaks a file the
 * repository excluded or hides a file the guide needs. The cases below are the
 * ones a naive implementation gets wrong — an unanchored pattern at depth, a
 * leading slash, a directory-only rule re-including nothing, a negation that has
 * to beat an earlier rule, `**` spanning zero directories, and a nested file
 * overriding the root.
 *
 * @module dsh-repo-wiki/test/gitignore
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { compileRule, createIgnoreResolver, GitignoreLayer, parseGitignore } from '../lib/wiki/gitignore.js'

/**
 * Build a resolver over one root-level document.
 * @param text - the `.gitignore` contents.
 * @returns the predicate.
 */
function resolver(text, base = '') {
  return createIgnoreResolver([new GitignoreLayer(parseGitignore(text), base)])
}

test('comments, blank lines and a lone bang carry no rule', () => {
  assert.equal(compileRule(''), null)
  assert.equal(compileRule('   '), null)
  assert.equal(compileRule('# a comment'), null)
  assert.equal(compileRule('!'), null)

  const rules = parseGitignore('# x\n\n*.log\n')
  assert.equal(rules.length, 1)
  assert.equal(rules[0].source, '*.log')
  assert.equal(rules[0].negated, false)
  assert.equal(rules[0].directoryOnly, false)
  assert.equal(rules[0].regex.test('x.log'), true)
  assert.equal(rules[0].regex.test('a/x.log'), true, 'an unanchored rule matches at depth')
})

test('an unanchored pattern matches at any depth', () => {
  const ignore = resolver('node_modules\n*.log\n')
  assert.equal(ignore('node_modules', true), true)
  assert.equal(ignore('a/b/node_modules', true), true)
  assert.equal(ignore('a/b/node_modules/deep/file.js', false), true)
  assert.equal(ignore('x.log', false), true)
  assert.equal(ignore('a/b/x.log', false), true)
  assert.equal(ignore('src/index.ts', false), false)
})

test('a leading slash anchors to the root only', () => {
  const ignore = resolver('/root-only.txt\n')
  assert.equal(ignore('root-only.txt', false), true)
  assert.equal(ignore('sub/root-only.txt', false), false)
})

test('a slash inside the pattern anchors it too', () => {
  const ignore = resolver('docs/internal.md\n')
  assert.equal(ignore('docs/internal.md', false), true)
  assert.equal(ignore('a/docs/internal.md', false), false)
})

test('a directory-only rule matches directories and everything below them', () => {
  const ignore = resolver('build/\n')
  assert.equal(ignore('build', true), true)
  assert.equal(ignore('build', false), false, 'a file named build is not the directory')
  assert.equal(ignore('build/out.js', false), true)
  assert.equal(ignore('a/build/out.js', false), true)
})

test('a later negation re-includes, and an earlier one does not protect', () => {
  const ignore = resolver('*.log\n!keep.log\n')
  assert.equal(ignore('x.log', false), true)
  assert.equal(ignore('keep.log', false), false)
  assert.equal(ignore('a/keep.log', false), false)

  const reversed = resolver('!keep.log\n*.log\n')
  assert.equal(reversed('keep.log', false), true, 'the last match decides')
})

test('an excluded directory cannot be re-included', () => {
  // Git documents this explicitly, so the matcher must not pretend otherwise.
  const ignore = resolver('logs/\n!logs/keep.txt\n')
  assert.equal(ignore('logs', true), true)
  assert.equal(ignore('logs/keep.txt', false), true)
})

test('** spans zero or more directories', () => {
  const ignore = resolver('docs/**/*.md\n')
  assert.equal(ignore('docs/a.md', false), true, 'zero directories')
  assert.equal(ignore('docs/a/b/c.md', false), true)
  assert.equal(ignore('docs/a/b/c.txt', false), false)
  assert.equal(ignore('other/a.md', false), false)
})

test('a trailing slash glob matches everything below a prefix', () => {
  const ignore = resolver('src/generated/**\n')
  assert.equal(ignore('src/generated/a.js', false), true)
  assert.equal(ignore('src/generated/deep/a.js', false), true)
  assert.equal(ignore('src/other.js', false), false)
})

test('character classes, question marks and escapes behave', () => {
  const ignore = resolver('[Dd]ebug/\nfile?.txt\n\\#literal\n')
  assert.equal(ignore('Debug', true), true)
  assert.equal(ignore('debug', true), true)
  assert.equal(ignore('xdebug', true), false)
  assert.equal(ignore('file1.txt', false), true)
  assert.equal(ignore('file12.txt', false), false)
  assert.equal(ignore('#literal', false), true)
})

test('trailing whitespace is ignored unless escaped', () => {
  assert.equal(compileRule('foo   ').source, 'foo')
  const escaped = compileRule('foo\\ ')
  assert.notEqual(escaped, null)
  assert.equal(escaped.regex.test('foo '), true)
})

test('a nested file overrides the root, whichever order the layers arrive in', () => {
  const root = new GitignoreLayer(parseGitignore('*.ts\n'), '')
  const nested = new GitignoreLayer(parseGitignore('!keep.ts\n'), 'src')

  const forward = createIgnoreResolver([root, nested])
  assert.equal(forward('src/keep.ts', false), false, 'the nested layer wins')
  assert.equal(forward('src/other.ts', false), true)
  assert.equal(forward('lib/keep.ts', false), true, 'the nested layer does not reach outside src')

  const reversed = createIgnoreResolver([nested, root])
  assert.equal(reversed('src/keep.ts', false), false, 'layer order is normalised by depth')
})

test('a nested layer applies its patterns relative to its own directory', () => {
  const nested = new GitignoreLayer(parseGitignore('generated/\n'), 'src')
  const ignore = createIgnoreResolver([nested])
  assert.equal(ignore('src/generated', true), true)
  assert.equal(ignore('src/generated/a.js', false), true)
  assert.equal(ignore('generated', true), false, 'the pattern is scoped to src')
})

test('a matcher with no rules ignores nothing', () => {
  const ignore = resolver('# nothing here\n')
  assert.equal(ignore('anything', false), false)
  assert.equal(ignore('anything', true), false)
})
