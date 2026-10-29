# dsh-citation

划选回答里的一段文字，右键「添加到对话」，它就变成输入框里一个**不可编辑的引用胶囊**；
鼠标移上去才显示被引原文。发送之后，模型拿到的是「第几轮、哪个字符区间、原文全文」，
气泡里再折叠回一只胶囊。

给 DSH（DeepSeek Harness）Web / 桌面端用的第三方插件。

## 装

```powershell
git clone https://github.com/yupaoa/dsh-citation D:\dsh-ws\dsh-citation
# 有 dsh CLI：
dsh plugin --profile desktop add link:D:/dsh-ws/dsh-citation
```

没有 `dsh` CLI 时手工装（路径换成你自己的克隆位置）：

1. `~/.dsh/profiles/desktop/node_modules\dsh-citation` 建一个指向本目录的 Junction
   （`cmd /c mklink /J <上面这个路径> D:\dsh-ws\dsh-citation`）。
2. profile 的 `package.json`：
   - `dependencies` 加 `"dsh-citation": "link:D:/dsh-ws/dsh-citation"`
   - `dsh.profile.bundles` 末尾加 `"dsh-citation"`
3. 重启 DSH。

> 只支持本地 `link:` 安装，暂未发布到 npm。

## 用

1. 在任意一条**已经生成完**的 AI 回复里用鼠标划选一段文字。
2. 右键 → 菜单里除了「复制」还多一项「添加到对话」。
3. 点它：输入框里出现 `引用 · 第3轮 · 128字` 的胶囊，正文一个字都不多。
4. 鼠标移到胶囊上 → 浮层里是被引用的原文（可以选中复制），移开就收起。
5. 正常输入、按 Enter 发送。发送瞬间胶囊展开成：

```
我引用了以下 1 条回复内容：
<citation turn="3" step="0" range="128:412" anchor="a1b2c3d4" session="d4f1…">
<quote>被引用的那一段原文，逐字保留</quote>
</citation>

你的问题
```

模型因此知道：这是**第 3 轮**回答里字符 **128–412** 的那一段。气泡里这段前缀会被折叠回
胶囊，正文照常显示。

## 规则（为什么有时不出菜单）

| 情况 | 行为 | 原因 |
|---|---|---|
| 选区跨了两条回复 | 不出菜单 | 拼出来的引用一定错，宁可不动 |
| 回答还在流式生成 | 不出菜单 | 内容还会变，引用无法复现 |
| 选中的是按钮 / 代码块工具条 / 思考过程 | 不出菜单 | 那不是回答的正文 |
| 选中空白 | 不出菜单 | 没有内容可引 |
| 同一段已经引用过 | 提示「这一段已经引用过了」 | 避免重复占上下文 |
| 一条消息已引 5 段 | 提示上限 | 再多就是拿上下文换便利 |

## 已知限制

- **依赖宿主的内部 DOM 契约**：`data-chat-flow-kind="assistant-step"`、`data-chat-turn`、
  `data-chat-anchor-key`、`data-conversation-session`。这些不是公开 API，宿主大版本升级后
  可能失效——失效时插件会安静地不再出菜单，不会崩 UI。目标版本 **0.2.1-rc.3**。
- 输入框里胶囊的悬停原文靠“本页插入过的文案 → 引用”这张表反查，所以**刷新页面后**
  已恢复的胶囊只会显示宿主的原生提示，不会弹我们的浮层。
- 回退对话（`dsh-rewind`）会把发送时的原文塞回输入框，这里包了一层 `setDraft`：
  检测到引用块就重建成「胶囊 + 正文」；重建失败时至少把机器标记剥掉，不留乱码。
- 单条引用原文上限 20000 字（约 8–10k token），超出时保留头 75% + 尾 25%，中间写明省略
  多少字，避免模型误以为引用完整。
- 如果宿主的输入框不接受引用胶囊（未来改版），插件退化为插入一行位置标记
  `引用 · 第3轮 · 字符 128–412`，此时模型只能按位置定位，没有原文冗余。
- 卸载插件后，历史消息里的引用块会以纯文本形式显示（内容不丢）。

## 结构

```
client.js   客户端半身（单文件，window.__ModuleLoader__.load 包裹）
index.js    空的宿主半身（bundle patch 需要一个挂载点）
test/       node --test，纯逻辑 + 装配契约
```

`node --test test/*.test.js` 全绿才提交。

## License

MIT
