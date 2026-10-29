/**
 * 气泡侧：把引用块前缀认出来并折叠成胶囊；以及 apply() 的接线契约。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, makeCtx } from './harness.js'

const { lib } = loadClient().exports
const { citationRule, buildCitationBlock, captureCitationBlock } = lib

function citation(overrides = {}) {
  return {
    turn: 3,
    step: 0,
    anchor: 'x',
    session: 's',
    range: [0, 5],
    quote: 'hello',
    ...overrides,
  }
}

test('the rule matches the leading citation block only', () => {
  const text = `${buildCitationBlock([citation()])}\n\n正文`
  const hit = citationRule.match(text, 0)
  assert.notEqual(hit, undefined)
  assert.equal(hit.id, 'citation')
  assert.equal(hit.start, 0)
  assert.equal(hit.data.items[0].quote, 'hello')
  assert.equal(text.slice(hit.end), '正文', '前缀必须连分隔空行一起消费掉')
})

test('the rule ignores a block that is not at the head of the message', () => {
  const text = `正文\n\n${buildCitationBlock([citation()])}`
  assert.equal(citationRule.match(text, 0), undefined)
})

test('the rule ignores plain text and header look-alikes', () => {
  assert.equal(citationRule.match('普通消息', 0), undefined)
  assert.equal(citationRule.match('我引用了以下 1 条回复内容：但不是块', 0), undefined)
  assert.equal(citationRule.match('', 0), undefined)
})

test('captureCitationBlock also reports what the user actually typed', () => {
  const text = `${buildCitationBlock([citation()])}\n\n我的问题`
  const hit = captureCitationBlock(text)
  assert.equal(hit.body, '我的问题')
  assert.equal(hit.items.length, 1)
})

test('apply() wires the reference source, the bubble rule and the slot', () => {
  const { exports } = loadClient()
  const { ctx, calls } = makeCtx()
  exports.apply(ctx)

  assert.equal(calls.sources.length, 1, '必须只注册一个引用源')
  assert.equal(calls.sources[0].name, 'citation')

  assert.equal(calls.userText.length, 1, '必须注册一个 userText 规则')
  assert.equal(calls.userText[0].id, 'citation')

  const slot = calls.slots.find((call) => call.spec?.name === 'conversation.user.text.node')
  assert.ok(slot, '必须在 conversation.user.text.node 上注册折叠渲染器')
  assert.equal(slot.spec.key, 'citation')
  assert.equal(typeof slot.component, 'function')
})

test('apply() degrades quietly when the host lacks every optional service', () => {
  const { exports } = loadClient()
  const bare = {
    get: () => undefined,
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') dispose()
    },
    on: () => () => {},
  }
  assert.doesNotThrow(() => exports.apply(bare))
})
