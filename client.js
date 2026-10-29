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
      return encodeBase64Url(JSON.stringify(citation))
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

    //#region 词典
    const zh = {
      'menu.copy': '复制',
      'menu.addToConversation': '添加到对话',
      'menu.label': '引用菜单',
      'chip.label': '引用 · 第{turn}轮 · {count}字',
      'chip.labelMulti': '引用 · 第{turn}轮 · {count}字 +{rest}',
      'chip.title': '来自第{turn}轮的回复，点击查看原文',
      'popover.heading': '第{turn}轮的回复 · 第{from}–{to}字',
      'popover.clipped': '引用过长，已省略 {count} 字',
      'popover.positionOnly': '这条引用只记录了位置（当时的编辑器不支持引用胶囊）。',
      'notice.inserted': '已添加到输入框',
      'notice.insertDegraded': '当前编辑器不支持引用胶囊，已按位置插入引用',
      'notice.duplicate': '这一段已经引用过了',
      'error.selectionEmpty': '请先选中回复中的文字',
      'error.insertFailed': '没能添加到输入框，请重试',
      'error.serializeFailed': '引用展开失败，草稿已保留',
      'error.tooMany': '一条消息最多引用 {max} 段',
    }
    const en = {
      'menu.copy': 'Copy',
      'menu.addToConversation': 'Add to conversation',
      'menu.label': 'Citation menu',
      'chip.label': 'Quote · turn {turn} · {count} chars',
      'chip.labelMulti': 'Quote · turn {turn} · {count} chars +{rest}',
      'chip.title': 'Quoted from the turn {turn} reply — click to read it',
      'popover.heading': 'Turn {turn} reply · chars {from}–{to}',
      'popover.clipped': 'Quote too long; {count} chars omitted',
      'popover.positionOnly': 'This citation records only a position (the composer did not support chips).',
      'notice.inserted': 'Added to the composer',
      'notice.insertDegraded': 'This composer does not support citation chips; inserted a positional citation',
      'notice.duplicate': 'That passage is already quoted',
      'error.selectionEmpty': 'Select some reply text first',
      'error.insertFailed': 'Could not add to the composer; please retry',
      'error.serializeFailed': 'Could not expand the quote; your draft was kept',
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

    /**
     * 插件入口：装配四块能力（引用源、右键菜单、插入、气泡折叠）。
     * @param {any} ctx - client 根上下文。
     */
    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(LOCALE_NS, { zh, en }),
        'dsh-citation: 词典',
      )
    }

    const inject = ['slots', 'locale', 'sessions', 'uiConversation']

    exports.apply = apply
    exports.inject = inject
    /** 纯逻辑出口：Node 侧测试直接消费，避免为了可测而拆文件。 */
    exports.lib = {
      ASSISTANT_SELECTOR,
      NON_QUOTE_SELECTOR,
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
    }
    return module.exports
  },
})
