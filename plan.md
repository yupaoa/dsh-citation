# DSH 引用回复插件（dsh-citation）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH Web UI 中划选 assistant 回复的任意片段，通过右键菜单「添加到对话」把它变成输入框里一个不可编辑的引用 chip；悬停 chip 才显示被引原文；发送时 chip 展开成一段模型可读的引用块，让模型知道这是**第几轮回答中的哪一段**。

**Architecture:** 插件只做 client half。引用生命周期分三段：
1. **选区捕获**：文档级 `mouseup/selectionchange` 读 `window.getSelection()`，用 DSH 渲染出的 `data-chat-flow-kind="assistant-step"` / `data-chat-turn` / `data-chat-anchor-key` / `data-conversation-session` 定位来源轮次与字符区间。
2. **输入框**：插件向 `inputTriggers` 注册一个 reference source（`name: "citation"`，`codec.serialize()` 在发送时把 chip 展开成引用块文本），然后通过会话 scoped 事件 `slash/input-insert-reference` 把 chip 原子插入 draft。draft 文本里 chip 只是一段占位文字（`clipboardText`），真正的原文由 codec 在发送瞬间展开——**引用内容不进入可编辑正文**。
3. **气泡**：引用块作为用户消息的连续前缀发给模型；气泡侧通过 `ctx.uiConversation.userText.register` 的 matcher + `conversation.user.text.node` renderer 把这段前缀消费成一个可悬停展开的 chip。

**Tech Stack:** JavaScript（ESM，`.jsx` 由 DSH client 构建管线处理）、Cordis 插件、`@deepseek-ai/dsh-client-ui-conversation`（`userText` + `inputTriggers` + slots）、`@deepseek-ai/dsh-client-ui-primitives`、Node 内置 `node:test`。

**Spec:** 本文件即 spec（用户 2026-10-28 对话裁定：右键菜单、引用块在输入框内不可编辑且悬停显示内容、纯引用不带注解）。

## Global Constraints

- **只做 client half**：`index.js` 是空 Cordis 插件（host 无逻辑），所有能力在 `client.js`。不新增 host 服务、不动 profile 以外任何文件。
- **目标宿主：DSH 0.2.1-rc.3**（本机 `D:\dsh desktop\resources\app.asar`，`@deepseek-ai/dsh-client-ui-conversation@0.2.1-rc.3`）。宿主升级导致的 DOM 属性/服务形状漂移必须**静默降级**（不弹菜单、不插入、不抛未捕获异常），绝不能崩 UI。
- **引用内容一律全文，不截断**（用户 2026-09-06 在参考项目中的裁定同样适用）；`quote` 内 `<`、`&`、`]]>` 必须转义，保证协议块不可被原文打破。
- **纯引用**：协议里没有 `note` / 注解字段，不得添加。
- **不可编辑**：引用原文不得以可编辑文本形式出现在 draft 里；draft 里只有 chip 占位符。
- **UI 文案**：中文 + 英文双语，经 `ctx.locale` 注册；chip 标签形如 `引用 · 第3轮 · 128字`。不使用硬编码颜色，只用 `--dsw-*` / `--dsh-*` 主题变量。
- **参考项目**（`_probe/dsh-sidenote-main`，MIT）只借鉴思路与 DOM 契约，不复制其 host 侧代码，不引入其依赖。

## Review Focus

1. **跨消息/跨轮选区**：用户从一条回答拖到另一条时，合理预期是“只引用起点那条”或“明确拒绝”，绝不能拼出一条跨轮的错误引用。
2. **流式输出**：回答还在生成时划选，合理预期是菜单不出现（内容还会变）；出现即产生无法复现的引用。
3. **引用原文含协议字符**（`<quote>`、`</citation>`、`]]>`、反引号、整段代码）：合理预期是模型读到的引用与用户选中的文字逐字一致且协议块结构不被打破。
4. **发送序列化失败**（chip owner 缺失、会话切换、draftRev 竞争）：合理预期是草稿、附件一条不丢，并看到明确错误；绝不能静默丢掉引用后照常发送。
5. **刷新/切换会话**：chip 随 draft 持久化恢复后仍能正确展开；在 A 会话划选、切到 B 会话后点「添加到对话」，合理预期是插入到 B 且引用仍指向 A 的原文（或明确拒绝插入）。

---

## 已验证事实（0.2.1-rc.3 实测，实现时直接使用）

