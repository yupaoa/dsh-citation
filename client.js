/**
 * dsh-citation — 客户端半身。
 *
 * 划选 assistant 回复的一段文字 → 右键「添加到对话」→ 输入框里多出一个
 * 不可编辑的引用胶囊（悬停才显示被引原文）→ 发送时胶囊由 owner codec 展开成
 * 一段模型可读的引用块（第几轮、哪个字符区间、原文全文）→ 气泡里再折叠回胶囊。
 *
 * 本文件是第三方 client half 的标准形状：单文件、`window.__ModuleLoader__.load`
 * 包裹、导出 `apply` / `inject` / `lib`。纯逻辑挂在 `lib` 上，供 `node --test`
 * 直接消费（见 test/harness.js）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-citation',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    //#region 宿主 DOM 契约
    /**
     * assistant 正文节点的容器。宿主把每条 flow item 包在带 `data-chat-flow-kind`
     * 的元素里，`assistant-step` 就是模型这一段的正文（不含思考、工具、按钮）。
     */
    const ASSISTANT_SELECTOR = '[data-chat-flow-kind="assistant-step"]'
    /** 轮次所在的外层包装（同一轮的多条 flow item 共享一个 turn 值）。 */
    const TURN_SELECTOR = '[data-chat-turn]'
    /** 引用锚点键，用于同一轮内区分不同节点。 */
    const ANCHOR_SELECTOR = '[data-chat-anchor-key]'
    /** 会话视图容器，`data-conversation-session` 是会话 id。 */
    const SESSION_SELECTOR = '[data-conversation-session]'
    /** 输入框座位，用于把焦点还给 composer。 */
    const COMPOSER_SELECTOR = '[data-composer-seat]'
    /** 流式生成中的标记；命中的子树内容还会变，不能作为引用源。 */
    const STREAMING_SELECTOR = '[data-streaming]'
    /**
     * 不允许成为引用端点/引用内容的子树：控件、可编辑区、代码块工具条、
     * 思考过程。命中的选择一律放弃（宁可不出菜单，也不引一段错内容）。
     */
    const NON_QUOTE_SELECTOR = [
      'button',
      '[role="button"]',
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[data-code-block-banner]',
      '[data-variant="think"]',
    ].join(', ')
    //#endregion

    //#region 引用块协议
    /** 引用块头部（中文版）；`{n}` 是这一条消息里引用了几段。 */
    const CITATION_HEADER = '我引用了以下 {n} 条回复内容：'
    /** 引用块头部（英文版），解析时两种都认。 */
    const CITATION_HEADER_EN = 'I quoted {n} passage(s) from the earlier replies:'
    /** 头部行正则：必须占满消息开头的一整行，否则不算引用块。 */
    const CITATION_HEADER_RE =
      /^(?:我引用了以下 (\d+) 条回复内容|I quoted (\d+) passage(?:s)? from the earlier replies)[：:]\n/u
    /** 单条引用的开启标签；`y` 让它贴着游标匹配。 */
    const CITATION_OPEN_RE =
      /<citation turn="(\d+)" step="(-?\d+)" range="(\d+):(\d+)" anchor="([^"\n]*)" session="([^"\n]*)">\n<quote>/uy
    /** 单条引用的闭合片段。 */
    const CITATION_CLOSE = '</quote>\n</citation>'
    /** 引用原文的默认长度上限（约 8–10k token）；超出时头尾都留。 */
    const QUOTE_LIMIT = 20000

    /**
     * 转义引用原文。只转义会破坏解析的两个字符：反斜杠与左尖括号。
     * `>` 和 `&` 不转义——解析器按字面量切 `</quote>`，原文里已经不可能再出现
     * 左尖括号，模型读到 `&`、`>` 也比读到一堆实体更自然。
     * @param {string} text - 原文。
     * @returns {string} 可安全放进 `<quote>` 的文本。
     */
    function escapeQuote(text) {
      return String(text).replace(/\\/gu, '\\\\').replace(/</gu, '\\u003c')
    }

    /**
     * 还原被 {@link escapeQuote} 转义的原文。
     * @param {string} text - 协议里的文本。
     * @returns {string} 原文。
     */
    function unescapeQuote(text) {
      return String(text).replace(/\\(\\|u003c|u003e)/gu, (_whole, seq) =>
        seq === '\\' ? '\\' : seq === 'u003c' ? '<' : '>',
      )
    }

    /**
     * 属性值消毒：引用 id 不该带引号或换行，出现就丢掉，宁可变形也不破坏标签。
     * @param {unknown} value - 属性值。
     * @returns {string} 可放进双引号属性的文本。
     */
    function escapeAttribute(value) {
      return String(value ?? '').replace(/["\n\r]/gu, '')
    }

    /**
     * 把一条或多条引用编码成模型可读的引用块。
     * 每段都带轮次、字符区间、锚点与会话 id，模型据此知道“这是第几轮回答的哪一段”。
     * @param {Array<object>} items - 引用记录。
     * @returns {string} 引用块文本（不含与正文之间的空行）。
     */
    function buildCitationBlock(items) {
      if (!Array.isArray(items) || items.length === 0) return ''
      const header = CITATION_HEADER.replace('{n}', String(items.length))
      const blocks = items.map((item) => {
        const range = Array.isArray(item.range) ? item.range : [0, 0]
        return [
          `<citation turn="${Number(item.turn) || 0}" step="${Number(item.step) || 0}"`,
          ` range="${Number(range[0]) || 0}:${Number(range[1]) || 0}"`,
          ` anchor="${escapeAttribute(item.anchor)}" session="${escapeAttribute(item.session)}">`,
          `\n<quote>${escapeQuote(item.quote)}</quote>\n</citation>`,
        ].join('')
      })
      return `${header}\n${blocks.join('\n')}`
    }

    /**
     * 只解析**消息开头**的连续引用块，返回消费掉的长度与解析结果。
     * 用户自己打出来的巧合文本不会被误吞：头部行之后必须至少有一条完整的
     * `<citation>` 块才算数。
     * @param {string} text - 用户消息全文。
     * @returns {{length: number, items: Array<object>} | null} 前缀信息；不是引用块则为 null。
     */
    function splitCitationPrefix(text) {
      if (typeof text !== 'string' || text === '') return null
      const header = CITATION_HEADER_RE.exec(text)
      if (header === null) return null
      const items = []
      let cursor = header[0].length
      for (;;) {
        CITATION_OPEN_RE.lastIndex = cursor
        const open = CITATION_OPEN_RE.exec(text)
        if (open === null) break
        const quoteStart = cursor + open[0].length
        const closeAt = text.indexOf(CITATION_CLOSE, quoteStart)
        if (closeAt < 0) break
        items.push({
          turn: Number(open[1]),
          step: Number(open[2]),
          range: [Number(open[3]), Number(open[4])],
          anchor: open[5],
          session: open[6],
          quote: unescapeQuote(text.slice(quoteStart, closeAt)),
        })
        cursor = closeAt + CITATION_CLOSE.length
        if (text.startsWith('\n', cursor)) cursor += 1
      }
      if (items.length === 0) return null
      let end = cursor
      // 吃掉引用块与正文之间的分隔空行（最多两行），气泡里就不需要再 trim。
      while (end < text.length && text.startsWith('\n', end) && end - cursor < 2) end += 1
      return { length: end, items }
    }

    /**
     * 超长引用截断：保留前 75% 与后 25%，中间写明省略了多少字。
     * 头尾都留是为了让模型既看到引用的起点（谁、什么结论）也看到终点（结论落在哪）。
     * @param {string} text - 原文。
     * @param {number} [max] - 上限字符数。
     * @returns {{quote: string, clipped: boolean, omitted: number}} 截断结果。
     */
    function clipQuote(text, max = QUOTE_LIMIT) {
      const source = String(text ?? '')
      if (source.length <= max) return { quote: source, clipped: false, omitted: 0 }
      const headSize = Math.floor(max * 0.75)
      const tailSize = max - headSize
      const omitted = source.length - headSize - tailSize
      const mark = `\n…（引用过长，已省略 ${omitted} 字）…\n`
      return {
        quote: source.slice(0, headSize) + mark + source.slice(source.length - tailSize),
        clipped: true,
        omitted,
      }
    }
    //#endregion

    //#region 选区捕获
    /** 宿主用这些属性名承载轮次/锚点/会话；抽成常量便于宿主改版时一处替换。 */
    const TURN_ATTR = 'data-chat-turn'
    const ANCHOR_ATTR = 'data-chat-anchor-key'
    const SESSION_ATTR = 'data-conversation-session'
    const STREAMING_ATTR = 'data-streaming'

    /**
     * 一次选区能不能变成引用。全部条件都是“宁可不出菜单”的方向。
     * @param {{blank: boolean, sameBody: boolean, streaming: boolean, excluded: boolean,
     *   hasSession: boolean, hasTurn: boolean, validRange: boolean}} facts - 判定事实。
     * @returns {boolean} 是否可引用。
     */
    function isEligible(facts) {
      return (
        facts.blank === false &&
        facts.sameBody === true &&
        facts.streaming === false &&
        facts.excluded === false &&
        facts.hasSession === true &&
        facts.hasTurn === true &&
        facts.validRange === true
      )
    }

    /**
     * 取节点所属的元素（文本节点的父元素就是它的容器）。
     * @param {Node | null | undefined} node - 任意节点。
     * @returns {Element | null} 元素。
     */
    function elementOf(node) {
      if (node === null || node === undefined) return null
      if (node.nodeType === 1) return node
      return node.parentElement ?? null
    }

    /**
     * 真实 DOM 的排除判定：控件/可编辑区/思考块子树，以及 `user-select: none` 的父层。
     * @param {Element} element - 待判定元素。
     * @returns {boolean} 是否排除。
     */
    function defaultExcluded(element) {
      try {
        if (typeof element.closest === 'function' && element.closest(NON_QUOTE_SELECTOR) !== null) {
          return true
        }
        const view = element.ownerDocument?.defaultView
        const style = view?.getComputedStyle?.(element)
        return style?.userSelect === 'none' || style?.webkitUserSelect === 'none'
      } catch (_error) {
        return false
      }
    }

    /**
     * 把一棵子树拍平成“引用可见文本 + 每个文本节点的区间”。
     * 被排除的子树整段跳过，偏移量因此与用户看到的文字一致。
     * @param {Element} root - 回答正文的容器。
     * @param {{isExcluded?: (element: Element) => boolean}} [options] - 可选判定覆盖。
     * @returns {{text: string, spans: Array<{node: Node, start: number, end: number}>}} 投影。
     */
    function projectQuoteText(root, options = {}) {
      const isExcluded = typeof options.isExcluded === 'function' ? options.isExcluded : defaultExcluded
      const spans = []
      let text = ''
      const walk = (node) => {
        if (node === null || node === undefined) return
        if (node.nodeType === 3) {
          const value = node.nodeValue ?? ''
          if (value === '') return
          spans.push({ node, start: text.length, end: text.length + value.length })
          text += value
          return
        }
        if (node.nodeType !== 1) return
        if (node !== root && isExcluded(node)) return
        const children = node.childNodes ?? []
        for (const child of children) walk(child)
      }
      walk(root)
      return { text, spans }
    }

    /**
     * 在投影里找出“这个节点里的第一个文本区间”。
     * @param {Array<{node: Node, start: number, end: number}>} spans - 投影区间。
     * @param {Node} node - 子树根。
     * @param {'first' | 'last'} edge - 取头还是取尾。
     * @returns {{node: Node, start: number, end: number} | null} 命中的区间。
     */
    function spanEdge(spans, node, edge) {
      const inside = []
      const walk = (current) => {
        if (current === null || current === undefined) return
        const hit = spans.find((span) => span.node === current)
        if (hit !== undefined) {
          inside.push(hit)
          return
        }
        for (const child of current.childNodes ?? []) walk(child)
      }
      walk(node)
      if (inside.length === 0) return null
      return edge === 'first' ? inside[0] : inside[inside.length - 1]
    }

    /**
     * 把选区端点换算成投影里的字符偏移。
     * @param {{text: string, spans: Array<object>}} projection - 投影。
     * @param {Node} container - 端点所在节点。
     * @param {number} offset - 端点偏移。
     * @returns {number | null} 投影偏移；无法换算时 null。
     */
    function offsetInProjection(projection, container, offset) {
      if (container === null || container === undefined) return null
      if (container.nodeType === 3) {
        const hit = projection.spans.find((span) => span.node === container)
        if (hit === undefined) return null
        const value = String(container.nodeValue ?? '')
        const local = Math.max(0, Math.min(Number(offset) || 0, value.length))
        return hit.start + local
      }
      if (container.nodeType !== 1) return null
      const children = container.childNodes ?? []
      const index = Number(offset) || 0
      if (index < children.length) {
        for (let cursor = index; cursor < children.length; cursor += 1) {
          const edge = spanEdge(projection.spans, children[cursor], 'first')
          if (edge !== null) return edge.start
        }
        return projection.text.length
      }
      const tail = spanEdge(projection.spans, container, 'last')
      return tail === null ? (index === 0 ? 0 : null) : tail.end
    }

    /**
     * 把一个 range + 选中文本判定成引用快照。
     * @param {Range} range - 选区。
     * @param {string} selectedText - 浏览器给的选中文本。
     * @param {{isExcluded?: Function}} [options] - 可选判定覆盖。
     * @returns {{citation: object, rect: DOMRect | null, text: string} | null} 快照。
     */
    function describeSelection(range, selectedText, options = {}) {
      if (range === null || range === undefined) return null
      const startElement = elementOf(range.startContainer)
      const endElement = elementOf(range.endContainer)
      if (startElement === null || endElement === null) return null
      const body = startElement.closest?.(ASSISTANT_SELECTOR) ?? null
      const endBody = endElement.closest?.(ASSISTANT_SELECTOR) ?? null
      const sameBody = body !== null && body === endBody
      const streaming =
        startElement.closest?.(STREAMING_SELECTOR) !== null ||
        body?.hasAttribute?.(STREAMING_ATTR) === true
      const excluded =
        options.isExcluded !== undefined
          ? options.isExcluded(startElement) || options.isExcluded(endElement)
          : startElement.closest?.(NON_QUOTE_SELECTOR) !== null ||
            endElement.closest?.(NON_QUOTE_SELECTOR) !== null
      const view = body?.closest?.(SESSION_SELECTOR) ?? null
      const session = view?.getAttribute?.(SESSION_ATTR) ?? ''
      const turnRaw = body?.closest?.(TURN_SELECTOR)?.getAttribute?.(TURN_ATTR) ?? null
      const turn = Number(turnRaw)
      const anchor =
        body?.closest?.(ANCHOR_SELECTOR)?.getAttribute?.(ANCHOR_ATTR) ??
        body?.getAttribute?.(ANCHOR_ATTR) ??
        ''
      const projection = body === null ? { text: '', spans: [] } : projectQuoteText(body, options)
      const from = offsetInProjection(projection, range.startContainer, range.startOffset)
      const to = offsetInProjection(projection, range.endContainer, range.endOffset)
      const fallback = from !== null && to !== null ? projection.text.slice(from, to) : ''
      const quote = typeof selectedText === 'string' && selectedText !== '' ? selectedText : fallback
      const facts = {
        blank: quote.trim() === '',
        sameBody,
        streaming,
        excluded,
        hasSession: session !== '',
        hasTurn: Number.isSafeInteger(turn) && turn > 0,
        validRange: from !== null && to !== null && to > from,
      }
      if (!isEligible(facts)) return null
      return {
        citation: { turn, step: 0, anchor, session, range: [from, to], quote },
        rect: typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null,
        text: quote,
      }
    }

    /**
     * 从 document 的当前选区捕获一个引用快照。任何异常都退化为“没有选区”。
     * @param {Document} doc - 文档。
     * @param {{isExcluded?: Function}} [options] - 可选判定覆盖。
     * @returns {{citation: object, rect: DOMRect | null, text: string} | null} 快照。
     */
    function captureSelection(doc, options = {}) {
      try {
        const selection = doc?.getSelection?.()
        if (selection === null || selection === undefined) return null
        if (selection.rangeCount === 0 || selection.isCollapsed === true) return null
        const range = selection.getRangeAt(0)
        return describeSelection(range, selection.toString(), options)
      } catch (_error) {
        return null
      }
    }
    //#endregion

    //#region 引用源
    /** 引用源在 reference registry 里的名字（提交时按名字找 codec）。 */
    const CITATION_SOURCE = 'citation'
    /** 承载引用源的触发字符：引用胶囊必须挂在某个 trigger 下才能注册。 */
    const CITATION_TRIGGER = '@'

    /**
     * UTF-8 文本 → base64url。胶囊 id 要放进 draft 文本与持久化快照，
     * 所以只用 `[A-Za-z0-9_-]`。
     * @param {string} text - 任意文本。
     * @returns {string} base64url。
     */
    function encodeBase64Url(text) {
      const bytes = new TextEncoder().encode(String(text))
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
    }

    /**
     * base64url → UTF-8 文本。
     * @param {string} text - base64url。
     * @returns {string} 解出的文本。
     */
    function decodeBase64Url(text) {
      const padded = String(text).replace(/-/gu, '+').replace(/_/gu, '/')
      const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }

    /**
     * 一条引用记录 → 胶囊 id。整条记录都塞进 id 里：胶囊不依赖任何内存表，
     * 刷新页面、换会话、甚至别的窗口恢复草稿之后都能自己展开。
     * @param {object} citation - 引用记录。
     * @returns {string} 胶囊 id。
     */
    function citationRefId(citation) {
      // 固定字段顺序：同一个引用不管是新捕获的还是从协议块解析回来的，id 必须一致，
      // 否则“重复引用”判定会失灵（JSON.stringify 按插入顺序输出）。
      const canonical = {
        turn: citation?.turn ?? 0,
        step: citation?.step ?? 0,
        anchor: citation?.anchor ?? '',
        session: citation?.session ?? '',
        range: [citation?.range?.[0] ?? 0, citation?.range?.[1] ?? 0],
        quote: citation?.quote ?? '',
      }
      return encodeBase64Url(JSON.stringify(canonical))
    }

    /**
     * 胶囊 id → 引用记录；坏数据返回 null（从不抛，引擎侧不该因为脏草稿崩掉）。
     * @param {unknown} id - 胶囊 id。
     * @returns {object | null} 引用记录。
     */
    function citationFromRefId(id) {
      if (typeof id !== 'string' || id === '') return null
      try {
        const parsed = JSON.parse(decodeBase64Url(id))
        if (parsed === null || typeof parsed !== 'object') return null
        if (typeof parsed.quote !== 'string') return null
        if (!Array.isArray(parsed.range) || parsed.range.length !== 2) return null
        return parsed
      } catch (_error) {
        return null
      }
    }

    /**
     * 把一条引用展开成模型读的文本。这是 chip codec 的正体：宿主在提交前调用，
     * 展开后的文本会顶替 draft 里那段占位文字。
     * @param {object} citation - 引用记录。
     * @returns {Promise<string>} 引用块文本。
     */
    async function serializeCitation(citation) {
      const { quote } = clipQuote(citation.quote)
      return buildCitationBlock([{ ...citation, quote }])
    }

    /**
     * draft 里的占位文字：用户复制整段草稿时看到的是它，而不是几千字原文。
     * @param {object} citation - 引用记录。
     * @returns {string} 占位文字。
     */
    function citationChipText(citation) {
      return `@引用·第${Number(citation?.turn) || 0}轮`
    }

    /**
     * 构造 reference source。`hooks.open` 让胶囊被点击时能跳回原文。
     * @param {{open?: (reference: {ref: string}) => boolean}} [hooks] - 可选回调。
     * @returns {object} inputTriggers.registerSource 接受的源。
     */
    function createCitationSource(hooks = {}) {
      return {
        trigger: CITATION_TRIGGER,
        name: CITATION_SOURCE,
        // 宿主的 @ 菜单会对每个 '@' 源无条件调用 candidates()，缺了它会让 @ 提及整块报错。
        // 引用不需要候选列表（内容来自划选），所以这里回空数组，只占位不出行。
        candidates: async () => [],
        codec: {
          clipboardText: citationChipText,
          serialize: async (ref) => {
            const citation = citationFromRefId(ref)
            if (citation === null) throw new Error('引用数据损坏，无法展开')
            return serializeCitation(citation)
          },
        },
        openReference: (_session, reference) => {
          try {
            return hooks.open?.(reference) === true
          } catch (_error) {
            return false
          }
        },
        onPick: () => undefined,
      }
    }
    //#endregion

    //#region 插入
    /** 一条消息里最多放几段引用：再多就是在拿上下文换便利。 */
    const MAX_CITATIONS = 5

    /**
     * 胶囊上的文案：轮次 + 字数，让用户一眼看出自己引的是哪一段。
     * @param {object} citation - 引用记录。
     * @param {(key: string, vars?: Record<string, unknown>) => string} t - 翻译函数。
     * @returns {{label: string, title: string}} 胶囊展示文案。
     */
    function describeCitation(citation, t) {
      const count = String(citation?.quote ?? '').length
      return {
        label: t('chip.label', { turn: citation?.turn ?? 0, count }),
        title: t('chip.title', { turn: citation?.turn ?? 0 }),
      }
    }

    /**
     * 把一条引用插进输入框。顺序：真胶囊 → 位置文本（降级）→ 失败。
     * 全程不抛：失败只是一种可报告的结果，不能连累 UI。
     * @param {any} ctx - client 根上下文。
     * @param {object} citation - 引用记录。
     * @param {{t?: Function}} [options] - 翻译函数。
     * @returns {{ok: boolean, mode?: 'chip' | 'text', reason?: string}} 结果。
     */
    function insertCitation(ctx, citation, options = {}) {
      if (ctx === undefined || ctx === null) return { ok: false, reason: 'no-ctx' }
      const t = typeof options.t === 'function' ? options.t : (key) => key
      try {
        const scope = ctx.sessions?.scope?.(citation?.session)
        if (scope === undefined || scope === null) return { ok: false, reason: 'no-session' }
        const input = ctx.get('conversation')?.input?.for?.(scope)
        if (input === undefined || input === null) return { ok: false, reason: 'no-input' }
        const actions = input.actions
        const capture = actions?.captureInsertion
        if (typeof capture !== 'function') return { ok: false, reason: 'no-capture' }
        // span 必须来自 captureInsertion：它带着当前 draftRev，insertReference 会拿它做 CAS。
        const span = capture.call(actions)
        const descriptor = describeCitation(citation, t)
        // 输入框里的胶囊只暴露文字，先把 "文字 -> 引用" 记下来，悬停才查得到原文。
        rememberChip(descriptor.label, citation)
        const ref = {
          source: CITATION_SOURCE,
          ref: citationRefId(citation),
          label: descriptor.label,
          appearance: 'session',
          clipboardText: citationChipText(citation),
        }
        // 同一个 draft 里已有的引用：重复的那段不再插，超过上限也不再插。
        const occurrences = input.projection?.occurrences ?? input.state?.getSnapshot?.()?.occurrences
        const list = Array.isArray(occurrences) ? occurrences : []
        if (list.some((item) => item?.source === CITATION_SOURCE && item?.ref === ref.ref)) {
          return { ok: false, reason: 'duplicate' }
        }
        if (list.filter((item) => item?.source === CITATION_SOURCE).length >= MAX_CITATIONS) {
          return { ok: false, reason: 'too-many' }
        }
        if (typeof input.insertReference === 'function' && input.insertReference(ref, span) === true) {
          return { ok: true, mode: 'chip' }
        }
        const marker = `${t('chip.degraded', { turn: citation?.turn ?? 0, from: citation?.range?.[0] ?? 0, to: citation?.range?.[1] ?? 0 })} `
        if (typeof actions.insertText === 'function' && actions.insertText(marker, span) === true) {
          return { ok: true, mode: 'text' }
        }
        return { ok: false, reason: 'rejected' }
      } catch (error) {
        return { ok: false, reason: 'error', error }
      }
    }
    //#endregion

    //#region 草稿守卫（回退对话时把协议块还原成胶囊）
    /** 协议头的前缀，用来一眼认出“这段草稿里还躺着给模型的引用块”。 */
    const CITATION_HEADER_PREFIX = '我引用了以下'

    /**
     * 把一段含引用块的草稿重建为「胶囊 + 正文」。
     * 只在块位于开头时动手（其它情况一律不碰，避免误伤用户手写的文字）。
     * @param {string} text - 草稿全文（通常是回退对话塞回来的提交原文）。
     * @param {object} shell - SessionInputShell。
     * @param {(key: string, vars?: Record<string, unknown>) => string} t - 翻译函数。
     * @returns {boolean} 是否重建成功。
     */
    function rebuildCitationDraft(text, shell, t) {
      if (typeof text !== 'string' || shell === null || shell === undefined) return false
      const prefix = splitCitationPrefix(text)
      if (prefix === null) return false
      const actions = shell.actions
      const insertReference = shell.insertReference
      if (typeof insertReference !== 'function') return false
      if (typeof actions?.captureInsertion !== 'function') return false
      const body = text.slice(prefix.length)
      if (shell.setDraft('') === false) return false
      for (const item of prefix.items) {
        const span = actions.captureInsertion()
        const descriptor = describeCitation(item, t)
        rememberChip(descriptor.label, item)
        const ref = {
          source: CITATION_SOURCE,
          ref: citationRefId(item),
          label: descriptor.label,
          appearance: 'session',
          clipboardText: citationChipText(item),
        }
        if (insertReference.call(shell, ref, span) !== true) return false
      }
      if (body !== '') {
        if (typeof actions.insertText !== 'function') return false
        if (actions.insertText(body, actions.captureInsertion()) !== true) return false
      }
      return true
    }

    /**
     * 包住 conversation.input.for(scope) 返回的 shell.setDraft：
     * dsh-rewind 回退对话时会把“当时发送的原文”整段塞回输入框，而那段文本里带着
     * 给模型看的引用块。这里在写入之后把它还原成胶囊，用户看到的是折叠态而不是原始标记。
     * @param {any} ctx - client 根上下文。
     * @param {(key: string, vars?: Record<string, unknown>) => string} t - 翻译函数。
     * @returns {() => void} 清理函数。
     */
    function installDraftGuard(ctx, t) {
      const service = ctx.get('conversation')?.input
      if (service === undefined || service === null || typeof service.for !== 'function') return () => {}
      const originalFor = service.for
      const wrapped = new WeakSet()
      const patchedShells = []
      let rebuilding = false
      service.for = function patched(scope) {
        const shell = originalFor.call(this, scope)
        if (shell === null || shell === undefined || typeof shell !== 'object') return shell
        if (wrapped.has(shell)) return shell
        const originalSetDraft = shell.setDraft
        if (typeof originalSetDraft !== 'function') return shell
        wrapped.add(shell)
        patchedShells.push([shell, originalSetDraft])
        shell.setDraft = function guardedSetDraft(draft, ...rest) {
          const result = originalSetDraft.call(this, draft, ...rest)
          if (rebuilding || typeof draft !== 'string' || !draft.includes(CITATION_HEADER_PREFIX)) {
            return result
          }
          rebuilding = true
          try {
            const ok = rebuildCitationDraft(draft, this, t)
            if (!ok) {
              // 还原失败就退一步：至少别让原始标记留在输入框里。
              const prefix = splitCitationPrefix(draft)
              if (prefix !== null) originalSetDraft.call(this, draft.slice(prefix.length))
            }
          } catch (_error) {
            // 守卫本身绝不能让 setDraft 抛给宿主
          } finally {
            rebuilding = false
          }
          return result
        }
        return shell
      }
      return () => {
        service.for = originalFor
        for (const [shell, original] of patchedShells.splice(0)) {
          try {
            shell.setDraft = original
          } catch (_error) {
            // shell 可能已经销毁
          }
        }
      }
    }
    //#endregion

    //#region 提示与浮层
    /** 记住 "胶囊文案 -> 引用" ：输入框里的胶囊只暴露文字，靠它反查原文。 */
    const chipIndex = new Map()

    /**
     * 记一条胶囊文案到引用的映射（只保留最近 50 条，够用又不涨内存）。
     * @param {string} label - 胶囊上显示的文案。
     * @param {object} citation - 对应引用。
     */
    function rememberChip(label, citation) {
      if (typeof label !== 'string' || label === '') return
      chipIndex.delete(label)
      chipIndex.set(label, citation)
      while (chipIndex.size > 50) {
        const oldest = chipIndex.keys().next().value
        chipIndex.delete(oldest)
      }
    }

    /**
     * 按胶囊文案反查引用（输入框里的胶囊 DOM 只带文字，不带 ref）。
     * @param {string} text - 胶囊元素的可见文字。
     * @returns {object | null} 命中的引用。
     */
    function findChipCitation(text) {
      if (typeof text !== 'string' || text === '') return null
      const flat = text.replace(/\s+/gu, '')
      for (const [label, citation] of chipIndex) {
        if (flat.includes(label.replace(/\s+/gu, ''))) return citation
      }
      return null
    }

    /**
     * 底部居中的小提示，2.2 秒自己消失。
     * 不用宿主 input.notify：那是粘性提示，加完引用会一直挂在输入框上方。
     * @param {Document} doc - 文档。
     * @param {string} text - 提示文字。
     */
    function showToast(doc, text) {
      if (doc === null || text === '') return
      injectStyles(doc)
      let el = doc.querySelector('.dsh-citation-toast')
      if (el === null) {
        el = doc.createElement('div')
        el.className = 'dsh-citation-toast'
        el.setAttribute('role', 'status')
        doc.body.appendChild(el)
      }
      el.textContent = text
      el.dataset.open = 'true'
      el.__closeAt = Date.now() + 2200
      const stamp = el.__closeAt
      if (el.__timer !== undefined) clearTimeout(el.__timer)
      el.__timer = setTimeout(() => {
        if (el.__closeAt !== stamp) return
        el.dataset.open = 'false'
      }, 2200)
      // Node（测试）里让计时器不要拖住进程；浏览器里没有 unref。
      el.__timer?.unref?.()
    }

    /**
     * 在某个元素旁边弹出原文浮层（只读、可选中复制）。
     * @param {Document} doc - 文档。
     * @param {Element} anchor - 悬停的胶囊元素。
     * @param {Array<{heading: string, quote: string}>} entries - 展示条目。
     * @returns {() => void} 关闭函数。
     */
    function openQuotePopover(doc, anchor, entries) {
      if (doc === null || anchor === null || !Array.isArray(entries) || entries.length === 0) return () => {}
      injectStyles(doc)
      // 宿主自己也挂了 title，会和我们的浮层一起弹出来：先摘掉，关的时候还回去。
      const titled = []
      for (const node of [anchor, ...anchor.querySelectorAll?.('[title]') ?? []]) {
        const value = node.getAttribute?.('title')
        if (value !== null && value !== undefined) {
          titled.push([node, value])
          node.removeAttribute('title')
        }
      }
      const popover = doc.createElement('div')
      popover.className = 'dsh-citation-popover'
      for (const entry of entries) {
        const head = doc.createElement('span')
        head.className = 'dsh-citation-popover-head'
        head.textContent = entry.heading
        const body = doc.createElement('div')
        body.textContent = entry.quote
        popover.append(head, body)
      }
      doc.body.appendChild(popover)
      const rect = anchor.getBoundingClientRect?.() ?? { left: 0, bottom: 0, width: 0, height: 0 }
      const box = popover.getBoundingClientRect()
      const view = { width: doc.defaultView?.innerWidth ?? 0, height: doc.defaultView?.innerHeight ?? 0 }
      const placed = clampMenuPosition({
        x: rect.left,
        y: rect.bottom + 6,
        width: box.width,
        height: box.height,
        viewport: view,
      })
      popover.style.left = `${placed.left}px`
      popover.style.top = `${placed.top}px`
      let closed = false
      return () => {
        if (closed) return
        closed = true
        popover.remove()
        for (const [node, value] of titled) {
          try {
            node.setAttribute('title', value)
          } catch (_error) {
            // 元素可能已经被 React 换掉
          }
        }
      }
    }

    /**
     * 输入框里的胶囊悬停显示原文。
     * 宿主的引用胶囊只暴露 label，所以用 chipIndex 反查（本页插入过的都能查到）。
     * @param {any} ctx - client 根上下文。
     * @param {(key: string, vars?: Record<string, unknown>) => string} t - 翻译函数。
     * @param {{document?: Document}} [options] - 文档覆盖（测试用）。
     * @returns {() => void} 清理函数。
     */
    function installChipHover(ctx, t, options = {}) {
      const doc = options.document ?? (typeof document === 'undefined' ? null : document)
      if (doc === null || typeof doc.addEventListener !== 'function') return () => {}
      let close = null
      const holderOf = (target) => {
        try {
          return target?.closest?.('[data-lexical-decorator="true"]') ?? null
        } catch (_error) {
          return null
        }
      }
      const onOver = (event) => {
        const holder = holderOf(event.target)
        if (holder === null) return
        const citation = findChipCitation(String(holder.textContent ?? ''))
        if (citation === null) return
        if (close !== null) close()
        close = openQuotePopover(doc, holder, describeBlock([citation], t).entries)
      }
      const onOut = (event) => {
        if (holderOf(event.target) === null) return
        if (close !== null) {
          close()
          close = null
        }
      }
      doc.addEventListener('pointerover', onOver, true)
      doc.addEventListener('pointerout', onOut, true)
      return () => {
        doc.removeEventListener('pointerover', onOver, true)
        doc.removeEventListener('pointerout', onOut, true)
        if (close !== null) close()
        close = null
      }
    }
    //#endregion

    //#region 右键菜单
    /** 菜单位置的内边距，避免贴边。 */
    const MENU_MARGIN = 8

    /**
     * 把菜单夹在视口里；贴边时向内收，而不是翻到屏幕外。
     * @param {{x: number, y: number, width: number, height: number,
     *   viewport: {width: number, height: number}, margin?: number}} input - 期望位置与尺寸。
     * @returns {{left: number, top: number}} 最终坐标。
     */
    function clampMenuPosition({ x, y, width, height, viewport, margin = MENU_MARGIN }) {
      const maxLeft = Math.max(margin, viewport.width - width - margin)
      const maxTop = Math.max(margin, viewport.height - height - margin)
      return {
        left: Math.min(Math.max(x, margin), maxLeft),
        top: Math.min(Math.max(y, margin), maxTop),
      }
    }

    /**
     * 复制一段文字；优先异步剪贴板，失败退回 execCommand（老内核/无权限时）。
     * @param {Document} doc - 文档。
     * @param {string} text - 要复制的文字。
     * @returns {Promise<boolean>} 是否复制成功。
     */
    async function copyText(doc, text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch (_error) {
        // 落到 execCommand
      }
      try {
        const area = doc.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        doc.body.appendChild(area)
        area.select()
        const ok = doc.execCommand?.('copy') === true
        area.remove()
        return ok
      } catch (_error) {
        return false
      }
    }

    /**
     * 把焦点还给输入框（插入之后用户一般想立刻接着打字）。
     * @param {Document} doc - 文档。
     */
    function focusComposer(doc) {
      try {
        const seat = doc.querySelector(COMPOSER_SELECTOR)
        const editable =
          seat?.querySelector('[contenteditable="true"]') ??
          doc.querySelector(`${COMPOSER_SELECTOR} [contenteditable="true"]`)
        editable?.focus?.()
      } catch (_error) {
        // 焦点是锦上添花
      }
    }

    /**
     * 装右键菜单：只在“选中的是某一条已完成的回答”时接管 contextmenu，
     * 其它情况一律放行原生菜单（用户仍然能复制、搜索、翻译）。
     * @param {any} ctx - client 根上下文。
     * @param {{document?: Document}} [options] - 文档覆盖（测试用）。
     * @returns {() => void} 清理函数。
     */
    /**
     * 宿主是否已经自带引用能力。
     * 从 `0.2.2-alpha.2` 起官方 `@deepseek-ai/dsh-message-quotes` 给输入框加了 `insertQuote`，
     * 并在选区上注册了自己的引用按钮；此时我们不再插自己的菜单项，免得右键里出现两个“引用”。
     * 探测失败一律当成“没有”，不要因为别人改版就没收我们的功能。
     * @param {any} ctx - client 根上下文。
     * @param {string} sessionId - 选区所在的会话 id。
     * @returns {boolean} 宿主是否已提供官方引用入口。
     */
    function hasOfficialQuote(ctx, sessionId) {
      try {
        const input = ctx.get('conversation')?.input
        const scope = ctx.sessions?.scope?.(sessionId)
        if (scope === undefined || scope === null || typeof input?.for !== 'function') return false
        const shell = input.for(scope)
        return typeof shell?.insertQuote === 'function' || typeof shell?.actions?.insertQuote === 'function'
      } catch (_error) {
        return false
      }
    }

    function installContextMenu(ctx, options = {}) {
      const doc = options.document ?? (typeof document === 'undefined' ? null : document)
      if (doc === null || typeof doc.addEventListener !== 'function') return () => {}
      injectStyles(doc)
      const t = translator(ctx)
      let menu = null
      let pending = null
      // transient：只属于当前这一次菜单的监听（关菜单就撤）；
      // permanent：插件级的监听（只有卸载才撤）。两者绝不能混在一个数组里，
      // 否则第一次关菜单就会把 contextmenu 自己摘掉，菜单从此再也打不开。
      const transient = []
      const permanent = []

      const track = (bucket, target, type, handler, opts) => {
        target.addEventListener(type, handler, opts)
        bucket.push(() => target.removeEventListener(type, handler, opts))
      }
      const listen = (target, type, handler, opts) => track(transient, target, type, handler, opts)

      const close = () => {
        for (const dispose of transient.splice(0)) dispose()
        if (menu !== null) {
          menu.remove()
          menu = null
        }
        pending = null
      }

      const act = async (action) => {
        const snapshot = pending
        if (snapshot === null) {
          close()
          return
        }
        close()
        if (action === 'copy') {
          await copyText(doc, snapshot.text)
          return
        }
        const result = insertCitation(ctx, snapshot.citation, { t })
        if (result.ok === true) {
          // 自己的小提示，2.2 秒自动消失：宿主 input.notify 是粘性提示，会一直挂在输入框上。
          showToast(doc, t(result.mode === 'text' ? 'notice.insertDegraded' : 'notice.inserted'))
          try {
            doc.getSelection()?.removeAllRanges?.()
          } catch (_error) {
            // 选区清不掉也无所谓
          }
          focusComposer(doc)
          return
        }
        if (result.reason === 'duplicate') {
          showToast(doc, t('notice.duplicate'))
          return
        }
        if (result.reason === 'too-many') {
          showToast(doc, t('error.tooMany', { max: MAX_CITATIONS }))
          return
        }
        showToast(doc, t('error.insertFailed'))
      }

      const openMenu = (snapshot, point) => {
        close()
        pending = snapshot
        menu = doc.createElement('div')
        menu.className = 'dsh-citation-menu'
        menu.setAttribute('role', 'menu')
        menu.setAttribute('aria-label', t('menu.label'))
        const items = [
          { action: 'copy', label: t('menu.copy') },
          { action: 'add', label: t('menu.addToConversation') },
        ]
        for (const item of items) {
          const button = doc.createElement('button')
          button.type = 'button'
          button.className = 'dsh-citation-menu-item'
          button.setAttribute('role', 'menuitem')
          button.dataset.action = item.action
          button.textContent = item.label
          button.addEventListener('pointerdown', (event) => event.preventDefault())
          button.addEventListener('click', () => {
            void act(item.action)
          })
          menu.appendChild(button)
        }
        menu.style.position = 'fixed'
        menu.style.visibility = 'hidden'
        doc.body.appendChild(menu)
        const box = menu.getBoundingClientRect()
        const view = { width: doc.defaultView?.innerWidth ?? 0, height: doc.defaultView?.innerHeight ?? 0 }
        if (view.width === 0 || view.height === 0) {
          view.width = box.width + point.x + MENU_MARGIN
          view.height = box.height + point.y + MENU_MARGIN
        }
        const placed = clampMenuPosition({
          x: point.x,
          y: point.y,
          width: box.width,
          height: box.height,
          viewport: view,
        })
        menu.style.left = `${placed.left}px`
        menu.style.top = `${placed.top}px`
        menu.style.visibility = 'visible'
        menu.querySelector('.dsh-citation-menu-item')?.focus?.()

        listen(doc, 'pointerdown', (event) => {
          try {
            // contains() 对非 Node 会抛，正好当成“点在菜单外”。
            if (menu !== null && typeof menu.contains === 'function' && menu.contains(event.target)) return
          } catch (_error) {
            // 落到下面的 close()
          }
          close()
        }, true)
        listen(doc, 'keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
            return
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          const buttons = [...(menu?.querySelectorAll('.dsh-citation-menu-item') ?? [])]
          if (buttons.length === 0) return
          const at = buttons.indexOf(doc.activeElement)
          const step = event.key === 'ArrowDown' ? 1 : -1
          buttons[(at + step + buttons.length) % buttons.length].focus()
        }, true)
        listen(doc.defaultView ?? doc, 'scroll', close, true)
        listen(doc.defaultView ?? doc, 'resize', close, true)
      }

      track(
        permanent,
        doc,
        'contextmenu',
        (event) => {
          const snapshot = captureSelection(doc)
          if (snapshot === null) {
            close()
            return
          }
          // 官方已有引用入口 -> 让出右键菜单，交回浏览器原生菜单（宿主自己的引用按钮在选区旁）。
          if (hasOfficialQuote(ctx, snapshot.citation.session)) {
            close()
            return
          }
          event.preventDefault()
          event.stopPropagation()
          openMenu(snapshot, { x: event.clientX, y: event.clientY })
        },
        true,
      )

      return () => {
        close()
        for (const dispose of permanent.splice(0)) dispose()
      }
    }
    //#endregion

    //#region 样式
    /** 注入一次全局样式；只用主题变量，跟随明暗主题。 */
    function injectStyles(doc) {
      try {
        if (doc.querySelector('style[data-dsh-citation]') !== null) return
        const style = doc.createElement('style')
        style.dataset.dshCitation = '1'
        style.textContent = CITATION_CSS
        doc.head.appendChild(style)
      } catch (_error) {
        // 样式失败也不该拦住功能
      }
    }

    /** 菜单、胶囊、浮层的样式。颜色全部走宿主的主题变量。 */
    const CITATION_CSS = [
      '.dsh-citation-menu{position:fixed;z-index:2147483000;min-width:168px;padding:4px;',
      'border-radius:10px;border:1px solid rgba(255,255,255,.14);',
      'background:#1c1c20;box-shadow:0 12px 34px rgba(0,0,0,.5);color:#f2f2f5;',
      'font-size:13px;display:flex;flex-direction:column;gap:2px}',
      '.dsh-citation-menu-item{appearance:none;border:0;background:transparent;text-align:left;',
      'padding:7px 10px;border-radius:7px;cursor:pointer;color:#f2f2f5;',
      'font:inherit;line-height:1.3}',
      '.dsh-citation-menu-item:hover,.dsh-citation-menu-item:focus-visible{',
      'background:rgba(255,255,255,.1);outline:none}',
      '.dsh-citation-menu-item[data-action="add"]{color:#7aa2ff}',
      '.dsh-citation-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;',
      'padding:1px 6px;border-radius:6px;cursor:pointer;vertical-align:baseline;',
      'background:var(--dsw-alias-state-business-tertiary,rgba(47,107,255,.1));',
      'color:var(--dsw-alias-state-business-primary,#2f6bff);font-size:inherit;line-height:1.5}',
      '.dsh-citation-chip[data-open="true"]{outline:1px solid currentColor}',
      '.dsh-citation-popover{position:fixed;z-index:2147483000;max-width:min(560px,86vw);',
      'max-height:40vh;overflow:auto;padding:10px 12px;border-radius:10px;',
      'border:1px solid rgba(255,255,255,.14);',
      'background:#1c1c20;box-shadow:0 14px 36px rgba(0,0,0,.5);color:#f2f2f5;',
      'font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;',
      'user-select:text}',
      '.dsh-citation-popover-head{display:block;margin-bottom:6px;opacity:.72;font-size:11px}',
      '.dsh-citation-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:104px;',
      'z-index:2147483000;max-width:70vw;padding:8px 14px;border-radius:999px;',
      'background:rgba(28,28,32,.96);color:#f2f2f5;font-size:12.5px;line-height:1.4;',
      'box-shadow:0 10px 28px rgba(0,0,0,.42);pointer-events:none;',
      'opacity:0;transition:opacity .18s ease}',
      '.dsh-citation-toast[data-open="true"]{opacity:1}',
    ].join('')
    //#endregion

    //#region 词典
    const zh = {
      'menu.copy': '复制',
      'menu.addToConversation': '添加到对话',
      'menu.label': '引用菜单',
      'chip.label': '引用 · 第{turn}轮 · {count}字',
      'chip.degraded': '引用 · 第{turn}轮 · 字符 {from}–{to}',
      'chip.labelMulti': '引用 · 第{turn}轮 · {count}字 +{rest}',
      'chip.title': '来自第{turn}轮的回复，点击查看原文',
      'popover.heading': '第{turn}轮的回复 · 第{from}–{to}字',
      'notice.inserted': '已添加到输入框',
      'notice.insertDegraded': '当前编辑器不支持引用胶囊，已按位置插入引用',
      'notice.duplicate': '这一段已经引用过了',
      'error.insertFailed': '没能添加到输入框，请重试',
      'error.tooMany': '一条消息最多引用 {max} 段',
    }
    const en = {
      'menu.copy': 'Copy',
      'menu.addToConversation': 'Add to conversation',
      'menu.label': 'Citation menu',
      'chip.label': 'Quote · turn {turn} · {count} chars',
      'chip.degraded': 'Quote · turn {turn} · chars {from}–{to}',
      'chip.labelMulti': 'Quote · turn {turn} · {count} chars +{rest}',
      'chip.title': 'Quoted from the turn {turn} reply — click to read it',
      'popover.heading': 'Turn {turn} reply · chars {from}–{to}',
      'notice.inserted': 'Added to the composer',
      'notice.insertDegraded': 'This composer does not support citation chips; inserted a positional citation',
      'notice.duplicate': 'That passage is already quoted',
      'error.insertFailed': 'Could not add to the composer; please retry',
      'error.tooMany': 'At most {max} quotes per message',
    }
    const LOCALE_NS = 'citation'

    /**
     * 取当前语言的翻译函数；宿主没有 locale 服务时退化为键名本身。
     * @param {any} ctx - client 根上下文。
     * @returns {(key: string, vars?: Record<string, unknown>) => string}
     */
    function translator(ctx) {
      const locale = ctx.locale
      if (locale === undefined || typeof locale.bind !== 'function') {
        return (key, vars) => interpolate((zh[key] ?? key), vars)
      }
      const bind = locale.bind(LOCALE_NS)
      return (key, vars) => interpolate(bind(key, vars), vars)
    }

    /**
     * 把 `{name}` 占位符替换成变量值。
     * @param {string} template - 词典里的模板。
     * @param {Record<string, unknown>} [vars] - 变量表。
     * @returns {string} 填充后的文案。
     */
    function interpolate(template, vars) {
      if (vars === undefined || template === undefined) return template
      return template.replace(/\{(\w+)\}/gu, (whole, name) =>
        Object.hasOwn(vars, name) ? String(vars[name]) : whole,
      )
    }
    //#endregion

    //#region 气泡折叠
    /**
     * 把解析出来的引用块整理成组件要用的展示数据。
     * 文案在这里就翻译好（matcher 在我们自己的闭包里跑，拿得到 t），
     * 组件只负责画，不依赖宿主给不给翻译。
     * @param {Array<object>} items - 协议解析出的引用。
     * @param {(key: string, vars?: Record<string, unknown>) => string} t - 翻译函数。
     * @returns {object} 组件数据。
     */
    function describeBlock(items, t) {
      const head = items[0] ?? { turn: 0, range: [0, 0], quote: '' }
      const total = items.reduce((sum, item) => sum + String(item.quote ?? '').length, 0)
      const label =
        items.length === 1
          ? t('chip.label', { turn: head.turn, count: total })
          : t('chip.labelMulti', {
              turn: head.turn,
              count: String(head.quote ?? '').length,
              rest: items.length - 1,
            })
      return {
        label,
        title: t('chip.title', { turn: head.turn }),
        items,
        entries: items.map((item) => ({
          heading: t('popover.heading', {
            turn: item.turn,
            from: item.range?.[0] ?? 0,
            to: item.range?.[1] ?? 0,
          }),
          quote: item.quote,
        })),
      }
    }

    /**
     * 造一条 userText 规则（宿主用它把已发送的用户消息切成“普通文本 + 组件”）。
     * @param {(key: string, vars?: Record<string, unknown>) => string} t - 翻译函数。
     * @returns {object} userText 规则。
     */
    function createCitationRule(t) {
      return {
        id: 'citation',
        order: 5,
        match(text, from) {
          if (typeof from === 'number' && from > 0) return undefined
          const prefix = splitCitationPrefix(text)
          if (prefix === null) return undefined
          return {
            id: 'citation',
            start: 0,
            end: prefix.length,
            data: describeBlock(prefix.items, t),
          }
        },
      }
    }

    /** 默认规则（中文文案），导出给测试与不接 locale 的场景。 */
    const citationRule = createCitationRule((key, vars) => interpolate(zh[key] ?? key, vars))

    /**
     * 解析一段已发送的用户消息：引用块 + 用户正文。
     * @param {string} text - 消息全文。
     * @returns {{items: Array<object>, body: string} | null} 解析结果。
     */
    function captureCitationBlock(text) {
      const prefix = splitCitationPrefix(text)
      if (prefix === null) return null
      return { items: prefix.items, body: String(text).slice(prefix.length) }
    }

    /**
     * 气泡里的引用胶囊：默认只是一行短文，鼠标移上去才把原文摊开。
     * 浮层用原生 DOM 挂到 body 上（不引 react-dom，也不会被气泡的 overflow 裁掉）。
     * @param {object} props - 宿主给的渲染属性（`node` 里带 matcher 产生 data）。
     * @returns {unknown} React 元素。
     */
    function CitationChip(props) {
      const data = props?.node?.data ?? {}
      const entries = Array.isArray(data.entries) ? data.entries : []
      const [open, setOpen] = React.useState(false)
      const chipRef = React.useRef(null)
      const timerRef = React.useRef(null)

      React.useEffect(() => {
        if (!open || entries.length === 0) return undefined
        const chip = chipRef.current
        const doc = chip?.ownerDocument
        if (doc === null || doc === undefined) return undefined
        return openQuotePopover(doc, chip, entries)
      }, [open, entries.length])

      React.useEffect(
        () => () => {
          if (timerRef.current !== null) clearTimeout(timerRef.current)
        },
        [],
      )

      // 200ms 开、120ms 关：够稳，不会在从胶囊移到浮层的路上闪掉。
      const schedule = (next) => {
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setOpen(next), next ? 200 : 120)
      }

      return React.createElement(
        'span',
        {
          ref: chipRef,
          className: 'dsh-citation-chip',
          'data-open': open ? 'true' : 'false',
          title: data.title,
          onPointerEnter: () => schedule(true),
          onPointerLeave: () => schedule(false),
        },
        data.label ?? '',
      )
    }

    /**
     * 装气泡侧折叠：注册 matcher 与 keyed 渲染器。
     * @param {any} ctx - client 根上下文。
     * @param {(key: string, vars?: Record<string, unknown>) => string} t - 翻译函数。
     * @returns {() => void} 清理函数。
     */
    function installUserText(ctx, t) {
      if (typeof document !== 'undefined') injectStyles(document)
      const disposers = []
      const userText = ctx.uiConversation?.userText
      if (typeof userText?.register === 'function') {
        try {
          const dispose = userText.register(createCitationRule(t))
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch (error) {
          console.warn('[dsh-citation] userText.register failed:', error)
        }
      }
      const slots = ctx.slots
      if (slots !== undefined && typeof slots.register === 'function') {
        try {
          slots.inject('conversation.user.text.node', () => {
            try {
              const dispose = slots.register(
                { name: 'conversation.user.text.node', key: 'citation', priority: 100 },
                CitationChip,
              )
              if (typeof dispose === 'function') disposers.push(dispose)
            } catch (error) {
              console.warn('[dsh-citation] slot register failed:', error)
            }
            return () => {}
          })
        } catch (error) {
          console.warn('[dsh-citation] slot inject failed:', error)
        }
      }
      return () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch (_error) {
            // 清理失败不该影响卸载流程
          }
        }
      }
    }
    //#endregion

    /**
     * 注册引用源；宿主没有 inputTriggers（或名字撞车）时安静退出。
     * @param {any} ctx - client 根上下文。
     * @param {{open?: Function}} [hooks] - 胶囊点击回调。
     * @returns {() => void} 清理函数。
     */
    function registerCitationSource(ctx, hooks = {}) {
      const triggers = ctx.get('inputTriggers')
      if (triggers === undefined || typeof triggers.registerSource !== 'function') return () => {}
      try {
        const dispose = triggers.registerSource(createCitationSource(hooks))
        return typeof dispose === 'function' ? dispose : () => {}
      } catch (error) {
        console.warn('[dsh-citation] registerSource failed:', error)
        return () => {}
      }
    }

    /**
     * 插件入口：装配引用源、右键菜单、气泡折叠。
     * @param {any} ctx - client 根上下文。
     */
    function apply(ctx) {
      const t = translator(ctx)
      ctx.effect(() => {
        const locale = ctx.locale
        if (locale === undefined || typeof locale.register !== 'function') return () => {}
        const dispose = locale.register(LOCALE_NS, { zh, en })
        return typeof dispose === 'function' ? dispose : () => {}
      }, 'dsh-citation: 词典')
      ctx.effect(() => installDraftGuard(ctx, t), 'dsh-citation: 回退守卫')
      ctx.effect(() => registerCitationSource(ctx), 'dsh-citation: 引用源')
      ctx.effect(() => installContextMenu(ctx), 'dsh-citation: 右键菜单')
      ctx.effect(() => installChipHover(ctx, t), 'dsh-citation: 胶囊悬停原文')
      ctx.effect(() => installUserText(ctx, t), 'dsh-citation: 气泡折叠')
    }

    const inject = ['slots', 'locale', 'sessions', 'uiConversation']

    exports.apply = apply
    exports.inject = inject
    /** 纯逻辑出口：Node 侧测试直接消费，避免为了可测而拆文件。 */
    exports.lib = {
      ASSISTANT_SELECTOR,
      TURN_SELECTOR,
      ANCHOR_SELECTOR,
      SESSION_SELECTOR,
      STREAMING_SELECTOR,
      NON_QUOTE_SELECTOR,
      COMPOSER_SELECTOR,
      LOCALE_NS,
      interpolate,
      zh,
      en,
      QUOTE_LIMIT,
      escapeQuote,
      unescapeQuote,
      buildCitationBlock,
      splitCitationPrefix,
      clipQuote,
      CITATION_SOURCE,
      citationRefId,
      citationFromRefId,
      serializeCitation,
      citationChipText,
      createCitationSource,
      isEligible,
      projectQuoteText,
      captureSelection,
      describeCitation,
      insertCitation,
      clampMenuPosition,
      copyText,
      installContextMenu,
      injectStyles,
      MAX_CITATIONS,
      citationRule,
      createCitationRule,
      captureCitationBlock,
      CitationChip,
      installUserText,
      registerCitationSource,
      showToast,
      openQuotePopover,
      installChipHover,
      rememberChip,
      findChipCitation,
      CITATION_CSS,
      rebuildCitationDraft,
      installDraftGuard,
      hasOfficialQuote,
    }
    return module.exports
  },
})
