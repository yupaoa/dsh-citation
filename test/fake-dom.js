/**
 * 测试用的最小假 DOM：够装一个右键菜单和一只浮层，不引 jsdom。
 */

export function fakeElement(doc, tag) {
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
    removeAttribute(name) {
      delete el.attributes[name]
    },
    getAttribute(name) {
      return el.attributes[name] ?? null
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {
      doc.activeElement = el
    },
    getBoundingClientRect: () => ({ width: 180, height: 80, left: 10, top: 10, bottom: 40 }),
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] ?? null
    },
    querySelectorAll(selector) {
      const attribute = /^\[([^\]=]+)\]$/u.exec(selector)
      const wanted = selector.replace(/^\./u, '')
      const out = []
      const walk = (node) => {
        for (const child of node.childNodes ?? []) {
          if (attribute !== null) {
            if (child.attributes?.[attribute[1]] !== undefined) out.push(child)
          } else if (String(child.className).split(/\s+/u).includes(wanted)) {
            out.push(child)
          }
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

export function fakeDocument() {
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
    querySelector: (selector) => findOne(doc, selector),
    defaultView: { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
  }
  const findOne = (target, selector) => {
    const match = (node) => {
      if (selector.startsWith('.') && String(node.className).split(/\s+/u).includes(selector.slice(1))) return true
      if (selector.startsWith('[') && node.attributes?.[selector.slice(1, -1).split('=')[0].replace(/["']/gu, '')]) return true
      return false
    }
    for (const root of [doc.body, doc.head]) {
      const stack = [root]
      while (stack.length > 0) {
        const node = stack.pop()
        if (node === undefined || node === null) continue
        if (match(node)) return node
        stack.push(...(node.childNodes ?? []))
      }
    }
    return null
  }
  doc.head = fakeElement(doc, 'head')
  doc.body = fakeElement(doc, 'body')
  return doc
}

/** 派发一次假事件，返回事件对象（含 defaultPrevented）。 */
export function dispatch(doc, type, extra = {}) {
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
  for (const listener of doc.listeners.filter((l) => l.type === type)) listener.handler(event)
  return event
}
