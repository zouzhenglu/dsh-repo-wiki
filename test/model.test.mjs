/**
 * The Wiki document model: catalog normalization, citation parsing, and the
 * citation verifier.
 *
 * The verifier is the load-bearing part. A Wiki whose value proposition is
 * "every conclusion carries a source location" is worth nothing if the locations
 * can be invented, so these tests assert that an unknown path, a real path that
 * was never read, and a line range past the end of a file are all caught rather
 * than rendered as evidence.
 *
 * @module dsh-repo-wiki/test/model
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  CATALOG_SEED,
  countLines,
  createWikiDocument,
  deriveId,
  flattenCatalog,
  normalizeCatalog,
  parseCitations,
  summarizeWiki,
  validateWikiDocument,
  verifyCitations,
} from '../lib/wiki/model.js'

test('a model catalog is kept, in order, with children', () => {
  const catalog = normalizeCatalog(
    [
      { title: 'What it is', brief: 'identity', children: [{ title: 'Stack', brief: 'languages' }] },
      { title: 'Entry', brief: 'where it starts' },
    ],
    'en',
  )
  assert.equal(catalog.length, 2)
  assert.equal(catalog[0].title, 'What it is')
  assert.equal(catalog[0].children.length, 1)
  assert.equal(catalog[0].children[0].title, 'Stack')
  assert.equal(catalog[1].children.length, 0)
})

test('an empty or malformed catalog falls back to the documented coverage', () => {
  for (const input of [null, undefined, [], 'nonsense', [{ brief: 'no title' }]]) {
    const catalog = normalizeCatalog(input, 'zh-CN')
    assert.equal(catalog.length, CATALOG_SEED.length)
    assert.equal(catalog[0].title, '项目身份')
    assert.equal(catalog.at(-1).title, '风险点')
  }
})

test('a model may extend the seed without losing it', () => {
  const catalog = normalizeCatalog([{ title: 'Custom section' }], 'en')
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0].title, 'Custom section', 'a usable model catalog replaces the seed')
})

test('nesting stops after grandchildren', () => {
  const catalog = normalizeCatalog(
    [{
      title: 'a',
      children: [{
        title: 'b',
        children: [{ title: 'c', children: [{ title: 'd' }] }],
      }],
    }],
    'en',
  )
  const [a] = catalog
  const [b] = a.children
  const [c] = b.children
  assert.deepEqual([a.title, b.title, c.title], ['a', 'b', 'c'])
  assert.equal(c.children.length, 0, 'a fourth level is dropped')
})

test('duplicate titles get distinct ids, and a non-Latin title still gets one', () => {
  const catalog = normalizeCatalog(
    [{ title: 'Overview' }, { title: 'Overview' }, { title: '项目身份' }],
    'zh-CN',
  )
  assert.equal(catalog[0].id, 'overview')
  assert.equal(catalog[1].id, 'overview-2')
  assert.match(catalog[2].id, /^p-[0-9a-f]{8}$/)
  assert.equal(new Set(catalog.map((node) => node.id)).size, 3)

  const used = new Set(['overview'])
  assert.equal(deriveId('Overview', used), 'overview-2')
  assert.equal(deriveId('Overview', used), 'overview-3')
})

test('flattening yields parents before children with their trail', () => {
  const catalog = normalizeCatalog(
    [{ title: 'A', children: [{ title: 'A1' }, { title: 'A2', children: [{ title: 'A2a' }] }] }, { title: 'B' }],
    'en',
  )
  const flat = flattenCatalog(catalog)
  assert.deepEqual(flat.map((page) => page.title), ['A', 'A1', 'A2', 'A2a', 'B'])
  assert.deepEqual(flat[3].path, ['A', 'A2', 'A2a'])
  assert.equal(flat[3].depth, 2)
  assert.equal(flat[1].parentId, flat[0].id)
  assert.equal(flat[4].parentId, null)
})

test('citations are parsed from backticked spans and from source list items', () => {
  const markdown = [
    'Orientation. `src/a.ts:10-24` and also `src/b.ts:7`.',
    'A backslash path `src\\c.ts:3-9` normalizes to the same file the reader knows, and `pkg/d.ts:1-2` is taken as written.',
    '',
    '## 源码位置',
    '- src/a.ts:10-24',
    '- src/e.ts:40-52',
    '* src/f.ts:100',
    '',
    'Not a citation: see line 5 of the spec, ratio 3:1, and `src/g.ts` with no line.',
  ].join('\n')
  const citations = parseCitations(markdown)
  const keys = citations.map((citation) => `${citation.path}:${citation.start}-${citation.end}`)
  assert.deepEqual(keys, [
    'src/a.ts:10-24',
    'src/b.ts:7-7',
    'src/c.ts:3-9',
    'pkg/d.ts:1-2',
    'src/e.ts:40-52',
    'src/f.ts:100-100',
  ])
})

test('citations are de-duplicated and support the #L form', () => {
  const citations = parseCitations('`src/a.ts:#L10-20` and again `src/a.ts:10-20`.')
  assert.equal(citations.length, 1)
  assert.equal(citations[0].start, 10)
  assert.equal(citations[0].end, 20)
})

test('a reversed or nonsensical range is not a citation', () => {
  assert.deepEqual(parseCitations('`src/a.ts:20-10`'), [])
  assert.deepEqual(parseCitations('`src/a.ts:0-5`'), [])
  assert.deepEqual(parseCitations(''), [])
})

test('verification rejects unknown paths, unread paths, and out-of-range lines', () => {
  const citations = parseCitations(
    '`src/read.ts:1-5` `src/exists-not-read.ts:1-5` `src/invented.ts:1-5` `src/read.ts:900-950`',
  )
  const readPaths = new Set(['src/read.ts'])
  const knownPaths = new Set(['src/read.ts', 'src/exists-not-read.ts'])
  const lineCounts = new Map([['src/read.ts', 40]])
  const { verified, unverified } = verifyCitations(citations, { readPaths, lineCounts, knownPaths })

  assert.equal(verified.length, 1)
  assert.equal(verified[0].path, 'src/read.ts')
  assert.equal(unverified.length, 3)
  assert.match(unverified[0].reason, /not read during this generation/)
  assert.match(unverified[1].reason, /no such file/)
  assert.match(unverified[2].reason, /only 40 lines/)
})

test('a range that runs past the end is clamped rather than discarded', () => {
  const citations = parseCitations('`src/a.ts:30-500`')
  const { verified } = verifyCitations(citations, {
    readPaths: new Set(['src/a.ts']),
    lineCounts: new Map([['src/a.ts', 42]]),
  })
  assert.equal(verified.length, 1)
  assert.equal(verified[0].start, 30)
  assert.equal(verified[0].end, 42)
})

test('a leading ./ in a citation is normalized before verification', () => {
  const citations = parseCitations('`./src/a.ts:1-2`')
  const { verified } = verifyCitations(citations, {
    readPaths: new Set(['src/a.ts']),
    lineCounts: new Map([['src/a.ts', 10]]),
  })
  assert.equal(verified.length, 1)
  assert.equal(verified[0].path, 'src/a.ts')
})

test('countLines counts lines the way a reader does', () => {
  assert.equal(countLines(''), 0)
  assert.equal(countLines('one'), 1)
  assert.equal(countLines('one\ntwo'), 2)
  assert.equal(countLines('one\ntwo\n'), 3, 'a trailing newline opens a final empty line, as editors show it')
})

test('document validation accepts this version and rejects everything else', () => {
  const document = createWikiDocument({
    workspace: { id: 'w', name: 'n', root: '/r' },
    language: 'zh-CN',
    diagrams: true,
  })
  assert.equal(validateWikiDocument(document).ok, true)

  assert.equal(validateWikiDocument(null).ok, false)
  assert.equal(validateWikiDocument([]).ok, false)
  assert.equal(validateWikiDocument({ ...document, version: 99 }).ok, false)
  assert.equal(validateWikiDocument({ ...document, pages: 'no' }).ok, false)
  assert.equal(validateWikiDocument({ ...document, pages: [null] }).ok, false)
  assert.equal(validateWikiDocument({ ...document, pages: [{ id: 'a' }] }).ok, false)
  assert.equal(
    validateWikiDocument({ ...document, pages: [{ id: 'a', title: 'A', status: 'weird' }] }).ok,
    false,
  )
})

test('a summary carries page status without carrying page bodies', () => {
  const document = createWikiDocument({
    workspace: { id: 'w', name: 'n', root: '/r' },
    language: 'en',
  })
  document.pages = [
    { id: 'a', title: 'A', brief: 'x', path: ['A'], parentId: null, depth: 0, status: 'done', markdown: 'SECRET BODY', sources: [{ path: 'a.ts', start: 1, end: 2 }], unverifiedSources: [] },
    { id: 'b', title: 'B', brief: 'y', path: ['B'], parentId: null, depth: 0, status: 'failed', markdown: '', sources: [], unverifiedSources: [{ path: 'x.ts' }], error: 'boom' },
  ]
  const summary = summarizeWiki(document)
  assert.equal(summary.counts.done, 1)
  assert.equal(summary.counts.failed, 1)
  assert.equal(summary.counts.total, 2)
  assert.equal(summary.citations.verified, 1)
  assert.equal(summary.citations.unverified, 1)
  assert.equal(summary.pages.length, 2)
  assert.equal(summary.pages[0].sources, 1)
  assert.equal(summary.pages[1].error, 'boom')
  assert.equal(JSON.stringify(summary).includes('SECRET BODY'), false, 'bodies must not travel with a summary')
})
