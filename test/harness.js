/**
 * 测试装载器：第三方 DSH client half 是 `window.__ModuleLoader__.load({id, factory})`
 * 包裹的单文件模块（与 dsh-image-lite 同形），不是 ESM。这里读取源码、注入一个假的
 * window 与 require，取出工厂返回值——这就是 Node 侧能碰到的最真实入口。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))

function reactStub() {
  const nothing = () => null
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'Fragment') return 'Fragment'
        if (prop === 'createElement') return nothing
        if (prop === 'useState') return (init) => [typeof init === 'function' ? init() : init, () => {}]
        if (prop === 'useMemo') return (fn) => fn()
        if (prop === 'useCallback') return (fn) => fn
        if (prop === 'useRef') return (init) => ({ current: init })
        if (prop === 'useEffect' || prop === 'useLayoutEffect') return () => {}
        if (prop === 'version') return '19.0.0'
        return undefined
      },
    },
  )
}

/**
 * 载入 client.js 的模块工厂。
 * @param {{modules?: Record<string, unknown>}} options - 追加的模块注册表条目。
 * @returns {{id: string, exports: Record<string, any>}} 模块 id 与导出的工厂结果。
 */
export function loadClient({ modules = {} } = {}) {
  const source = readFileSync(CLIENT_PATH, 'utf8')
  let captured
  const fakeWindow = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
  }
  const registry = { react: reactStub(), ...modules }
  const requireModule = (name) => {
    if (Object.hasOwn(registry, name)) return registry[name]
    throw new Error(`[citation test] 模块注册表无法解析 "${name}"`)
  }
  // eslint-disable-next-line no-new-func
  const run = new Function('window', source)
  run(fakeWindow)
  if (captured === undefined) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')
  return { id: captured.id, exports: captured.factory(requireModule) }
}

/**
 * 造一个够用的 client 上下文桩，记录每次注册调用。
 * @param {Record<string, unknown>} services - 额外的服务名 → 实例。
 * @returns {{ctx: any, calls: any}} 上下文与注册记录。
 */
export function makeCtx(services = {}) {
  const calls = {
    locale: [],
    slots: [],
    slotInjections: [],
    userText: [],
    effects: [],
    listeners: [],
    sources: [],
  }
  const track = (bucket, value) => {
    calls[bucket].push(value)
    return () => {}
  }
  const registry = {
    locale: {
      register: (ns, dictionaries) => track('locale', { ns, dictionaries }),
      bind: () => (key, vars) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`),
      subscribe: () => () => {},
    },
    slots: {
      register: (spec, component) => track('slots', { spec, component }),
      registerFactory: (spec) => track('slots', { spec, kind: 'factory' }),
      inject: (name, fn) => {
        calls.slotInjections.push(name)
        return fn({})
      },
      subscribe: () => () => {},
    },
    uiConversation: {
      userText: {
        register: (rule) => track('userText', rule),
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({ current: undefined, byId: {} }),
        subscribe: () => () => {},
      },
      scope: () => undefined,
      sessionOf: () => undefined,
      binding: () => undefined,
    },
    inputTriggers: {
      registerSource: (source) => track('sources', source),
      serializeReference: async () => '',
    },
    conversation: {
      input: { for: () => undefined },
    },
    ...services,
  }
  const ctx = {
    get: (name) => registry[name],
    effect: (fn, label) => {
      calls.effects.push(label)
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    on: (name, listener) => {
      calls.listeners.push(name)
      return () => {}
    },
    inject: (names, fn) => {
      const result = fn(ctx)
      return result
    },
    locale: registry.locale,
    slots: registry.slots,
    uiConversation: registry.uiConversation,
    sessions: registry.sessions,
    registry,
  }
  return { ctx, calls }
}
