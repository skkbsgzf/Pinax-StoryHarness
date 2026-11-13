# 工单 P9 · 错误人话层＋看板栅格收敛（前端欠账清偿批）

> 基线：`D:\Pinax-next` @ `6ecba29` 之后（含 81247b7/0910045/fcbd92e 等，verify:next 全绿：验收 42/42、内核 1322/1322、界面 291/291、lint 0、打包过）
> 来源：作者 2026-11-11 UX 审计 P0 遗留（错误行话／白屏／引导缺失）＋ S0-S5 工单 S3-04（断点栅格）。
> 作者 2026-11-13 已裁定：错误文案＝发生了什么＋下一步怎么办；错误码只进详情，不进主文案。

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿（验收 42/42、界面 ≥291、eslint 0 警、打包过）。
2. 既有断言只许按本文允许的方式改写，翻案处注释「作者 2026-11-13 UX 审计裁定」。
3. 令牌纪律；不新增依赖；术语表（库/模块/条目/文档/提案）。
4. **运行时与内核的错误结构不动**（`agentRuntime.mjs`/`runnerAdvisor.mjs` 的 fail 载荷原样——翻译只在**渲染层展示时**做；原始错误照旧进「服务与通知」池与日志）。
5. 不执行 git；不启停 electron。

---

## 1. 任务 A · 错误人话层（新建 `next/shell/errorWords.mjs` 纯函数 + 展示点接入）

### 1.1 实测的三条行话（改前基线，截图在 `D:\Pinax-e2e\ux-audit-20261111\png\`）

| # | 现在屏上长这样 | 根因 |
|---|---|---|
| E1 | `工具 pinax_proposal_list 的进程内调用失败：MCP error -32602: MCP error -32602: Tool pinax_proposal_list not found 重试`（无项目点「提案审阅」时） | 没开库 → 运行时工具未挂载；**归因错位**（报「工具不存在」而非「没开库」），MCP 错误码重复两次，工具 id 直出 |
| E2 | `运行时执行失败：fetch failed（断在：组装上下文）`（右栏提问、无模型凭据时） | 英文原始错误＋内部阶段名直出 |
| E3 | `已处理（不足 0.1 秒）`（错误消息下方的时长行） | 零信息量的机制描述 |

### 1.2 humanize 规则（纯函数 `humanizeError(rawText, context)` → `{ title, hint, detail }`）

按序匹配（命中即停）：

1. `MCP error -32602` 且含 `not found` → title「这个功能还没接上当前库」，hint「先新建或打开一个库，再回到这一节。」——**归因纠偏**：这类错的根因是没开库，不是工具缺失。
2. `fetch failed` / `ECONNREFUSED` / `UND_ERR_CONNECT_FAILED` → title「连不上模型服务」，hint「到 设置·应用·偏好与模型 检查模型端点，或确认模型服务已启动。」
3. `MCP error -32602`（其他）→ title「参数没对上，这一步没执行」，hint「把这条错误反馈给开发者。」
4. 其余带 `断在：X` 的 → title 去掉英文原错，hint 保留阶段人话（阶段映射表：`组装上下文→准备写作资料`、`调用模型→生成回复`、`落盘→写入`；映射表外的阶段名原样保留但标注「内部阶段」）。
5. 都不命中 → title 原样返回（不硬翻）。

- **MCP 错误码去重**：`MCP error -32602: MCP error -32602:` 双层包裹折叠为一层，且只进 detail。
- **工具 id**（`pinax_proposal_list` 等）只进 detail，不进 title/hint。
- detail 永远保留原文（排查不丢信息）。

### 1.3 展示点接入（三处）

| 位置 | 改法 |
|---|---|
| `settings/ProposalsSection.vue` 错误横幅 | title 主文案＋hint 副文案；「重试」保留；原文（含错误码/工具 id）进 `<details>`「技术详情」折叠 |
| `AssistantDialog.vue` 错误回答（`.authoring-knowledge__error`） | title 主文案；hint 副文案；原文进该条已有的「过程」折叠 |
| `ConversationTimeline.vue` | **E3：时长 <0.1 秒时整行不渲染**（≥0.1 秒照旧「已处理 N 秒」）；错误条目的文本先过 humanize |

### 1.4 「模型未回报」chip 可点（引导缺失，审计第 3 件）

- composer 的「模型未回报」chip 改**可点**：点了开 `SettingsModal` 的「偏好与模型」节（复用既有 `openSection('prefs')` 通路）。
- chip 文案改「未配置模型」；tooltip「点这里去配置模型」。
- 发送钮禁用态的 tooltip 补「先配置模型再提问」。

### 1.5 验收

- [ ] 无库状态点「提案审阅」：横幅主文案「这个功能还没接上当前库」，无错误码/工具 id 上主文案，原文在折叠里。
- [ ] 右栏错误回答：主文案「连不上模型服务」＋hint，原文在过程折叠。
- [ ] <0.1 秒的「已处理」行不再出现。
- [ ] 「未配置模型」chip 可点且能开偏好节。
- [ ] 纯函数用例 ≥8 条（规则 1-5 各至少 1 正 1 反）。

### 1.6 允许改动的文件

```
next/shell/errorWords.mjs                    （新建，纯函数）
next/shell/settings/ProposalsSection.vue
next/shell/AssistantDialog.vue
next/shell/ConversationTimeline.vue
next/tests/error-words.test.mjs              （新建）
next/tests/shell-ui.spec.mjs
```

---

## 2. 任务 B · 看板栅格收敛（S3-04）

### 2.1 现状（两处硬编码）

- `EntriesBoard.vue` 与 `next-shell.css:991`：看板三栏 `260px : 1fr : min(46%, 430px)`。

### 2.2 落法

- 令牌化（`next-shell.css` token 区）：`--nx-board-tree-w: 260px`、`--nx-board-info-w` 按三档断点取值：
  - ≥1600：`min(40%, 480px)`
  - 1280–1599：`min(38%, 430px)`
  - 1024–1279：`min(34%, 380px)`
  - <1024：沿用既有窄屏折叠行为（信息卡折到阅读列下方，不动）。
- 两处硬编码替换为 `var(--nx-board-info-w)`；树宽同理 `var(--nx-board-tree-w)`。
- **判据**：1024/1280/1600 三档视口下，世界书板无横向溢出、信息卡不塌陷（条目名/字段不折行成竖排）、阅读列 ≥480px。

### 2.3 验收

- [ ] 三档截图无溢出无塌陷（真窗由调度方实拍，单测钉令牌与断点声明）。
- [ ] 信息卡收起钮照旧。
- [ ] `verify:next` 全绿。

### 2.4 允许改动的文件

```
next/shell/EntriesBoard.vue
next/shell/styles/next-shell.css
next/tests/shell-ui.spec.mjs
next/tests/visual-contract.test.mjs        （如钉栅格声明）
```

---

## 3. 完成定义

- [ ] 两任务各自verify:next EXIT=0（同一 Agent 顺序做，最后跑一次全量）。
- [ ] 每任务在回填里给：改动文件对账＋门禁读数＋limitations。
- [ ] 界面无错误码/工具 id 上主文案。

## 6. 回填格式

同 P1。
