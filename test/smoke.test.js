/**
 * 包骨架与 client half 装配契约。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadClient, makeCtx } from './harness.js'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)

test('package declares the client half and the bundle patch', () => {
  assert.equal(pkg.main, 'index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
})

test('client module loads under the DSH module loader and exports apply/inject', () => {
  const { id, exports } = loadClient()
  assert.equal(id, 'dsh-citation')
  assert.equal(typeof exports.apply, 'function')
  assert.ok(Array.isArray(exports.inject))
  for (const service of ['slots', 'locale', 'uiConversation']) {
    assert.ok(exports.inject.includes(service), `inject 缺少服务 ${service}`)
  }
})

test('apply() registers the dictionaries and survives a service-less context', () => {
  const { exports } = loadClient()
  const { ctx, calls } = makeCtx()
  exports.apply(ctx)
  const localeCall = calls.locale.find((call) => call.ns === 'citation')
  assert.ok(localeCall, '未注册 citation 词典')
  assert.ok(localeCall.dictionaries.zh['menu.addToConversation'])
  assert.ok(localeCall.dictionaries.en['menu.addToConversation'])
})
