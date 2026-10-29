/**
 * 引用源（reference source）：胶囊的身份、以及发送那一刻的展开。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './harness.js'

const { lib } = loadClient().exports
const { citationRefId, citationFromRefId, serializeCitation, createCitationSource } = lib

function citation(overrides = {}) {
  return {
    turn: 7,
    step: 2,
    anchor: 'deadbeef',
    session: 's1',
    range: [0, 5],
    quote: 'hello & <world>',
    ...overrides,
  }
}

test('the chip reference id roundtrips through a url-safe alphabet', () => {
  const one = citation()
  const id = citationRefId(one)
  assert.match(id, /^[A-Za-z0-9_-]+$/u, '胶囊 id 必须能安全地放在 draft 文本/属性里')
  assert.deepEqual(citationFromRefId(id), one)
})

test('the chip id survives multibyte and newline content', () => {
  const one = citation({ quote: '第一行\n第二行 —— 中文与 emoji 🐰' })
  assert.deepEqual(citationFromRefId(citationRefId(one)), one)
})

test('citationFromRefId refuses garbage instead of throwing', () => {
  assert.equal(citationFromRefId('not-base64-@@'), null)
  assert.equal(citationFromRefId(''), null)
  assert.equal(citationFromRefId(undefined), null)
})

test('serialize expands one chip into a model-readable citation block', async () => {
  const text = await serializeCitation(citation())
  assert.match(text, /^我引用了以下 1 条回复内容：\n<citation turn="7" step="2" range="0:5"/u)
  // 转义策略：只有左尖括号（能伪造标签）与反斜杠被转义；`&`、`>` 保持原样，
  // 因为解析器按字面量切 `</quote>`，模型读原文也比读一堆实体更准。
  assert.ok(text.includes('<quote>hello & \\u003cworld></quote>'))
  assert.match(text, /anchor="deadbeef" session="s1">/u)
})

test('serialize clips an oversized quote and says how much it dropped', async () => {
  const text = await serializeCitation(citation({ quote: 'x'.repeat(30000) }))
  assert.match(text, /已省略 \d+ 字/u)
  assert.ok(text.length < 21000)
})

test('the registered source is a well-formed reference source', async () => {
  const source = createCitationSource()
  assert.equal(source.trigger, '@')
  assert.equal(source.name, 'citation')
  // 宿主的 @ 菜单对每个 '@' 源无条件调用 candidates()：缺了它整个 @ 提及会报错。
  assert.equal(typeof source.candidates, 'function')
  assert.deepEqual(await source.candidates({}, {}), [])
  assert.equal(typeof source.codec.serialize, 'function')
  assert.equal(source.codec.clipboardText(citationRefId(citation())).startsWith('@'), true)
  await assert.doesNotReject(() => source.codec.serialize(citationRefId(citation())))
  await assert.rejects(() => source.codec.serialize('@@@'), /引用/u)
})
