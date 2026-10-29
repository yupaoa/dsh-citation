/**
 * 与官方引用能力的共存：
 * 0.2.2-alpha.2 起官方 @deepseek-ai/dsh-message-quotes 注册了选区引用按钮，并给输入框加了
 * insertQuote。宿主已经有引用入口时，我们不能再往右键菜单里塞第二个「添加到对话」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, makeCtx } from './harness.js'
import { fakeDocument, dispatch } from './fake-dom.js'
import { selectionOnReply } from './reply-fixture.js'

const { lib } = loadClient().exports
const { installContextMenu, hasOfficialQuote } = lib

function menus(doc) {
  return doc.body.childNodes.filter((node) => node.className === 'dsh-citation-menu')
}

/** 造一个带/不带官方 insertQuote 的 ctx。 */
function ctxWithShell(shell) {
  const { ctx } = makeCtx()
  const service = { for: (scope) => (scope === undefined ? undefined : shell) }
  const base = ctx.get.bind(ctx)
  ctx.get = (name) => (name === 'conversation' ? { input: service } : base(name))
  ctx.sessions = { scope: (sessionId) => (typeof sessionId === 'string' ? { sessionId } : undefined) }
  return ctx
}

test('hasOfficialQuote is false when the shell has no insertQuote', () => {
  const ctx = ctxWithShell({ setDraft() {}, actions: {} })
  assert.equal(hasOfficialQuote(ctx, 'session-x'), false)
})

test('hasOfficialQuote detects insertQuote on the shell and on its actions', () => {
  assert.equal(hasOfficialQuote(ctxWithShell({ insertQuote() {} }), 'session-x'), true)
  assert.equal(hasOfficialQuote(ctxWithShell({ actions: { insertQuote() {} } }), 'session-x'), true)
})

test('hasOfficialQuote never throws on a hostile host', () => {
  const { ctx } = makeCtx()
  const broken = {
    get: () => ({
      input: {
        for() {
          throw new Error('boom')
        },
      },
    }),
    sessions: { scope: () => ({}) },
  }
  assert.equal(hasOfficialQuote(broken, 's'), false)
  assert.equal(hasOfficialQuote(ctx, 's'), false, '没有 conversation 服务时也是 false')
})

test('the menu is suppressed when the host already quotes selections', () => {
  const doc = fakeDocument()
  const ctx = ctxWithShell({ insertQuote() {} })
  const dispose = installContextMenu(ctx, { document: doc })
  selectionOnReply(doc)

  const event = dispatch(doc, 'contextmenu')
  assert.equal(menus(doc).length, 0, '不能出现第二个引用入口')
  assert.equal(event.defaultPrevented, false, '原生菜单要留给宿主与浏览器')
  dispose()
})

test('the menu still opens on hosts without the official feature', () => {
  const doc = fakeDocument()
  const ctx = ctxWithShell({ setDraft() {}, actions: {} })
  const dispose = installContextMenu(ctx, { document: doc })
  selectionOnReply(doc)

  const event = dispatch(doc, 'contextmenu')
  assert.equal(menus(doc).length, 1)
  assert.equal(event.defaultPrevented, true)
  dispose()
})
