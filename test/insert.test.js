/**
 * 插入：把一条引用变成输入框里的胶囊（或降级文本），以及菜单定位。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, makeCtx } from './harness.js'

const { lib } = loadClient().exports
const { insertCitation, describeCitation, clampMenuPosition, citationFromRefId, citationRefId, interpolate, zh } = lib

const t = (key, vars) => interpolate(zh[key] ?? key, vars)

function citation(overrides = {}) {
  return {
    turn: 3,
    step: 0,
    anchor: 'a1b2',
    session: 'session-x',
    range: [10, 42],
    quote: '被引用的那段回答',
    ...overrides,
  }
}

/** 造一个带 shell 的 ctx：shell 形状对真实 SessionInputShell 的最小子集。 */
function makeInsertCtx(shell, { scope = { id: 'scope' } } = {}) {
  const calls = { inserted: [], text: [], capture: 0 }
  const input = shell === undefined ? undefined : {
    actions: {
      captureInsertion() {
        calls.capture += 1
        return shell.span
      },
      insertText(text, span) {
        calls.text.push({ text, span })
        return shell.textApplied !== false
      },
    },
    insertReference: shell.insertReference,
    projection: { occurrences: shell.occurrences ?? [] },
  }
  const { ctx } = makeCtx({
    sessions: { scope: () => scope, list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    conversation: { input: { for: () => input } },
  })
  return { ctx, calls }
}

test('describeCitation labels the chip with the turn and the size', () => {
  assert.equal(describeCitation(citation(), t).label, '引用 · 第3轮 · 8字')
  assert.match(describeCitation(citation(), t).title, /第3轮/u)
})

test('insertCitation puts an atomic chip in the composer when the editor supports it', () => {
  const span = { start: 4, end: 4, draftRev: 7 }
  const inserted = []
  const { ctx, calls } = makeInsertCtx({
    span,
    insertReference: (ref, givenSpan) => {
      inserted.push({ ref, givenSpan })
      return true
    },
  })
  const one = citation()
  const result = insertCitation(ctx, one, { t })
  assert.deepEqual(result, { ok: true, mode: 'chip' })
  assert.equal(calls.capture, 1, 'span 必须来自 captureInsertion（否则 draftRev 会 CAS 失败）')
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].givenSpan, span)
  assert.equal(inserted[0].ref.source, 'citation')
  assert.equal(inserted[0].ref.appearance, 'session')
  assert.deepEqual(citationFromRefId(inserted[0].ref.ref), one)
  assert.equal(calls.text.length, 0, '胶囊成功时不该再插文本')
})

test('insertCitation degrades to a positional marker when the chip is rejected', () => {
  const { ctx, calls } = makeInsertCtx({
    span: { start: 0, end: 0, draftRev: 1 },
    insertReference: () => false,
  })
  const result = insertCitation(ctx, citation(), { t })
  assert.deepEqual(result, { ok: true, mode: 'text' })
  assert.equal(calls.text.length, 1)
  assert.match(calls.text[0].text, /引用 · 第3轮/u)
})

test('insertCitation reports failure instead of throwing when the input is gone', () => {
  assert.deepEqual(insertCitation(undefined, citation(), { t }), { ok: false, reason: 'no-ctx' })
  const { ctx } = makeInsertCtx(undefined)
  assert.deepEqual(insertCitation(ctx, citation(), { t }), { ok: false, reason: 'no-input' })
})

test('insertCitation survives a throwing editor', () => {
  const { ctx } = makeInsertCtx({
    span: { start: 0, end: 0, draftRev: 1 },
    insertReference: () => {
      throw new Error('editor exploded')
    },
  })
  const result = insertCitation(ctx, citation(), { t })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'error')
})

test('a passage that is already quoted is refused instead of duplicated', () => {
  const one = citation()
  const { ctx, calls } = makeInsertCtx({
    span: { start: 0, end: 0, draftRev: 1 },
    occurrences: [{ source: 'citation', ref: citationRefId(one) }],
    insertReference: () => true,
  })
  assert.deepEqual(insertCitation(ctx, one, { t }), { ok: false, reason: 'duplicate' })
  assert.equal(calls.text.length, 0)
})

test('the fifth citation is allowed and the sixth is refused', () => {
  const others = Array.from({ length: 5 }, (_unused, index) =>
    citation({ turn: index + 1, range: [index, index + 1] }),
  )
  const occurrences = others.map((one) => ({ source: 'citation', ref: citationRefId(one) }))
  const { ctx } = makeInsertCtx({
    span: { start: 0, end: 0, draftRev: 1 },
    occurrences,
    insertReference: () => true,
  })
  assert.deepEqual(insertCitation(ctx, citation({ turn: 9 }), { t }), {
    ok: false,
    reason: 'too-many',
  })
})

test('clampMenuPosition keeps the menu inside the viewport', () => {
  const viewport = { width: 1000, height: 800 }
  assert.deepEqual(clampMenuPosition({ x: 100, y: 120, width: 200, height: 90, viewport }), {
    left: 100,
    top: 120,
  })
  // 贴右下角：翻转回视口内
  const flipped = clampMenuPosition({ x: 980, y: 790, width: 200, height: 90, viewport })
  assert.ok(flipped.left + 200 <= 1000)
  assert.ok(flipped.top + 90 <= 800)
  // 负坐标与外边距
  const clamped = clampMenuPosition({ x: -20, y: -20, width: 200, height: 90, viewport, margin: 8 })
  assert.equal(clamped.left, 8)
  assert.equal(clamped.top, 8)
})