| 事实 | 位置 / 证据 |
|---|---|
| assistant 正文节点容器：`[data-chat-flow-kind="assistant-step"]`，外层还有 `[data-chat-turn]`、`[data-chat-anchor-key]` | `ui-chat/lib/client.js` 中 flow item 的 JSX 属性；参考项目 `src/client/host/dom.ts:3` |
| 会话容器：`[data-conversation-session]`；滚动容器：`[data-conversation-scroll]`；输入框 seat：`[data-composer-seat]` | 同上 |
| 流式中：容器上出现 `data-streaming` 属性 | `ui-chat` bundle：`"data-streaming": streaming || void 0` |
| 不该被引用的区域：`button, [role="button"], input, textarea, select, [contenteditable="true"], [data-code-block-banner], [data-variant="think"]` | 参考项目 `NON_QUOTE` |
| reference source 契约：`{ trigger, name, onPick(...), openReference?, codec: { clipboardText, serialize } }`，经 `ctx.get("inputTriggers").registerSource(src)` 注册 | `ui-input-trigger/lib/client.js`（`registerSource`、`serializeReference`、`UiReference` 的 `onPick` 返回 `{insert:{source,ref,label,appearance,clipboardText}}`） |
| 发送时展开：`SessionInputShell.sinkSerialized()` 对每个 chip occurrence 调 `inputTriggers.serializeReference(source, ref, signal)`，把 draft 里 `[offset, offset+length)` 的占位文字替换为 codec 返回值；**serialize 抛错则整次发送失败并恢复草稿** | `ui-conversation/lib/client.js`，`sinkSerialized` |
| 插入 chip：draft editor 的 `insertReference(span, ref, tail)` 由会话 scoped 事件 `slash/input-insert-reference` 驱动（`actx.on("slash/input-insert-reference", req => shell.insertReference(req.reference, req.span))`） | `ui-conversation/lib/client.js`（`InputHub` 的 `actx.effect`） |
| 会话 scoped ctx：`ctx.sessions.scope(sessionId)`（返回 `undefined` 表示会话未驻留）；`ctx.get("conversation").input.for(scope)` 可取 facade | `ui-skill/lib/client.js` 用 `sessions.scope(id)`；参考项目 `src/client/host/input.ts` |
| 输入 facade 公开动词：`setDraft`、`insertText(text, span, keepCompleting?)`、`addAttachments`、`submit(mode?)`、`notify`、`captureInsertion` | 参考项目 `contracts.ts`；`ui-conversation` 的 `SessionInputShell.actions` |
| 用户气泡文本渲染：`UserContent` → `renderFactorySlot("conversation.user.text", { text, facts, interactive, ellipsis })`；可扩展点 `ctx.uiConversation.userText.register(rule)` + `conversation.user.text.node`（keyed，`inline: true`） | `ui-chat` `UserContent`；`ui-reference` 的 `fileReferenceRule` |
| 用户消息的 @mentions 由 host 的 session-reference 服务在 `agent/pre-step` 解析；**普通文本原样进入模型**，无其它带外通道 | `dsh-session-reference/README.zh.md`；`sinkSerialized` 把最终字符串交给 `session.prompt` |
| 宿主版本 | `ui-conversation/package.json`：`0.2.1-rc.3` |

## 文件结构

```
D:\dsh-ws\dsh-citation\
  package.json            # 包元数据 + dsh.client 声明 + exports + files
  cordis.patch.yml        # 安装到 profile 时挂载空 host 插件
  index.js                # 空 host 插件（apply() 只注册一个配置 schema/日志）
  client.js               # 唯一的 client 入口：组装以下模块并挂 slot/event
  src/
    protocol.js           # 引用块编码/解码/转义（纯函数，无 DOM）  ← 单测重点
    capture.js            # DOM → SelectionSnapshot（纯判定函数 + DOM 采集） ← 单测重点
    citation-source.js    # reference source：codec、label、clipboardText
    insert.js             # chip 插入（scoped 事件 → facade 回退）
    contextmenu.js        # 右键菜单（定位、键盘、关闭）
    user-text.js          # 气泡 matcher + CitationChip + hover popover
    store.js              # 引用缓存（ref → 快照），按会话隔离、可选 localStorage
    locale.js             # zh/en 文案
    styles.js             # 注入 CSS（主题变量）
  test/
    protocol.test.js
    capture.test.js
    user-text.test.js
```

