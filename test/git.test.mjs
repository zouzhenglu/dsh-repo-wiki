/**
 * The Git metadata reader.
 *
 * A Wiki records which code state it describes, and that is only worth recording
 * if it is right. These tests cover the layouts a real repository actually
 * presents — a loose ref, a packed ref, a detached HEAD, a linked worktree, a
 * repository above the workspace root, and no repository at all — through the
 * same virtual filesystem the rest of the suite uses, so no test needs a real
 * `git` or a real checkout.
 *
 * @module dsh-repo-wiki/test/git
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { posix } from 'node:path'

import { readGitState, shortCommit } from '../lib/wiki/git.js'
import { VirtualFs } from './helpers.mjs'

/**
 * Bind a virtual tree and return the reader inputs.
 *
 * The tree is bound at `''` rather than at a root, so a path like
 * `/work/.git/HEAD` maps to the tree entry `work/.git/HEAD` — which lets one
 * tree hold both a workspace and a repository above it.
 * @param tree - the virtual files.
 * @param [root] - the workspace root inside the tree.
 * @returns `{ fs, join, root }`.
 */
function bind(tree, root = '/work') {
  const fs = new VirtualFs(tree).bind('')
  return { fs, root, join: posix.join }
}

const COMMIT = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

test('a checked-out branch is read from a loose ref', async () => {
  const { fs, join, root } = bind({
    'work/.git/HEAD': 'ref: refs/heads/main\n',
    [`work/.git/refs/heads/main`]: `${COMMIT}\n`,
  })
  assert.deepEqual(await readGitState(root, { fs, join }), { branch: 'main', commit: COMMIT })
})

test('a branch whose ref is packed is still resolved', async () => {
  const { fs, join, root } = bind({
    'work/.git/HEAD': 'ref: refs/heads/develop\n',
    'work/.git/packed-refs': [
      '# pack-refs with: peeled fully-peeled sorted ',
      `${OTHER} refs/tags/v1.0`,
      `^${COMMIT}`,
      `${COMMIT} refs/heads/develop`,
      '',
    ].join('\n'),
  })
  const state = await readGitState(root, { fs, join })
  assert.equal(state.branch, 'develop')
  assert.equal(state.commit, COMMIT, 'the peeled tag line is skipped, not mistaken for a ref')
})

test('a detached HEAD reports the commit and no branch', async () => {
  const { fs, join, root } = bind({ 'work/.git/HEAD': `${COMMIT}\n` })
  assert.deepEqual(await readGitState(root, { fs, join }), { branch: null, commit: COMMIT })
})

test('a repository above the workspace is found by walking up', async () => {
  const { fs, join } = bind({
    '.git/HEAD': 'ref: refs/heads/trunk\n',
    '.git/refs/heads/trunk': `${COMMIT}\n`,
    'work/package/src/index.js': 'export const x = 1',
  }, '/work/package')
  assert.deepEqual(await readGitState('/work/package', { fs, join }), { branch: 'trunk', commit: COMMIT })
})

test('a linked worktree follows its gitdir pointer', async () => {
  const { fs, join, root } = bind({
    'work/.git': 'gitdir: /work/.git-dir/worktrees/wt1\n',
    'work/.git-dir/worktrees/wt1/HEAD': 'ref: refs/heads/feature\n',
    'work/.git-dir/worktrees/wt1/refs/heads/feature': `${COMMIT}\n`,
  })
  assert.deepEqual(await readGitState(root, { fs, join }), { branch: 'feature', commit: COMMIT })
})

test('a workspace that is not a repository reports nothing rather than failing', async () => {
  const { fs, join, root } = bind({ 'work/src/index.js': 'export const x = 1' })
  assert.deepEqual(await readGitState(root, { fs, join }), { branch: null, commit: null })
})

test('an unreadable or empty HEAD is not guessed at', async () => {
  const { fs, join, root } = bind({ 'work/.git/HEAD': '' })
  assert.deepEqual(await readGitState(root, { fs, join }), { branch: null, commit: null })
})

test('an unborn branch has no commit yet, and says so', async () => {
  const { fs, join, root } = bind({ 'work/.git/HEAD': 'ref: refs/heads/main\n' })
  assert.deepEqual(await readGitState(root, { fs, join }), { branch: 'main', commit: null })
})

test('a missing or empty root is answered without touching the filesystem', async () => {
  assert.deepEqual(await readGitState('', { fs: new VirtualFs({}).bind('/'), join: posix.join }), { branch: null, commit: null })
  assert.deepEqual(await readGitState(undefined, {}), { branch: null, commit: null })
})

test('a commit is abbreviated the way git itself would print it', () => {
  assert.equal(shortCommit(COMMIT), '1a2b3c4')
  assert.equal(shortCommit(null), null)
  assert.equal(shortCommit(COMMIT, 10), '1a2b3c4d5e')
})
