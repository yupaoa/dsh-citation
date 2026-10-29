# dsh-citation

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-brightgreen.svg)](package.json)

**划选回答里的一段 → 右键「添加到对话」→ 变成输入框里一个引用胶囊**

给 DeepSeek Harness 用的第三方插件：把某一条回复里的一段原文引用进下一条消息，发送时以
「第几轮、哪个字符区间、原文全文」的形式交给模型；气泡里再折叠回一只胶囊。

> Select a passage in a reply, right-click **Add to conversation**, and it becomes an
> uneditable quote chip in the composer. On send, the chip expands into a block that tells the
> model *which turn, which character range, and the exact text* — and folds back into a chip
> inside the sent bubble.

> **官方已有同类功能**：DSH `0.2.2-alpha.2` 起内置「引用文本」——输出是 Markdown `> ` 引用块，
> 不带出处。本插件多给模型 `turn / range` 出处，入口相同，详见[「与官方功能的关系」](#vs-builtin)。

> **环境要求**：DSH `>= 0.2.1-rc.3`（依赖该版本的输入框引用胶囊与气泡 `userText` 规则），
> Node.js `^22.19.0 || >=24.0.0`（随宿主）。

<a id="vs-builtin"></a>

## 与官方功能的关系

DSH **`0.2.2-alpha.2`**（2026-10-28）起，官方已内置引用能力
（`@deepseek-ai/dsh-message-quotes`）：选中回复里的文字，点选区旁的**引用文本**按钮，内容进入
输入框，发送后折叠预览。入口与本插件相同，但交给模型的东西不同：

| | 官方（`0.2.2-alpha.2`+） | 本插件 |
| --- | --- | --- |
| 送给模型的内容 | 普通 Markdown 引用块，每行一个 `> ` 前缀 | `<citation turn step range anchor session>` + `<quote>` |
| 出处（第几轮、哪个字符区间） | **没有**——模型只知道「用户引用了一段话」 | 有，可定位到具体轮次与字符区间 |
| 输入框里的形态 | QuoteNode，文字**可编辑** | 原子胶囊，**不可编辑**，只能整块删除 |
| 入口 | 选区旁的浮动按钮 | 右键菜单「添加到对话」 |

**怎么选**：只要把一段话引进来 → 用官方，可以直接卸掉本插件；想让模型知道「这段话出自第几轮、
哪几个字符」→ 用本插件。

**共存保护**：本插件会探测宿主的 `insertQuote` 能力（官方引用正是走它）。一旦发现宿主已经自带
引用入口，就**不再注入右键菜单项**，把选区右键让回浏览器原生菜单，避免出现两个「引用」。
所以在 `0.2.2` 之后装它不会打架，只是它会安静下来；`0.2.1` 及更早没有这个能力，功能照常。

下面几节描述的都是**本插件自己**的入口与行为。

## 它能做什么

- 🖱️ **右键菜单多一项**：在**已经生成完**的回复里划选文字后右键，菜单里除了「复制」还有
  **添加到对话**。只有一个合法的选区时才接管右键，其它情况一律放行浏览器原生菜单。
- 🧩 **引用胶囊，不可编辑**：点它之后输入框里出现 `引用 · 第3轮 · 128字` 的原子胶囊。
  它不是文本，删不掉半个字——只能整块删除，也不会被你不小心改坏。
- 👀 **悬停才看原文**：鼠标移到胶囊上（输入框里和已发送的气泡里都算）才展开被引原文，
  可选中复制；移开即收起。浮层不抢焦点、不改草稿。
- 📨 **发送时变成模型可读的引用块**：

  ```
  我引用了以下 1 条回复内容：
  <citation turn="3" step="0" range="128:412" anchor="a1b2c3d4" session="d4f1…">
  <quote>被引用的那一段原文，逐字保留</quote>
  </citation>

  你的问题
  ```

  模型因此能分辨「这是第 3 轮回答里字符 128–412 的那一段」，而不是一段来路不明的引文。
  前缀在已发送的气泡里会被折叠回胶囊，正文照常显示。
- 🛡️ **只在能引用的时候出现**：跨两条回复的选区、正在流式生成的回复、按钮 / 代码块工具条 /
  思考块里的选区、空白选区——一律不出自定义菜单项（理由见下表）。
- 🚫 **不重复、不贪多**：同一段重复引用会被挡下，一条消息最多 5 段引用——再多就是拿上下文换便利。
- ↩️ **回退对话也认得**：`dsh-rewind` 回退时会把「当时发送的原文」塞回输入框，插件检测到其中
  的引用块就重建成「胶囊 + 正文」，不会留一堆机器标记。
- 🌗 **跟随主题、只碰自己**：菜单 / 浮层深色、跟随宿主的暗色界面；样式全部以
  `.dsh-citation-*` 命名，不动宿主任何选择器。

### 它刻意不做什么

| 不做 | 原因 |
| --- | --- |
| 不截断你要引用的原文（超过 20000 字才裁剪） | 裁剪会悄悄改掉引用内容；真要超限时保留头 75% + 尾 25%，并在块里写明省略了多少字，模型不会误以为引用完整 |
| 不跨消息拼接引用 | 拼出来的 `turn / range` 一定是错的，宁可不出菜单 |
| 不接管流式生成中的回复 | 内容还会变，引用无法复现 |
| 不提供「缩小/改写引用」 | 引用应当是原话；要摘要就让模型自己去做 |
| 不注册任何模型工具或斜杠命令 | 引用是人的动作，不该成为模型可自主调用的能力 |
| 不改草稿里你写的字 | 只插入 / 删除胶囊本身，正文一个字都不动 |

## 权限与边界

### 一句话

**不读写任何文件、不发起任何网络请求、不注册工具、不读凭据；唯一会变的是你输入框里的草稿，
以及你按下发送后那条消息的内容。**

插件以宿主进程的同等权限运行（DSH 的第三方插件没有独立沙箱），所以这里列的是**它实际用到的
能力**，也是你审计时该看的那几条。

### 会写入的东西

| 位置 | 何时 | 写什么 |
| --- | --- | --- |
| 输入框草稿 | 点「添加到对话」时 | 通过宿主公开的 `insertReference` / `insertText` / `setDraft` 插入胶囊，**不直接改 DOM 里的文字**。草稿的持久化由宿主负责（`会话草稿` 本来就存在那里） |
| 会话消息 | 你按下发送时 | 胶囊展开成上方那段引用块文本；这是**草稿文本的变换**，不额外发请求、不额外落盘 |
| 页面 DOM（临时） | 菜单 / 浮层 / 提示条显示期间 | 挂在 `<body>` 下的三个自建节点，关闭即移除；对应样式也只有一个 `<style data-dsh-citation>` |
| 剪贴板 | 只有你点菜单里的「复制」 | `navigator.clipboard.writeText`，失败退回 `execCommand('copy')`；**从不读剪贴板**、不轮询 |
| 本次进程内存 | 插件生命周期内 | 一个 `文案 → 引用` 的映射表（上限 50 条，供悬停反查原文）；卸载即消失 |

### 只读的东西

- **回复正文的 DOM**：`data-chat-flow-kind="assistant-step"`、`data-chat-turn`、
  `data-chat-anchor-key`、`data-conversation-session`、`data-streaming`——用来判断「这是第几轮的
  哪一段」。这些是**宿主内部契约而非公开 API**，见「兼容性」。
- **宿主服务**：`conversation.input`（拿输入框 shell）、`inputTriggers`（注册引用源 / 展开胶囊）、
  `uiConversation.userText` + `slots`（气泡里折叠渲染）、`locale`（中英文案）、`sessions`
  （会话 id → scope）。
- 你的选区：只在你右键的那一刻读一次 `getSelection()`。

### 一概不碰

- 文件系统：不读、不写、不列举任何文件（连自己的配置都不落盘）；
- 网络：**没有出站请求，也没有入站路由**——不开端口、不建服务器、不挂 `webServer` 路由；
- 凭据：不碰 `~/.dsh/.credentials.yaml`、环境变量里的密钥、模型 provider 配置；
- 模型与提示词：不改系统提示词、不改模型选择、不注入额外的人设段；
- 会话的工具集 / 命令表 / 技能 / 插件组合：**一样都不改**；
- 其它插件与其它配置行：只 patch 自己那一行；
- 你的工作区文件与历史会话：除了你要发送的那条消息本身。

### 一处需要知情的实现细节（可审计）

为了让「回退对话」不把引用块显示成原始标记，插件包装了 `conversation.input.for(scope)` 返回的
shell 的 `setDraft`（存下原函数，卸载时逐个还原）。它只在收到含 `我引用了以下 ` 前缀的草稿时
才动手，其它写入原样透传；重建失败时会退化为「剥掉机器标记、保留正文」，绝不把内容改丢。

### 想彻底关掉

卸载插件即可，**没有任何残留**：不写配置文件、不留后台进程、不改宿主设置。历史消息里的引用块
会以纯文本形式显示（内容不丢）。

## 安装

要求：DSH `>= 0.2.1-rc.3`、Node.js `^22.19.0 || >=24.0.0`。`dsh plugin add` 会把参数原样透传给
`pnpm add`。本插件**没有发布到 npm**，只有下面两种装法。

```powershell
# 1) 直接从 GitHub 安装（推荐；client.js 已提交，无需构建）
dsh plugin add --profile desktop "github:yupaoa/dsh-citation"
#    若上面的 shorthand 不被接受，用等价的显式写法：
dsh plugin add --profile desktop "git+https://github.com/yupaoa/dsh-citation.git"

# 2) 从本地目录安装（开发 / 离线）
dsh plugin add --profile desktop "link:D:\path\to\dsh-citation"
```

> 把 `--profile desktop` 换成你自己的 profile 名；`dsh plugin list --profile desktop` 查看已装插件。

没有 `dsh` CLI 时手工装（三处都要改）：

1. `~/.dsh/profiles/desktop/node_modules\dsh-citation` 建一个指向本目录的 Junction
   （`cmd /c mklink /J <上面这个路径> D:\path\to\dsh-citation`）；
2. profile 的 `package.json`：`dependencies` 加 `"dsh-citation": "link:D:/path/to/dsh-citation"`，
   `dsh.profile.bundles` 末尾加 `"dsh-citation"`；
3. 重启 DSH。

### 装完必须重启

插件在宿主启动时装配（引用源、右键菜单、气泡规则都在启动阶段注册）。
**安装 / 卸载 / 升级后请完全退出并重启 DSH**，只刷新页面不够。

### 卸载

```powershell
dsh plugin remove --profile desktop dsh-citation
```

## 用

1. 在任意一条**已经生成完**的 AI 回复里划选一段文字；
2. 右键 → **添加到对话**；
3. 输入框里出现 `引用 · 第3轮 · 128字` 的胶囊，正文一个字都不多；
4. 鼠标移到胶囊上 → 浮层显示被引原文（可选中复制），移开收起；
5. 正常输入、按 Enter 发送；
6. 发送后的气泡里，前缀折叠成同一个胶囊，正文照常显示。

### 什么时候不出菜单

| 情况 | 行为 | 原因 |
| --- | --- | --- |
| 选区跨了两条回复 | 不出菜单 | 拼出来的引用一定错，宁可不动 |
| 回答还在流式生成 | 不出菜单 | 内容还会变，引用无法复现 |
| 选中的是按钮 / 代码块工具条 / 思考过程 | 不出菜单 | 那不是回答的正文 |
| 选中空白 | 不出菜单 | 没有内容可引 |
| 同一段已经引用过 | 提示「这一段已经引用过了」 | 避免重复占上下文 |
| 一条消息已引 5 段 | 提示上限 | 再多就是拿上下文换便利 |

## 兼容性

- 目标版本 **DSH `0.2.1-rc.3`**；在 `0.2.2-alpha.2`（官方已内置引用）上会自动让出右键菜单，
  见上一节。
- **依赖宿主的内部 DOM 契约**（见「只读的东西」）。这些不是公开 API，宿主大版本升级后可能失效；
  失效时插件会**安静地不再出菜单**，不会崩 UI、不会破坏原生右键菜单。
- 气泡折叠依赖 `uiConversation.userText` 规则与 `conversation.user.text.node` 槽位；缺这些服务的
  宿主上，插入与发送仍然工作，只是气泡里不会折叠。
- 如果宿主的编辑器不接受引用胶囊，插件退化为插入一行位置标记
  `引用 · 第3轮 · 字符 128–412`——此时模型按位置定位，没有原文冗余。
- 刷新页面后，草稿里恢复的胶囊因为查不到「文案 → 原文」映射，悬停只显示宿主原生提示。

## 开发

```bash
npm test        # node --test test/*.test.js，无依赖、无网络（51 个用例）
```

`client.js` 是**单文件**客户端半身：第三方插件只能提供一个 `window.__ModuleLoader__.load` 工厂，
多文件需要打包链，所以这里用 `//#region` 分区，不引入构建步骤。

测试里没有浏览器：`test/fake-dom.js` 是个最小假 DOM（菜单、浮层、提示条、胶囊悬停都在它上面回归），
`test/harness.js` 用假 `window.__ModuleLoader__` 加载 `client.js` 并注入可记录的假 ctx。

本地试用：

```powershell
dsh plugin add --profile desktop "link:D:\path\to\dsh-citation"
# 完全退出并重启 DSH
```

### 给贡献者的三条红线

1. **`window.__ModuleLoader__.load({ id })` 里的 id 必须是 `dsh-citation`**——内核用解析出的包名
   作为浏览器模块身份；写错会导致该行永远注册不上。`test/smoke.test.js` 会盯着这一条。
2. **引用源必须提供 `candidates`**：宿主的 `@` 菜单会对每个 `@` 源无条件调用
   `source.candidates(...).then(...)`，缺了它整个 @ 提及会抛错。我们有 `async () => []` 占位。
3. **协议解析靠字面量 `</quote>\n</citation>`**：转义只处理 `\` 和 `<`（用 `\u003c`），
   `>` 与 `&` 保持原样——别顺手把 `>` 也转了，解析器会失效。

## 反馈与贡献

- 🐛 Bug / 功能建议：[Issues](https://github.com/yupaoa/dsh-citation/issues)
- 🔧 代码贡献：PR 前请确保 `npm test` 全绿
- 🔐 安全问题：见 [Issues](https://github.com/yupaoa/dsh-citation/issues)（当前无独立安全流程）

## 许可证

[MIT](LICENSE) © 2026 yupaoa

---

## English

**Cite a passage from a reply — right-click, add to conversation, send it with provenance.**

A third-party plugin for DeepSeek Harness. Select text inside a finished assistant reply, pick
**Add to conversation**, and the passage becomes an uneditable chip in the composer. On submit the
chip expands into a block carrying the turn, the character range, and the exact text; the sent
bubble folds that block back into the same chip.

Requires DSH `>= 0.2.1-rc.3` and Node.js `^22.19.0 || >=24.0.0`. A ready-to-run `client.js` is
committed, so **GitHub and local installs work today**. This plugin is **not published to npm**.

> **DSH now ships this too.** Since `0.2.2-alpha.2` the host can quote a selection into the composer
> as a plain Markdown blockquote — no provenance. This plugin adds the `turn / range` provenance,
> with the same entry point; see [Relationship to the built-in
> feature](#vs-builtin-en) below.

```bash
# 1) straight from GitHub (recommended — no build step, the artifact is committed)
dsh plugin add --profile desktop "github:yupaoa/dsh-citation"

# 2) local directory (development / offline)
dsh plugin add --profile desktop "link:D:\path\to\dsh-citation"
```

Fully restart DSH after installing, upgrading or removing the plugin — reloading the page is not
enough. Uninstall with `dsh plugin remove --profile desktop dsh-citation`.

<a id="vs-builtin-en"></a>

### Relationship to the built-in feature

DSH **`0.2.2-alpha.2`** (2026-10-28) ships quoting of its own (`@deepseek-ai/dsh-message-quotes`):
select text in a reply, hit the **Quote text** button next to the selection, and it lands in the
composer with a folded preview after sending. Same entry point, different payload:

| | Built-in (`0.2.2-alpha.2`+) | This plugin |
| --- | --- | --- |
| What the model receives | a plain Markdown blockquote, one `> ` per line | `<citation turn step range anchor session>` + `<quote>` |
| Provenance (turn, character range) | **none** — the model only knows text was quoted | yes, locates the exact turn and range |
| In the composer | an editable QuoteNode | an atomic, uneditable chip |
| Entry point | floating button beside the selection | right-click → *Add to conversation* |

Use the built-in one if all you need is the text; use this plugin if the model should know *which
turn and which characters* it came from.

**Coexistence.** The plugin probes the host's `insertQuote` capability (which the built-in quote
path uses). When the host already offers quoting, the plugin **stops injecting its context-menu
item** and leaves the selection's right-click to the browser, so you never see two quote entries.
On `0.2.1` and earlier the capability is absent and everything behaves as documented above.

### What it does

- **Right-click menu gains one item.** On a valid selection inside a settled assistant reply the
  menu offers **Copy** and **Add to conversation**; every other selection (two replies, streaming,
  buttons, code-block toolbars, thinking blocks, whitespace) is left to the browser's native menu.
- **Atomic, uneditable chip.** `Quote · turn 3 · 128 chars` — you cannot edit half of it, only
  delete it whole.
- **Original text on hover**, in the composer and inside sent bubbles; it is selectable and
  copyable, and never steals focus.
- **A model-readable block on send**:

  ```
  I quoted the following 1 passage from earlier replies:
  <citation turn="3" step="0" range="128:412" anchor="a1b2c3d4" session="d4f1…">
  <quote>the quoted passage, verbatim</quote>
  </citation>

  your question
  ```

  (Chinese UI emits `我引用了以下 1 条回复内容：`.) The prefix folds back into a chip in the sent
  bubble.
- **No silent truncation.** Under 20000 characters the quote is verbatim; beyond that the head 75%
  and tail 25% are kept and the block states how many characters were dropped.
- **No duplicates, at most five quotes per message.**
- **Survives rewind.** `dsh-rewind` pushes the originally submitted text back into the composer;
  the plugin detects the block and rebuilds chips + body instead of showing raw markup.

### Permissions and boundaries

**No filesystem access, no network requests (inbound or outbound), no tools or slash commands
registered, no credential reads. The only things that change are your draft and the message you
send.** DSH plugins run with the host process's privileges — there is no separate sandbox — so this
section lists the capabilities actually used, which is what an audit should look at.

| Surface | When | What |
| --- | --- | --- |
| Composer draft | you click *Add to conversation* | inserts a chip through the host's public `insertReference` / `insertText` / `setDraft`; draft persistence stays the host's business |
| Session message | you press send | the chip expands into the block above — a draft-text transformation, no extra request, no extra write |
| Page DOM (temporary) | while menu / popover / toast are shown | three self-created nodes under `<body>`, removed on close; one `<style data-dsh-citation>` |
| Clipboard | only when you pick *Copy* | `navigator.clipboard.writeText`, falling back to `execCommand('copy')`; the clipboard is never read |
| Process memory | plugin lifetime | one `label → citation` map (max 50 entries) used for hover lookups |

Read-only surfaces: the reply DOM (`data-chat-turn`, `data-chat-anchor-key`,
`data-conversation-session`, `data-streaming`, `data-chat-flow-kind="assistant-step"` — **internal
host contracts, not a public API**), the `conversation.input` / `inputTriggers` /
`uiConversation.userText` / `slots` / `locale` / `sessions` services, and your selection (read once,
at right-click).

One implementation detail worth knowing: to keep rewound drafts readable, the plugin wraps
`conversation.input.for(scope)`'s `setDraft` (original kept, restored on unload). It only acts on
drafts containing the `我引用了以下 ` prefix; if rebuilding fails it strips the machine markup and
keeps the body, so no content is lost.

Uninstalling leaves nothing behind: no config files, no background process, no host settings
changed. Older messages keep their quotes as plain text.

### Known limits

- Depends on the host's internal DOM contract (target: DSH `0.2.1-rc.3`). If a future host release
  changes it, the plugin quietly stops offering the menu — it never throws into the UI and never
  breaks the native context menu.
- Bubble folding needs the `uiConversation.userText` rule and the `conversation.user.text.node`
  slot; without them insertion and sending still work, the bubble just does not fold.
- After a page reload, restored chips cannot be resolved back to their quotes (the label map is
  per-session), so hover shows the host's native tooltip only.

### Development

```bash
npm test        # node --test test/*.test.js — no dependencies, no network (51 cases)
```

`client.js` is a single-file client half (`window.__ModuleLoader__.load` factory, `//#region`
sections, no bundler). Tests run in Node against a minimal fake DOM (`test/fake-dom.js`) and a fake
`window.__ModuleLoader__` (`test/harness.js`), so the menu, the popover and the toast are covered
without a browser.

[MIT](LICENSE) © 2026 yupaoa