职责边界：`protocol.js` 与 `capture.js` 是纯逻辑（可在 jsdom 外单测）；`citation-source.js`/`insert.js`/`user-text.js` 负责与宿主 API 接壤；`client.js` 只做接线。

---

### Task 1: 包骨架与可安装性

**Files:**
- Create: `package.json`, `cordis.patch.yml`, `index.js`, `client.js`, `src/locale.js`, `test/smoke.test.js`

**Interfaces:**
- Produces: 可被 `dsh plugin --profile desktop add link:D:\dsh-ws\dsh-citation` 安装的包；`client.js` 导出 `apply(ctx)` / `inject`；`index.js` 导出空 `apply()`。

- [ ] **Step 1: 写失败测试** `test/smoke.test.js`
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from '../package.json' with { type: 'json' };

test('package declares dsh client entry and patch', () => {
  assert.equal(pkg.main, 'index.js');
  assert.equal(pkg.exports['./client'], './client.js');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
});
```

- [ ] **Step 2: 运行确认失败**：`node --test test/smoke.test.js` → FAIL（`package.json` 不存在）。

- [ ] **Step 3: 创建 `package.json`**
```json
{
  "name": "dsh-citation",
  "version": "0.1.0",
  "description": "划选回复并作为引用发送：右键「添加到对话」，引用以不可编辑 chip 进入输入框，发送时展开为模型可读的引用块。",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js", "./client": "./client.js", "./package.json": "./package.json" },
  "files": ["index.js", "client.js", "src", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-conversation"
      ]
    }
  },
  "engines": { "node": ">=22", "dsh": ">=0.2.1-rc.3" },
  "license": "MIT"
}
```
`inject` 名单是 Task 3 的校验对象：以 spike 实际能拿到的服务为准增删，不得凭空保留未使用的包。

- [ ] **Step 4: 创建 `cordis.patch.yml`、`index.js`、`client.js`**
```yaml
# cordis.patch.yml
- insert:
    - id: citation
      name: dsh-citation
```
```js
// index.js
export function apply() {}
export const name = 'dsh-citation';
```
```js
// client.js
import { registerLocale } from './src/locale.js';

export const name = 'dsh-citation';
export const inject = ['slots', 'locale'];

export function apply(ctx) {
  registerLocale(ctx);
}
```
```js
// src/locale.js
const zh = { 'menu.copy': '复制', 'menu.addToConversation': '添加到对话', 'chip.label': '引用 · 第{turn}轮 · {count}字', 'error.selectionEmpty': '请先选中回复中的文字', 'error.insertFailed': '无法添加到输入框，请重试', 'error.serializeFailed': '引用展开失败，草稿已保留' };
const en = { 'menu.copy': 'Copy', 'menu.addToConversation': 'Add to conversation', 'chip.label': 'Quote · turn {turn} · {count} chars', 'error.selectionEmpty': 'Select some reply text first', 'error.insertFailed': 'Could not add to the composer', 'error.serializeFailed': 'Could not expand the quote; your draft was kept' };

