/**
 * The reading-view policy: what a Wiki may and may not read.
 *
 * These assertions are the ones that matter most in the whole suite, because the
 * policy is the only thing standing between a repository's secrets and a model
 * provider. The credential rule is asserted in both directions — a dotenv must
 * be refused and `tokenService.ts` must not be — since a rule that refuses
 * ordinary source is as wrong as one that leaks a key, just in a way nobody
 * notices until the guide is useless.
 *
 * @module dsh-repo-wiki/test/policy
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  classifyDirectory,
  classifyFile,
  extensionOf,
  isSourceFile,
} from '../lib/wiki/policy.js'

test('credential material is refused by convention', () => {
  for (const name of [
    '.env',
    '.env.local',
    '.env.production',
    'id_rsa',
    'id_ed25519.pub',
    '.npmrc',
    '.netrc',
    'credentials',
    'credentials.json',
    'secrets.yaml',
    'master.key',
    '.terraformrc',
  ]) {
    const refusal = classifyFile(name)
    assert.notEqual(refusal, null, `${name} must be refused`)
    assert.equal(refusal.reason, 'secret-name', `${name} must be refused as a credential name`)
  }
})

test('a credential word inside source code is not a credential file', () => {
  // ZCode calls this case out by name: `tokenService.ts` is normal source.
  for (const name of [
    'tokenService.ts',
    'tokenizer.py',
    'PasswordField.tsx',
    'secrets_test.go',
    'credentialStore.java',
  ]) {
    assert.equal(classifyFile(name), null, `${name} must stay readable`)
    assert.equal(isSourceFile(name), true)
  }
})

test('a credential word in a non-source file is refused', () => {
  for (const name of ['token.json', 'secrets.txt', 'credentials.yaml', 'service-account-password.conf']) {
    const refusal = classifyFile(name)
    assert.notEqual(refusal, null, `${name} must be refused`)
    assert.equal(refusal.reason, 'secret-name')
  }
})

test('key material is refused by suffix even when the name looks ordinary', () => {
  for (const name of ['server.pem', 'release.key', 'bundle.p12', 'app.keystore', 'cert.pfx']) {
    const refusal = classifyFile(name)
    assert.notEqual(refusal, null, `${name} must be refused`)
    assert.equal(refusal.reason, 'secret-extension')
  }
})

test('binary content is refused by suffix', () => {
  for (const name of ['logo.png', 'lib.so', 'a.zip', 'data.sqlite', 'report.pdf', 'font.woff2', 'module.wasm']) {
    const refusal = classifyFile(name)
    assert.notEqual(refusal, null, `${name} must be refused`)
    assert.equal(refusal.reason, 'binary-extension')
  }
})

test('ordinary source and documentation stay readable', () => {
  for (const name of [
    'index.ts',
    'main.py',
    'Cargo.toml',
    'README.md',
    'Dockerfile',
    '.gitignore',
    'tsconfig.json',
    'schema.graphql',
    'styles.scss',
  ]) {
    assert.equal(classifyFile(name), null, `${name} must stay readable`)
  }
})

test('deployment additions extend the policy without replacing it', () => {
  assert.equal(classifyFile('notes.xyz'), null)
  assert.equal(classifyFile('notes.xyz', { excludedExtensions: ['.xyz'] }).reason, 'binary-extension')
  assert.equal(classifyFile('keep.md', { excludedFiles: ['keep.md'] }).reason, 'local-state')
  assert.equal(classifyFile('tokenizer.zz', { sourceExtensions: ['.zz'] }), null)
})

test('dependency, build, cache and local-state directories are refused at any depth', () => {
  for (const name of [
    'node_modules',
    '.git',
    'dist',
    'build',
    'target',
    '__pycache__',
    '.cache',
    '.venv',
    'coverage',
    '.next',
    '.dsh',
  ]) {
    const refusal = classifyDirectory(name)
    assert.notEqual(refusal, null, `${name} must be refused`)
    assert.equal(refusal.reason, 'excluded-directory')
  }
  assert.equal(classifyDirectory('src'), null)
})

test('extensionOf treats a dotfile as having no extension', () => {
  assert.equal(extensionOf('.env'), '')
  assert.equal(extensionOf('a.ts'), '.ts')
  assert.equal(extensionOf('archive.tar.gz'), '.gz')
  assert.equal(extensionOf('Makefile'), '')
  assert.equal(extensionOf('a.PNG'), '.png')
})
