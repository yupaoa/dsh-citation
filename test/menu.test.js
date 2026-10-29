/**
 * 右键菜单：不真的开浏览器，用最小假 DOM 验证“能开、能关、关了还能再开”。
 * 这条测试专门盯一个容易回归的坑：关闭菜单时不能把 contextmenu 监听一起摘掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, makeCtx } from './harness.js'
import { fakeDocument, dispatch } from './fake-dom.js'
import { selectionOnReply } from './reply-fixture.js'

const { lib } = loadClient().exports
const { installContextMenu } = lib

function menus(doc) {
  return doc.body.childNodes.filter((node) => node.className === 'dsh-citation-menu')
}

test('the menu opens on a reply selection and takes over the browser menu', () => {
  const doc = fakeDocument()
  const { ctx } = makeCtx()
  const dispose = installContextMenu(ctx, { document: doc })
  selectionOnReply(doc)

  const event = dispatch(doc, 'contextmenu')
  assert.equal(event.defaultPrevented, true)
  assert.equal(menus(doc).length, 1)
  const items = menus(doc)[0].querySelectorAll('.dsh-citation-menu-item')
  assert.deepEqual(
    items.map((item) => item.dataset.action),
    ['copy', 'add'],
  )
  dispose()
})

test('closing the menu keeps the plugin listening, so it can open again', () => {
  const doc = fakeDocument()
  const { ctx } = makeCtx()
  const dispose = installContextMenu(ctx, { document: doc })
  selectionOnReply(doc)

  dispatch(doc, 'contextmenu')
  assert.equal(menus(doc).length, 1)

  // 点在菜单外 -> 关
  dispatch(doc, 'pointerdown', { target: { notTheMenu: true } })
  assert.equal(menus(doc).length, 0)

  // 还能再开（回归点：close() 不该把 contextmenu 监听一起摘掉）
  dispatch(doc, 'contextmenu')
  assert.equal(menus(doc).length, 1)

  // Escape 也关
  dispatch(doc, 'keydown', { key: 'Escape' })
  assert.equal(menus(doc).length, 0)

  dispose()
  assert.equal(doc.listeners.length, 0, '卸载后不能留下任何监听')
})

test('without a valid selection the native menu is left alone', () => {
  const doc = fakeDocument()
  const { ctx } = makeCtx()
  const dispose = installContextMenu(ctx, { document: doc })
  doc.getSelection = () => null

  const event = dispatch(doc, 'contextmenu')
  assert.equal(event.defaultPrevented, false)
  assert.equal(menus(doc).length, 0)
  dispose()
})