export function registerLocale(ctx) {
  ctx.effect(() => ctx.locale.register('citation', { zh, en }), 'citation: dictionaries');
}
```

- [ ] **Step 5: 测试通过**：`node --test test/smoke.test.js` → PASS。

- [ ] **Step 6: 安装进 desktop profile 并确认加载**
```powershell
dsh plugin --profile desktop add link:D:\dsh-ws\dsh-citation
# 重启 dsh web / 桌面端后，在 DevTools console 执行：
# window.__DSH_BOOT__ 存在且无 "citation" 相关报错；输入框可正常输入
```
Expected: 插件出现在 profile 的 `package.json` dependencies 与 `cordis.patch.yml` 中；页面无插件加载错误。

- [ ] **Step 7: Commit**：`git init && git add -A && git commit -m "chore: scaffold dsh-citation plugin"`

---

### Task 2: 引用协议编解码（纯函数）

**Files:**
- Create: `src/protocol.js`, `test/protocol.test.js`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `CITATION_HEADER_RE: RegExp`（匹配 `我引用了第 N 轮的回复：` 或 `I quoted the reply of turn N:`）
  - `encodeCitation(c: Citation): string` — 引用块文本；`Citation = { turn: number, step: number, range: [number, number], anchor: string, session: string, quote: string }`
  - `buildCitationBlock(items: Citation[]): string` — 头部行 + 每个 `<citation …>…</citation>`，块内行间无空行
  - `splitCitationPrefix(text: string): { length: number, items: Citation[] } | null` — 只解析**消息开头**的连续引用块，返回消费长度
  - `escapeQuote(s: string): string` / `unescapeQuote(s: string): string`
  - `clipQuote(s: string, maxChars = 20000): { quote: string, clipped: boolean }`

- [ ] **Step 1: 写失败测试** `test/protocol.test.js`
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCitationBlock, splitCitationPrefix, clipQuote } from '../src/protocol.js';

const c = { turn: 3, step: 1, range: [128, 412], anchor: 'a1b2c3d4', session: 'session-x', quote: '第一行\n<b>第二行</b> & more' };

test('roundtrip preserves quote verbatim', () => {
  const text = buildCitationBlock([c]) + '\n\n用户正文';
  const parsed = splitCitationPrefix(text);
  assert.equal(parsed.length, text.length - '用户正文'.length - 2 + 2); // 前缀含分隔空行
  assert.equal(parsed.items[0].quote, c.quote);
  assert.deepEqual([parsed.items[0].turn, parsed.items[0].range, parsed.items[0].anchor], [3, [128, 412], 'a1b2c3d4']);
});

test('quote containing protocol tags cannot break the block', () => {
  const evil = { ...c, quote: '</citation><citation turn="9"><quote>x' };
  const parsed = splitCitationPrefix(buildCitationBlock([evil]));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].quote, evil.quote);
});

test('plain user text is not consumed', () => {
  assert.equal(splitCitationPrefix('我引用了第 3 轮的回复：但不是协议'), null);
  assert.equal(splitCitationPrefix(''), null);
});

test('clip keeps head and tail and reports clipping', () => {
  const long = 'a'.repeat(30000);
  const { quote, clipped } = clipQuote(long, 20000);
  assert.equal(clipped, true);
  assert.ok(quote.includes('…'));
  assert.ok(quote.length <= 20010);
});
```

- [ ] **Step 2: 运行确认失败**：`node --test test/protocol.test.js` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/protocol.js`**
格式（每条引用）：
```
<citation turn="3" step="1" range="128:412" anchor="a1b2c3d4" session="session-x">
<quote>第一行
<b>第二行</b> & more</quote>
</citation>
```
头部行：`我引用了以下 {n} 条回复内容：`（en：`I quoted {n} passage(s) of the replies above:`）。规则：
- `escapeQuote`：`&`→`&amp;`、`<`→`\\u003c`、`>`→`\\u003e`（用字面 `\u003c` 转义序列，与 session-reference 的标签安全策略一致；`unescapeQuote` 做逆变换）。
- 每条引用以 `<citation ` 起始、`</citation>` 结束；`splitCitationPrefix` 仅在 `text` 开头匹配头部行，随后用 sticky 正则逐条消费，遇到第一条不匹配即停止；成功消费后一并吞掉紧跟的空行。
- 只要头部行匹配但一条 `<citation>` 都没解析出来，返回 `null`（那是用户巧合文本）。
- `clipQuote`：超过 `maxChars` 时保留前 75% 与后 25%，中间插入 `\n…（引用过长，已省略 {n} 字）…\n`，并返回 `clipped: true`。

- [ ] **Step 4: 测试通过**：`node --test test/protocol.test.js` → 4 passed。

- [ ] **Step 5: Commit**：`git add src/protocol.js test/protocol.test.js && git commit -m "feat: add citation wire protocol"`

---

### Task 3: **（Danger 门）** chip 插入与发送展开的可行性 spike

> 这是整个方案的技术门。**不通过就执行文末「降级路线」，不要继续 Task 4–7 的 chip 路线。**

**Files:**
- Create: `src/citation-source.js`, `src/insert.js`, `test/citation-source.test.js`
- Modify: `client.js`（临时挂一个 `window.__citationSpike` 用于手动验证，Task 7 移除）

**Interfaces:**
- Consumes: Task 1 的 `ctx`；`ctx.get('inputTriggers')`；`ctx.sessions.scope(sessionId)`；`ctx.get('conversation').input.for(scope)`。
- Produces:
  - `createCitationSource(ctx): ReferenceSource`（`name: 'citation'`、`trigger: '@'`、`codec.serialize`、`openReference`）
  - `insertCitationChip(ctx, sessionId, citation): Promise<boolean>`
  - `citationRefId(c: Citation): string`（`base64url(JSON.stringify(c))`）
  - `citationFromRefId(id: string): Citation`

- [ ] **Step 1: 写失败测试** `test/citation-source.test.js`（只测纯部分：ref 编解码、codec 输出）
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { citationRefId, citationFromRefId, serializeCitation } from '../src/citation-source.js';

const c = { turn: 3, step: 1, range: [0, 5], anchor: 'deadbeef', session: 's1', quote: 'hello & <world>' };

test('ref id roundtrips and is url/base64url safe', () => {
  const id = citationRefId(c);
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(citationFromRefId(id), c);
});

test('serialize expands to a protocol block readable by splitCitationPrefix', async () => {
  const out = await serializeCitation(c);
  assert.match(out, /^我引用了以下 1 条回复内容：\n<citation turn="3"/);
  assert.ok(out.includes('<quote>hello &amp; \\u003cworld\\u003e</quote>'));
});
```

