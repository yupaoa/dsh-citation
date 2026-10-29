/**
 * 右键菜单：不真的开浏览器，用最小假 DOM 验证“能开、能关、关了还能再开”。
 * 这条测试专门盯一个容易回归的坑：关闭菜单时不能把 contextmenu 监听一起摘掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, makeCtx } from './harness.js'

const { lib } = loadClient().exports
const { installContextMenu, ASSISTANT_SELECTOR, NON_QUOTE_SELECTOR } = lib
const { TURN_SELECTOR, ANCHOR_SELECTOR, SESSION_SELECTOR, STREAMING_SELECTOR } = lib

function fakeElement(doc, tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    dataset: {},
    style: {},
    attributes: {},
    childNodes: [],
    textContent: '',
    type: '',
    appendChild(child) {
      el.childNodes.push(child)
      return child
    },
    append(...kids) {
      for (const kid of kids) el.childNodes.push(kid)
    },
    remove() {
      for (const parent of [doc.body, doc.head]) {
        const at = parent.childNodes.indexOf(el)
        if (at >= 0) parent.childNodes.splice(at, 1)
      }
    },
    setAttribute(name, value) {
      el.attributes[name] = value
    },
    getAttribute(name) {
      return el.attributes[name] ?? null
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {
      doc.activeElement = el
    },
    getBoundingClientRect: () => ({ width: 180, height: 80, left: 0, top: 0, bottom: 0 }),
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] ?? null
    },
    querySelectorAll(selector) {
      const wanted = selector.replace(/^\./u, '')
      const out = []
      const walk = (node) => {
        for (const child of node.childNodes ?? []) {
          if (String(child.className).split(/\s+/u).includes(wanted)) out.push(child)
          walk(child)
        }
      }
      walk(el)
      return out
    },
    contains(other) {
      if (other === el) return true
      return el.childNodes.some((child) => child.contains?.(other) === true)
    },
    ownerDocument: doc,
  }
  return el
}

function fakeDocument() {
  const doc = {
    head: null,
    body: null,
    activeElement: null,
    listeners: [],
    addEventListener(type, handler) {
      doc.listeners.push({ type, handler })
    },
    removeEventListener(type, handler) {
      const at = doc.listeners.findIndex((l) => l.type === type && l.handler === handler)
      if (at >= 0) doc.listeners.splice(at, 1)
    },
    createElement: (tag) => fakeElement(doc, tag),
    querySelector: () => null,
    defaultView: { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
  }
  doc.head = fakeElement(doc, 'head')
  doc.body = fakeElement(doc, 'body')
  return doc
}

/** 一棵“第 3 轮回答”的假树 + 一个能开菜单的选区。 */
function selectionOnReply(doc) {
  const text = (value) => ({ nodeType: 3, nodeValue: value, parentElement: null })
  const first = text('被引用的那段话')
  const body = {
    nodeType: 1,
    childNodes: [first],
    parentElement: null,
    hasAttribute: () => false,
    getAttribute: () => null,
    closest: (selector) => (selector === ASSISTANT_SELECTOR ? body : null),
  }
  first.parentElement = body
  const wrapper = {
    nodeType: 1,
    childNodes: [body],
    getAttribute: (name) => (name === 'data-chat-turn' ? '3' : null),
    closest: () => wrapper,
  }
  const view = {
    nodeType: 1,
    childNodes: [wrapper],
    getAttribute: (name) => (name === 'data-conversation-session' ? 'session-x' : null),
    closest: () => view,
  }
  const anchor = {
    nodeType: 1,
    childNodes: [view],
    getAttribute: (name) => (name === 'data-chat-anchor-key' ? 'anch' : null),
    closest: () => anchor,
  }
  const chain = {
    [ASSISTANT_SELECTOR]: body,
    [TURN_SELECTOR]: wrapper,
    [ANCHOR_SELECTOR]: anchor,
    [SESSION_SELECTOR]: view,
    [STREAMING_SELECTOR]: null,
    [NON_QUOTE_SELECTOR]: null,
  }
  body.closest = (selector) => chain[selector] ?? null
  const range = {
    startContainer: first,
    startOffset: 0,
    endContainer: first,
    endOffset: 3,
    getBoundingClientRect: () => ({ x: 1, y: 2 }),
  }
  doc.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    toString: () => '被引用',
    removeAllRanges() {},
  })
  return { body, wrapper, view, anchor, chain, range }
}

function dispatch(doc, type, extra = {}) {
  const event = {
    type,
    clientX: 40,
    clientY: 60,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true
    },
    stopPropagation() {},
    ...extra,
  }
  for (const listener of doc.listeners.filter((l) => l.type === type)) {
    listener.handler(event)
  }
  return event
}

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
