# Pinax-Electron-Next M2 批次27：Agent 会话管理＋slash 路由＋@ 引用（2026-10-29）

> 作者指令：「参考 dsh，需要有会话管理……底部输入框的 / 弹出 skill，@ 弹出参考」。批次25 的提示层在本批升级为真路由。
> 执行方式：Codebuddy CLI（deepseek-v4.1-flash，213 轮，约 9 分钟）。调度方独立复跑门禁、截图、提交。

## 1. 交付

**会话管理**：`agentSessions.mjs`——按项目根隔离的 localStorage 存储（`agentSessions.<projectRoot>`，visual-contract 登记为第四条先例）、30 会话/每会话 200 条上限（静默丢最旧）、标题自动取首问前 24 字（可双击改名）、首启自动建空会话、存储写失败降级内存。toolbar「会话」按钮（带计数徽章）开轻量弹层：新建/切换/双击改名/✕ 删除，Esc 与点外收起（统一二级页打开时让位）。晚到的回答落回提问时的会话，不串台。

**slash 路由**：`slashCommands.mjs`——四条命令（/审阅 /大纲 /总结 /资料）＝预设问句模板＋`context.omit` 块种剪裁。提示菜单可点击/上下键/Enter 选中，选中把模板填进草稿（命令词不留在草稿），作者可改可补再发送；发送时 RuntimeDock 剥命令词、把 omit 并进 runtimeAsk 的 context，会话流里 user 行带命令徽章。命令词必须成词，正文里的 `/` 不误伤。

**@ 引用**：`agentReferences.mjs`——输入 `@` 弹清单（按 章节/条目/剧本 分组，投影自已打开栏目的 board 数据），点击把 `@《标题》` 插进草稿光标处；发送时经已有 runtimeToolCall 通道解析引用（worldbook 按 id/name、document 按 file——按真实 schema 落地），每条截 600 字、最多 4 条，拼成【参考·kind《title》】段；取不到的如实标注，不编内容。

## 2. 门禁（调度方独立复跑）

验收 **16/16** · 内核单测 **276/276**（＋18）· 外壳界面测 **89/89** · eslint 0 警 · 打包 a–k 全过（主 947.1 kB／外壳 1640.0 kB／渲染 620.8 kB／CSS 127.8 kB）。

## 3. 截图

`png/58-light-sessions.png`（会话弹层：计数徽章＋新建＋相对时间＋删除）、`59-light-slash-menu.png`（slash 四条命令 chips）、`60-light-slash-filled.png`（选中 /资料 后模板填入草稿）、`61-light-at-refs.png`（@ 清单：章节＋剧本分组）、`62-dark-sessions.png`（深色会话弹层）。

## 4. 诚实边界

- 未打开项目时会话只在内存（无身份可归属），重开即没。
- @ 清单只投影**已打开栏目**的数据：构思、约束、大纲不可引用；世界书条目要点开设定栏才进清单。
- 会话/消息超限静默丢最旧，界面不提示；相对时间按渲染时刻算不逐秒刷。
- 删除正在等待回答的会话，那条回答无处可落被丢弃。
- 思维链/子Agent/hook 显示仍未做（runner 合同升级，另行排期）；会话不做云同步/导出。
- 对话框交互（弹层/选中/插入/徽章）由执行方临时 spec 验过 5 例后删除；正式 `agent-dialog.spec.mjs` 留给后续批。