- [ ] **Step 2: 运行确认失败**：`node --test test/citation-source.test.js` → FAIL。

- [ ] **Step 3: 实现 `src/citation-source.js`**
```js
import { buildCitationBlock, clipQuote } from './protocol.js';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
export const citationRefId = (c) => b64(JSON.stringify(c));
export const citationFromRefId = (id) => JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
export async function serializeCitation(c) { return buildCitationBlock([{ ...c, quote: clipQuote(c.quote).quote }]); }

export function createCitationSource(ctx) {
  return {
    trigger: '@',
    name: 'citation',
    codec: { clipboardText: (ref) => ref, serialize: async (ref) => serializeCitation(citationFromRefId(ref)) },
    openReference: () => false,
    onPick: () => undefined,
  };
}
```
`ctx.effect(() => ctx.get('inputTriggers').registerSource(createCitationSource(ctx)), 'citation: source')`。

- [ ] **Step 4: 手动 spike（必须在真机浏览器里做完四项）**
1. 打开任一有 assistant 回复的会话，在 DevTools 执行：
```js
await window.__citationSpike.insert({ turn: 1, step: 1, range: [0, 5], anchor: 'deadbeef', session: '<当前 sessionId>', quote: 'hello world' })
```
2. **断言 A**：输入框出现一个 `引用 …` chip，draft 其余内容与已有 `@` 引用/附件不受影响，chip 用退格能整体删除。
3. **断言 B**：直接回车发送，Network/`session.prompt` 里用户消息文本以 `我引用了以下 1 条回复内容：` 开头，且模型回答能复述 `hello world` 并说出 turn 1。
4. **断言 C**：刷新页面后 chip 从持久化 draft 恢复，仍可发送并正确展开。
5. **断言 D**：把 `codec.serialize` 临时改成 `throw new Error('spike')`，回车后发送被拒、草稿与 chip 原样保留、界面出现错误提示。

- [ ] **Step 5: 记录 spike 结论到 `docs/spike-chip.md`**
写清：插入走了哪条路（scoped 事件成功 / 退回 `insertText` 纯文本）。若 scoped 事件路由不通，先把失败信息与宿主版本记下，然后执行文末「降级路线」。若通，记下实际可用的 `inject` 名单，回填 `package.json`。

- [ ] **Step 6: 测试通过 + Commit**：`node --test test/citation-source.test.js` → PASS；`git add -A && git commit -m "feat: citation reference source and chip insertion"`

---

### Task 4: 选区捕获与轮次定位

**Files:**
- Create: `src/capture.js`, `test/capture.test.js`

**Interfaces:**
- Consumes: Task 2 的 `Citation`；Task 3 的 `citationRefId`。
- Produces:
  - `isEligible({ blank, sameMessage, kind, streaming, excluded, hasSession }): boolean`（纯函数）
  - `captureSelection(doc: Document): SelectionSnapshot | null`，`SelectionSnapshot = { citation: Citation, rect: DOMRect, text: string }`
  - `ASSISTANT_SELECTOR = '[data-chat-flow-kind="assistant-step"]'`
  - `NON_QUOTE_SELECTOR`（见上表）

- [ ] **Step 1: 写失败测试** `test/capture.test.js`
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isEligible } from '../src/capture.js';

