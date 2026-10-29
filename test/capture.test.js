/**
 * 选区捕获：从 DOM 选区判定“这是不是可以引用的一段回答”，并算出轮次与字符区间。
 * 用一棵手搓的假 DOM 跑，因为真正的风险在判定与偏移量，不在浏览器 API 本身。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './harness.js'

const { lib } = loadClient().exports
const {
  isEligible,
  captureSelection,
  projectQuoteText,
  ASSISTANT_SELECTOR,
  TURN_SELECTOR,
  ANCHOR_SELECTOR,
  SESSION_SELECTOR,
  STREAMING_SELECTOR,
  NON_QUOTE_SELECTOR,
} = lib

/**
 * 造一个假元素节点。`closest` 表由测试显式给出——真实浏览器里由选择器匹配得出，
 * 这里只关心“祖先链上有没有那个东西”。
 */
function element({ attrs = {}, children = [], closest = {} } = {}) {
  const node = {
    nodeType: 1,
    attrs,
    childNodes: children,
    parentElement: null,
    hasAttribute: (name) => Object.hasOwn(attrs, name),
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    closest: (selector) => closest[selector] ?? null,
  }
  for (const child of children) {
    if (child !== null && typeof child === 'object') child.parentElement = node
  }
  return node
}

/** 造一个假文本节点。 */
function textNode(value) {
  return { nodeType: 3, nodeValue: value, parentElement: null }
}

/**
 * 拼一棵“一条 assistant 回答”的树：turn=3、会话 session-x、锚点 a1b2c3d4。
 * @param {{streaming?: boolean, extraClosest?: Record<string, unknown>}} [options]
 */
function answerTree({ streaming = false, extraClosest = {} } = {}) {
  const first = textNode('第一段落。')
  const second = textNode('第二段落。')
  const body = element({
    attrs: { 'data-chat-flow-kind': 'assistant-step' },
    children: [first, second],
  })
  const wrapper = element({ attrs: { 'data-chat-turn': '3' }, children: [body] })
  const view = element({
    attrs: { 'data-conversation-session': 'session-x' },
    children: [wrapper],
  })
  const anchor = element({ attrs: { 'data-chat-anchor-key': 'a1b2c3d4' }, children: [view] })
  if (streaming) body.attrs['data-streaming'] = ''
  const closest = {
    [ASSISTANT_SELECTOR]: body,
    [TURN_SELECTOR]: wrapper,
    [ANCHOR_SELECTOR]: anchor,
    [SESSION_SELECTOR]: view,
    [STREAMING_SELECTOR]: null,
    [NON_QUOTE_SELECTOR]: null,
    ...extraClosest,
  }
  body.closest = (selector) => closest[selector] ?? null
  // 文本节点的祖先判定走父元素。
  for (const node of [first, second]) {
    Object.defineProperty(node, 'closest', { value: (selector) => closest[selector] ?? null })
  }
  return { body, wrapper, view, anchor, first, second, closest }
}

/** 造一个 document 桩，只有一个选区。 */
function docWithSelection(range, selectedText) {
  return {
    getSelection: () => ({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => selectedText,
    }),
  }
}

/** 造一个 range 桩。 */
function makeRange({ startContainer, startOffset, endContainer, endOffset, rect = { x: 10, y: 20 } }) {
  return {
    startContainer,
    startOffset,
    endContainer,
    endOffset,
    getBoundingClientRect: () => rect,
  }
}

test('isEligible accepts only a settlement of one settled assistant message', () => {
  const ok = {
    blank: false,
    sameBody: true,
    streaming: false,
    excluded: false,
    hasSession: true,
    hasTurn: true,
    validRange: true,
  }
  assert.equal(isEligible(ok), true)
  const rejects = [
    { blank: true },
    { sameBody: false },
    { streaming: true },
    { excluded: true },
    { hasSession: false },
    { hasTurn: false },
    { validRange: false },
  ]
  for (const patch of rejects) {
    assert.equal(isEligible({ ...ok, ...patch }), false, JSON.stringify(patch))
  }
})

test('captureSelection reads turn, session, anchor and offsets from the reply', () => {
  const tree = answerTree()
  const range = makeRange({
    startContainer: tree.first,
    startOffset: 0,
    endContainer: tree.second,
    endOffset: 3,
  })
  const snapshot = captureSelection(docWithSelection(range, '第一段落。第二段'))
  assert.notEqual(snapshot, null)
  assert.equal(snapshot.citation.turn, 3)
  assert.equal(snapshot.citation.session, 'session-x')
  assert.equal(snapshot.citation.anchor, 'a1b2c3d4')
  assert.deepEqual(snapshot.citation.range, [0, 8])
  assert.equal(snapshot.citation.quote, '第一段落。第二段')
  assert.equal(snapshot.text, '第一段落。第二段')
  assert.deepEqual(snapshot.rect, { x: 10, y: 20 })
})

test('a selection spanning two replies is refused, not clipped', () => {
  const left = answerTree()
  const right = answerTree()
  const range = makeRange({
    startContainer: left.first,
    startOffset: 0,
    endContainer: right.second,
    endOffset: 3,
  })
  assert.equal(captureSelection(docWithSelection(range, '跨消息')), null)
})

test('a reply that is still streaming is refused', () => {
  const tree = answerTree({ streaming: true })
  const range = makeRange({
    startContainer: tree.first,
    startOffset: 0,
    endContainer: tree.first,
    endOffset: 4,
  })
  assert.equal(captureSelection(docWithSelection(range, '第一段落')), null)
})

test('selections anchored inside a control are refused', () => {
  const tree = answerTree({ extraClosest: { [NON_QUOTE_SELECTOR]: {} } })
  const range = makeRange({
    startContainer: tree.first,
    startOffset: 0,
    endContainer: tree.first,
    endOffset: 4,
  })
  assert.equal(captureSelection(docWithSelection(range, '第一段落')), null)
})

test('a blank selection is refused', () => {
  const tree = answerTree()
  const range = makeRange({
    startContainer: tree.first,
    startOffset: 0,
    endContainer: tree.first,
    endOffset: 0,
  })
  assert.equal(captureSelection(docWithSelection(range, '   ')), null)
})

test('projectQuoteText skips excluded subtrees so offsets stay consistent', () => {
  const kept = textNode('保留')
  const dropped = textNode('按钮文字')
  const button = element({ attrs: {}, children: [dropped] })
  const body = element({ children: [kept, button] })
  const projection = projectQuoteText(body, {
    isExcluded: (node) => node === button,
  })
  assert.equal(projection.text, '保留')
  assert.equal(projection.spans.length, 1)
  assert.equal(projection.spans[0].node, kept)
})

test('a missing selection or a throwing document degrades to null', () => {
  assert.equal(captureSelection({ getSelection: () => null }), null)
  assert.equal(captureSelection({}), null)
  assert.equal(
    captureSelection({
      getSelection: () => {
        throw new Error('boom')
      },
    }),
    null,
  )
})
