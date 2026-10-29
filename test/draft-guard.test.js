/**
 * 回退对话守卫：dsh-rewind 把发送原文塞回输入框时，引用块要还原成胶囊而不是原始标记。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './harness.js'

const { lib } = loadClient().exports
const { rebuildCitationDraft, installDraftGuard, buildCitationBlock, interpolate, zh, citationRefId } = lib

const t = (key, vars) => interpolate(zh[key] ?? key, vars)

function citation(overrides = {}) {
  return { turn: 4, step: 0, anchor: 'a', session: 's', range: [10, 20], quote: '被引的一段', ...overrides }
}

/** 最小 SessionInputShell：只实现守卫用到的那几样。 */
function makeShell() {
  const state = { text: '', occurrences: [] }
  const shell = {
    state,
    actions: {
      captureInsertion: () => ({ start: state.text.length, end: state.text.length, draftRev: 1 }),
      insertText: (text) => {
        state.text += text
        return true
      },
    },
    setDraft: (draft) => {
      state.text = draft
      return true
    },
    insertReference: (ref) => {
      state.occurrences.push({ source: ref.source, ref: ref.ref, label: ref.label })
      state.text += '[chip]'
      return true
    },
    projection: {
      get occurrences() {
        return state.occurrences
      },
    },
  }
  return shell
}

test('a rewound draft is rebuilt as chips plus the user body', () => {
  const shell = makeShell()
  const one = citation()
  const text = `${buildCitationBlock([one])}\n\n我的问题`
  assert.equal(rebuildCitationDraft(text, shell, t), true)
  assert.equal(shell.state.occurrences.length, 1)
  assert.equal(shell.state.occurrences[0].ref, citationRefId(one))
  assert.equal(shell.state.text, '[chip]我的问题', '胶囊在前、正文在后，且不再有原始标记')
})

test('two citations are rebuilt in order', () => {
  const shell = makeShell()
  const a = citation({ turn: 4, range: [1, 5] })
  const b = citation({ turn: 9, range: [40, 44] })
  const text = `${buildCitationBlock([a, b])}\n\n问题`
  assert.equal(rebuildCitationDraft(text, shell, t), true)
  assert.deepEqual(
    shell.state.occurrences.map((o) => o.ref),
    [citationRefId(a), citationRefId(b)],
  )
})

test('a draft without a citation block is left completely alone', () => {
  const shell = makeShell()
  assert.equal(rebuildCitationDraft('普通草稿', shell, t), false)
  assert.equal(shell.state.text, '', '不该清空用户的草稿')
})

test('installDraftGuard rewrites the draft pushed by rewind and is removable', () => {
  const shell = makeShell()
  const service = { for: () => shell }
  const ctx = {
    get: (name) => (name === 'conversation' ? { input: service } : undefined),
    effect: () => {},
  }
  const one = citation()
  const dispose = installDraftGuard(ctx, t)
  // 守卫装在 service.for() 返回的 shell 上：宿主（含 dsh-rewind）都是这么拿的。
  const guarded = service.for()

  guarded.setDraft(`${buildCitationBlock([one])}\n\n回退后的问题`)
  assert.equal(shell.state.occurrences.length, 1)
  assert.equal(shell.state.text, '[chip]回退后的问题')

  // 普通写入不受影响，也不会二次重建
  guarded.setDraft('随手打的字')
  assert.equal(shell.state.text, '随手打的字')

  dispose()
  assert.equal(typeof service.for, 'function')
  guarded.setDraft(`${buildCitationBlock([one])}\n\n再来一次`)
  assert.match(shell.state.text, /我引用了以下/u, '卸载后不再改写草稿')
})

test('the guard never throws into the host when the shell is broken', () => {
  const service = { for: () => ({ setDraft: () => true }) }
  const ctx = { get: () => ({ input: service }), effect: () => {} }
  const dispose = installDraftGuard(ctx, t)
  const shell = service.for()
  assert.doesNotThrow(() => shell.setDraft(`${buildCitationBlock([citation()])}\n\n正文`))
  dispose()
})