const ok = { blank: false, sameMessage: true, kind: 'assistant-step', streaming: false, excluded: false, hasSession: true };
test('eligible only for a non-blank, single, settled assistant message', () => {
  assert.equal(isEligible(ok), true);
  for (const patch of [{ blank: true }, { sameMessage: false }, { kind: 'user' }, { streaming: true }, { excluded: true }, { hasSession: false }]) {
    assert.equal(isEligible({ ...ok, ...patch }), false, JSON.stringify(patch));
  }
});
```

- [ ] **Step 2: 运行确认失败**：`node --test test/capture.test.js` → FAIL。

- [ ] **Step 3: 实现 `src/capture.js`**
- `captureSelection(doc)`：
  1. `sel = doc.getSelection()`；折叠、`rangeCount === 0`、`sel.toString().trim() === ''` → `null`。
  2. `startBody = range.startContainer.parentElement?.closest(ASSISTANT_SELECTOR)`，`endBody` 同理；两者必须**是同一个元素**，否则 `null`（跨消息拒绝）。
  3. `startBody.hasAttribute('data-streaming') || startBody.querySelector('[data-streaming]')` → `null`。
  4. 任一端点 `closest(NON_QUOTE_SELECTOR)` 非空 → `null`。
  5. `view = startBody.closest('[data-conversation-session]')`；`session = view?.dataset.conversationSession`，空 → `null`。
  6. `wrapper = startBody.closest('[data-chat-turn]')`；`turn = Number(wrapper?.dataset.chatTurn)`，非安全整数 → `null`。
  7. `step`：`Number(startBody.closest('[data-chat-node-key]')?.dataset.chatNodeKey)` 不可解析时记 `0`（仅作诊断，不参与协议语义）。
  8. `anchor = wrapper?.dataset.chatAnchorKey ?? startBody.dataset.chatAnchorKey ?? ''`；`session` 与 `anchor` 一起写入 `Citation`。
  9. `range`：用 `TreeWalker(SHOW_TEXT)` 收集 `startBody` 内文本节点（跳过 `NON_QUOTE` 后代与 `getComputedStyle(...).userSelect === 'none'` 的父元素），拼成投影文本；`start = offsetOf(startContainer, startOffset)`，`end = offsetOf(endContainer, endOffset)`；`end <= start` → `null`。
  10. `text`：优先用投影文本切片 `projected.slice(start, end)`；若浏览器 `sel.toString()` 去掉所有空白后与之相等，则用 `sel.toString()`（保留浏览器对段落/列表换行的处理）。两者都写入 `quote`。
  11. `rect = range.getBoundingClientRect()`。
- 单测覆盖 `isEligible`；DOM 分支在 Task 6 的 E2E/手动检查中覆盖。

- [ ] **Step 4: 测试通过**：`node --test test/capture.test.js` → PASS。

- [ ] **Step 5: Commit**：`git add src/capture.js test/capture.test.js && git commit -m "feat: capture assistant selection as citation"`

---

### Task 5: 右键菜单 + 插入接线

**Files:**
- Create: `src/contextmenu.js`, `src/insert.js`
- Modify: `client.js`

**Interfaces:**
- Consumes: Task 3 `insertCitationChip`、Task 4 `captureSelection`、Task 1 locale keys `menu.*`、`error.*`。
- Produces: `installContextMenu(ctx): () => void`。

- [ ] **Step 1: 实现 `src/insert.js`**
```js
export async function insertCitationChip(ctx, sessionId, citation) {
  const scope = ctx.sessions.scope(sessionId);
  if (scope === undefined) return false;
  const input = ctx.get('conversation')?.input?.for(scope);
  if (input === undefined) return false;
  const rev = input.state.getSnapshot().draftRev;
  // 首选：scoped 事件让 editor 生成真正的 chip（Task 3 spike 结论）
  const applied = scope.bail?.('slash/input-insert-reference', {
    reference: { source: 'citation', ref: citationRefId(citation), label: labelOf(citation), clipboardText: `[[cite:${citation.turn}]]` },
    span: { start: input.state.getSnapshot().draft.length, end: input.state.getSnapshot().draft.length, draftRev: rev },
  }) === true;
  // 回退：仅当 spike 证明事件不可达时才启用；插入纯文本引用行，由用户可见删改
  return applied || insertFallbackLine(input, citation, rev);
}
```
`insertFallbackLine` 用 `input.insertText('\\n[引用 · 第{n}轮 · {count}字]', {start, end, draftRev})`，失败返回 `false`。**两条路都必须在 Task 3 的 spike 里实测过其一**；不得把未验证的路径留在生产代码里当主路径。

- [ ] **Step 2: 实现 `src/contextmenu.js`**
- `document.addEventListener('contextmenu', onContextMenu, true)`：`snap = captureSelection(document)`；`snap === null` 直接返回（保留浏览器原生菜单）。
- 有效时 `event.preventDefault()`，渲染一个 `position: fixed` 菜单（left/top 夹在视口内，超右/下边界翻转），两个菜单项：`复制`（`navigator.clipboard.writeText(snap.text)`；失败时降级为一个隐藏 textarea + `document.execCommand('copy')`）、`添加到对话`。
- 菜单项 `mousedown` 都 `preventDefault()`，避免抢走选区。
- 关闭：`pointerdown`（菜单外）、`keydown` Escape、`scroll`（capture）、`resize`、会话切换（`ctx.sessions.list` 订阅）。
- 键盘：菜单打开后焦点移到第一项，`ArrowUp/Down` 循环、`Enter` 触发、`Tab` 关闭；`role="menu"` / `role="menuitem"`。
- `添加到对话`：`await insertCitationChip(ctx, snap.citation.session, snap.citation)`；成功 → 关闭菜单、`window.getSelection().removeAllRanges()`、把焦点还给 composer（`[data-composer-seat] [contenteditable]`）；失败 → 关闭菜单并 `ctx.get('conversation')?.input?.for(scope)?.notify?.('error', t('error.insertFailed'))`。
- `client.js`：`ctx.effect(() => installContextMenu(ctx), 'citation: context menu')`。

- [ ] **Step 3: 手动验证（2 分钟）**
1. 划选 assistant 回复 → 右键出现两项；点「复制」→ 剪贴板含选区原文。
2. 点「添加到对话」→ 输入框出现 chip，正文未变。
3. 划选用户消息/thinking/代码块按钮 → 右键出现**原生**菜单（不劫持）。
4. 划选流式中的回答 → 原生菜单。
5. 划选跨越两条回答 → 原生菜单。

- [ ] **Step 4: `node --test`** 全绿，`git add -A && git commit -m "feat: right-click add-to-conversation with citation chip"`

---

### Task 6: 气泡侧折叠引用（userText matcher）

**Files:**
- Create: `src/user-text.js`, `src/styles.js`, `test/user-text.test.js`
- Modify: `client.js`

**Interfaces:**
- Consumes: Task 2 `splitCitationPrefix`、`CITATION_HEADER_RE`；Task 1 locale `chip.label`。
- Produces: `installUserText(ctx): void`；matcher `{ id: 'citation', order: 5, match(text, from): { id, start, end, data: { items } } | undefined }`。

- [ ] **Step 1: 写失败测试** `test/user-text.test.js`
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { citationRule } from '../src/user-text.js';
import { buildCitationBlock } from '../src/protocol.js';

const c = { turn: 3, step: 1, range: [0, 5], anchor: 'x', session: 's', quote: 'hello' };

test('matches only the leading citation block', () => {
  const text = buildCitationBlock([c]) + '\n\n正文';
  const hit = citationRule.match(text, 0);
  assert.equal(hit.id, 'citation');
  assert.equal(hit.start, 0);
  assert.equal(hit.data.items[0].quote, 'hello');
  assert.equal(text.slice(hit.end).trimStart(), '正文');
});

test('ignores later occurrences and plain text', () => {
  const text = '正文\n\n' + buildCitationBlock([c]);
  assert.equal(citationRule.match(text, 0), undefined);
  assert.equal(citationRule.match('普通消息，提到 我引用了第 3 轮的回复： 但不成块', 0), undefined);
});
```

