/**
 * “第 3 轮回答里选中一段话”的假 DOM 树 + 假选区。
 * 菜单测试与官方引用探测测试共用，免得同一套 closest 链写两遍。
 */
import { loadClient } from './harness.js'

const { lib } = loadClient().exports
const { ASSISTANT_SELECTOR, TURN_SELECTOR, ANCHOR_SELECTOR, SESSION_SELECTOR, STREAMING_SELECTOR, NON_QUOTE_SELECTOR } = lib

/**
 * 在 doc 上装一个可用的选区（覆盖 doc.getSelection）。
 * @param {object} doc - fakeDocument() 的产物。
 * @param {{turn?: string, session?: string, text?: string, selected?: string}} [overrides] - 覆盖默认值。
 * @returns {object} 树上各层的句柄，方便断言。
 */
export function selectionOnReply(doc, overrides = {}) {
  const turn = overrides.turn ?? '3'
  const session = overrides.session ?? 'session-x'
  const text = overrides.text ?? '被引用的那段话'
  const selected = overrides.selected ?? '被引用'
  const textNode = { nodeType: 3, nodeValue: text, parentElement: null }
  const body = {
    nodeType: 1,
    childNodes: [textNode],
    parentElement: null,
    hasAttribute: () => false,
    getAttribute: () => null,
    closest: () => null,
  }
  textNode.parentElement = body
  const wrapper = {
    nodeType: 1,
    childNodes: [body],
    getAttribute: (name) => (name === 'data-chat-turn' ? turn : null),
  }
  const view = {
    nodeType: 1,
    childNodes: [wrapper],
    getAttribute: (name) => (name === 'data-conversation-session' ? session : null),
  }
  const anchor = {
    nodeType: 1,
    childNodes: [view],
    getAttribute: (name) => (name === 'data-chat-anchor-key' ? 'anch' : null),
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
    startContainer: textNode,
    startOffset: 0,
    endContainer: textNode,
    endOffset: selected.length,
    getBoundingClientRect: () => ({ x: 1, y: 2 }),
  }
  doc.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    toString: () => selected,
    removeAllRanges() {},
  })
  return { textNode, body, wrapper, view, anchor, range }
}