- [ ] **Step 2: 运行确认失败**：`node --test test/user-text.test.js` → FAIL。

- [ ] **Step 3: 实现 `src/user-text.js`**
- `citationRule.match(text, from)`：`from > 0` 直接返回 `undefined`；`splitCitationPrefix(text)` 为 `null` 返回 `undefined`；否则 `{ id: 'citation', start: 0, end: prefix.length, data: { items } }`。
- `CitationChip({ node, interactive, t })`：渲染 `span.citation-chip`（`data-citation-chip`），内容 `t('chip.label', { turn: items[0].turn, count: totalChars })`，多条时加 `· +N`；`title` 放首条前 120 字。
- 悬停/聚焦：`onPointerEnter` → 200ms 后设 `open=true`，`onPointerLeave` → 120ms 后关；`onClick`（`interactive` 时）切换 pinned；`Escape`/点外部关闭。popover 用 `fixed` 定位（视口内翻转），内部滚动 `max-height: 40vh`；只读、`user-select: text` 以便选中复制。
- `installUserText(ctx)`：`ctx.uiConversation.userText.register(citationRule)`；`ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({ name: 'conversation.user.text.node', key: 'citation', priority: 100, locale: 'citation' }, CitationChip))`；`ctx.effect(() => injectCss(), 'citation: styles')`。

- [ ] **Step 4: 手动验证**
1. 发送一条带引用的消息 → 气泡里只有 chip，没有 `<citation>` 原文；悬停 → 显示被引原文；点击 → 固定，Esc 关闭。
2. 引用内容含 `<b>`、代码块、换行 → popover 按原文显示。
3. 只发引用不写正文 → 气泡仍渲染 chip。
4. 停用本插件 → 同一消息退化为纯文本协议块（不丢内容）。

- [ ] **Step 5: `node --test` 全绿 + Commit**：`git add -A && git commit -m "feat: collapse citations in sent bubbles"`

---

### Task 7: 收尾——多引用、错误路径、i18n、文档

**Files:**
- Modify: `client.js`, `src/locale.js`, `src/insert.js`
- Create: `README.md`

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: 稳定版 0.1.0。

- [ ] **Step 1: 多引用与去重**
同一消息最多 5 条引用（每次插入一条 chip；`sinkSerialized` 会按 occurrence 顺序展开，天然成块）。相同 `(session, turn, range)` 再次插入时不新增 chip，转为把已存在 chip 前的提示浮层闪一下（`input.notify('info', …)`），避免同一段重复占上下文。

- [ ] **Step 2: 移除临时 spike 入口**：删除 `window.__citationSpike`；确认 `client.js` 只剩 `apply/inject` 与各 `install*` 调用。

- [ ] **Step 3: 回归（按 Review Focus 逐条）**
1. 跨消息划选 → 无菜单。
2. 流式回答划选 → 无菜单。
3. 引用含 `</quote>`、`]]>`、反引号代码块 → 发送后模型可逐字复述，气泡 popover 显示一致。
4. 发送前把参考会话切走/关闭再回 → chip 仍在、发送正常。
5. 关闭插件后重载 → 历史气泡显示纯文本协议块，无 JS 报错。

- [ ] **Step 4: 写 `README.md`**：安装命令、使用步骤（划选 → 右键 → 添加到对话 → 悬停查看 → 发送）、已知限制（宿主 DOM 契约、引用全文上限 20000 字）、卸载后降级行为。

- [ ] **Step 5: 最终校验**：`node --test` 全部通过；`dsh plugin --profile desktop list` 含 `dsh-citation`；桌面端实际发送一条引用消息截图存档到 `docs/`。

- [ ] **Step 6: Commit**：`git add -A && git commit -m "docs: usage and limits; release 0.1.0"`

---

## 降级路线（Task 3 spike 不通过时执行）

放弃 chip，改为**纯文本引用行 + codec 不参与**：

1. `insertCitationChip` 直接 `input.insertText(prefixLine, span)`，在 caret 处插入一行 `[引用 · 第3轮 · 128字]`（可编辑、极短，不含原文）。
2. 发送前无法拿到原文 → 引用**只带位置不带原文**：`[引用 · 第3轮 · 字符 128–412 · anchor a1b2c3d4]`。模型靠 turn + 区间 + 自己在上下文里的原文定位，这正是用户需求 3 的最低语义。
3. 气泡侧 matcher 仍把这一行渲染成 chip + popover（popover 显示“仅位置引用”，因为原文不在消息里）。
4. 代价：模型侧没有原文冗余（上下文被压缩后可能定位失败）。此路线可作为 v0 先上线，再单独攻 chip。

## 风险与未决

- **宿主内部 DOM 契约**：`data-chat-flow-kind` 等属性非公开 API；升级后可能静默失效。缓释：所有捕获点 `try/catch` + 全链路 `null` 降级；README 标注目标版本。
- **`sessions.scope(...).bail(...)` 的可用性**：Task 3 必须实测；若不可用，降级路线立即生效（不阻塞发布）。
- **超长引用**：`clipQuote` 上限 20000 字（约 8–10k token），截断时在协议里写明省略字数，避免模型误以为引用不全。
- **多 tab 同会话**：chip 的 draft 持久化是全局的；两个窗口同时编辑可能互相覆盖。第一版接受宿主既有行为，不做同步。
