# Pinax-Electron-Next · M2 批次 6 验收记录（2026-10-28）

> 上位文档：[规范 v1](./pinax-electron-next-spec-20261027.md)、[M1 验收记录](./pinax-electron-next-m1-acceptance-20261027.md)、[M2 批次 1](./pinax-electron-next-m2-batch1-20261027.md)、[批次 2](./pinax-electron-next-m2-batch2-20261027.md)、[批次 3](./pinax-electron-next-m2-batch3-20261027.md)、[批次 4](./pinax-electron-next-m2-batch4-20261028.md)、[批次 5](./pinax-electron-next-m2-batch5-20261028.md)。
> 本批只做一件事：**把主页面上那些开发者向的无效备注、无效模块清干净，并把右栏改成老版作品资料助手那个形态的纯对话框**。
> 本档只记「改了什么、跑出来什么、数字多少、哪些没覆盖」。所有数字来自今天本机工作副本的实测，按第 4 节命令可复现。

## 0. 结论先行

**作者这一轮的原话（驱动本批）：**

> 「大的思路是 OK 的，但是你为什么要留这么多无效的备注、无效的功能、无效的模块放在主页上？而且，我的 Agent 不应该就是一个纯粹的对话框的设计吗？这个在原版也是有的呀。这里面有非常多的东西，你都可以直接从原版里面抽象成一个组件，然后直接丢进去。我觉得不需要我来决策什么。你每次做完之后，截个图发到最新的对话框里，我们来决定下一步怎么做就可以了」

四条诉求，本批逐条落地：

1. **无效备注清空。** 上一批右栏那一堆「内置 · 不可停用 · 预算优先级 · 工具 N 个」「一级公民（唯一）占位理由」「任务 / 档案 / 预算 503/24000 字」「来源 6 条」「写族闸 · 载体接管 · 工具归属」——全部从界面上撤掉，只留在内核的数据通道里。
2. **无效模块清空。** 索引窗里的「固化骨架」静态目录行、正文面板上的「板块声明：目录／权限／工具／上下文块」清单、保存口径脚注、核心区副标题里的「carriers 第 N 版」——全删。
3. **Agent 就是一个纯对话框，形态抽自老版。** 新组件 `next/shell/AssistantDialog.vue`（**199 行**）抽象自老前端真正在用的那个助手面板 `src/components/authoring/AuthoringKnowledgeAssistant.vue`（**950 行**，被 `src/components/authoring/AuthoringAssistantWorkspace.vue:10,67` 挂载）。右栏宿主 `next/shell/RuntimeDock.vue` 缩到 **90 行**，只管「把提问送进去、把回答排成会话、记住最后一轮以便重试」。
4. **老版那条规矩原样搬过来。** 老版把工具调用、思考过程、权限、出处、预算这类开发者向的事实**折进折叠层**，面上只留问答本身。新组件照抄这个做法：工具面收进底部的 `<details>`（默认收起，写着「工具面（20）」），其余一概不上面。

**真模型这一调仍然是通的**（本机隔离端口 8461 的内核任务面，真实 Electron 窗口，**7 826 ms**），答案还是三块：一句结论 + **3 条审稿意见** + **3 条可执行动作**。

`npm run verify:next` 五段全绿：验收 **16/16**、内核单测 **119/119**（批次 5 是 117，＋2）、外壳界面测 **27/27**、`eslint next` 零告警、打包门禁 **a–j** 全过。

没做成的，如实记账：① **模型面仍是外部进程**，`设置 → 「偏好与模型…」` 那条菜单**至今是死的**；② **提问只能映射到审稿档**（`authoring.review.chapter`），**没有自由问答档**；③ **窗口仍然只是「截图看过」**，没有真人在桌面上点过一轮；④ **这一批没有引入任何新能力**，只是把上一批的东西收拾干净——「把模型面做成产品里能配」「加自由问答档」「索引窗补第三棵树（大纲）」三件事原样挂着；⑤ **回答质量没有被测量**，今天仍然只有 1 个靶子项目、1 种任务。

---

## 1. 这一批交付的东西

### 1.1 抽出来的组件：`next/shell/AssistantDialog.vue`（新增，199 行）

抽象自老前端的作品资料助手。选它而不选别的，是因为**它才是老版真正在用的那一个**：

| 老前端文件 | 行数 | 是否在用 | 证据 |
| --- | --- | --- | --- |
| `src/components/authoring/AuthoringKnowledgeAssistant.vue` | 950 | **在用** | 被 `src/components/authoring/AuthoringAssistantWorkspace.vue:10,67` 挂载 |
| `src/components/authoring/AuthoringDock.vue` | 182 | **孤儿** | 全仓 `grep "AuthoringDock.vue"` **零命中**（只有 `src/composables/useAuthoringDockPreferences.js:1` 的注释里提了一句） |

搬过来的不是「像」，是**老版那套会话词汇本身**——class 名、度量、节奏都照抄：

| 老版词汇 | 作用 | 新组件里的同一条 |
| --- | --- | --- |
| `.authoring-knowledge` | 助手面板根 | 同名（外壳根 class，因此老版那套 CSS 词汇天然可用） |
| `.authoring-knowledge__toolbar` | 顶栏 | 同名，标题是 `Pi-Agent` |
| `.authoring-knowledge__intro` | 开场白「接下来，想写什么？」 | 同名 |
| `.authoring-knowledge__thread` | 会话区（`aria-live=polite`） | 同名 |
| `.authoring-knowledge__question-row` / `__question` | 提问气泡（右对齐） | 同名 |
| `.authoring-knowledge__answer` / `__answer-text` / `__answer-meta` | 回答与它的元信息 | 同名 |
| `.authoring-knowledge__composer` / `__input-row` / `__send` | 输入区与发送键 | 同名 |
| `.authoring-knowledge__agent-detail` | 开发者向事实的折叠层 | 同名（收着「工具面（N）」） |

老版的度量也照抄成字面量：**输入区圆角 20px、内边距 14px、发送键圆形、输入框最小高 98px、回答正文 15px/1.85、会话区内边距 20px 16px 28px、提问气泡右对齐**。之所以写成字面量而不是新建 token：视觉门禁只认老前端那 5 份 CSS 加上 `next-shell.css` 里定义过的变量，自造 `--assistant-*` 会被门禁判成「token 没有定义」。

**老版一条规矩原样搬过来**（这正是作者那句「为什么要留这么多无效的备注」的答案）：老版把工具调用、思考过程、权限、出处、预算全折进折叠层，面上只留问答。新组件的折叠层里现在放的是工具面清单（20 条），其余不上面。

### 1.2 右栏宿主：`next/shell/RuntimeDock.vue`（重写，90 行）

原来那一屏「运行时说明书」（内置／不可停用／预算优先级／工具数／占位理由／任务／档案／预算／来源／写族闸／载体接管／工具归属）**整块删掉**，现在只剩：

- 提问 → `pinax:agent:runtime:ask` 通道；
- 回答排成会话（用户一行、助手一行）；
- 记住最后一轮，失败时能重试（重试键在错误条里）；
- 没有桥时显示一句 `渲染层未接主进程桥（preload 的 pinaxNext 通道）。`。

结构化结果照旧透传：`result.issues[]` 摊成「审稿意见」，`result.action[]` 摊成「可执行动作」，没有结构化结果时整块不渲染。

**合同里的层级黑话也撤了**：`next/runtime/runtimeContract.mjs` 的 `title` 从 `Pi-Agent 运行时` 改成 `Pi-Agent`（「运行时」是内核内部的一级层级称呼，作者口径是不上界面），`tier: 'runtime'` 那个内部字段照旧保留。

### 1.3 主页面上撤掉的无效模块与备注

| 位置 | 撤掉的东西 | 现在是什么 |
| --- | --- | --- |
| `IndexWindow.vue` | 「固化骨架」那一组静态目录行（`skeletonDirs` 整条 prop） | 索引窗只列真条目（章节／世界书条目）＋只读归档 |
| `CarrierPaneHost.vue` | 「板块声明：目录／权限／工具／上下文块」那一整块 `<details>` | 不摆清单；清单仍从 `view` 通道拿得到（数据没删，只是不占界面） |
| `CarrierPaneHost.vue` | 保存口径脚注（`保存走 pinax_chapter_save（带修订号）…`） | 只有编辑器本体与保存按钮 |
| `CarrierPaneHost.vue` | 「该面板由载体「X」声明（槽位 right，id …）」这种内核口吻 | 「「剧本」这块板块的面板视图还没做出来。它的工具和上下文块照常可用——先在右栏问 Pi-Agent。」 |
| `CenterSlotHost.vue` | 副标题里的「carriers 第 N 版」 | `项目名 · 类型` |
| `AppNext.vue` | 空态文案里的「空框架」「运行时栏」「固化骨架」「D1/D2」「上下文块」 | 换成作者话（「竖条、索引窗和右栏对话照常可用」「它们给正文补背景」） |
| `next-shell.css` | `.dock-meta`／`.dock-reserved`／`.dock-provenance`／`.dock-surface`／`.dock-tools`／`.editor-note`／`.pane-meta` 整块样式（约 160 行） | 只剩 `.dock` 与 `.dock-hint` |

### 1.4 门禁：把「不许摆无效模块」钉死

| 门禁 | 位置 | 判据 | 拦的是什么 |
| --- | --- | --- | --- |
| 右栏是一个纯对话框 | `next/tests/visual-contract.test.mjs` | ① 老版 `AuthoringKnowledgeAssistant.vue` 与新组件**必须同时含** 7 个会话词汇（`__thread`／`__question-row`／`__answer`／`__answer-text`／`__composer`／`__input-row`／`__send`）；② `RuntimeDock.vue` **不许出现** `预算优先级`／`不可停用`／`一级公民`／`写族闸`／`载体接管`／`reservedSlotReason`／`budgetPriority`／`writeGuard` | 以后谁又把「运行时说明书」写回右栏，门禁红 |
| 主页不许摆无效模块 | 同上 | `IndexWindow.vue` 不许含 `固化骨架`／`skeletonDirs`；`CarrierPaneHost.vue` 不许含 `板块声明`／`editor-note` | 索引窗与正文面板不许再长出清单块 |
| 按钮共享词汇表 | 同上 | 允许的 class 前缀加进 `authoring-knowledge__` | 新组件里的按钮（发送键、重试键）走老版控件词汇 |
| 界面测改口径 | `next/tests/carrier-pane.spec.mjs`、`shell-ui.spec.mjs` | 选择器换成老版会话词汇（`.authoring-knowledge__input-row textarea`／`__send`／`__question-row`／`__answer-text`／`__findings`／`__actions`／`__error`）；并**反向断言** `authoring.review.chapter`／`已裁剪`／`novel-chapter:正文/第002章.md`／`载体接管`／`写族闸` **不许出现在面上** | 防止改回去而不自知 |

**这一批没有改任何既有门禁的松紧口径**（没有放松 token 检查、没有放行新颜色、没有给新按钮开后门），只加了两条新用例并把按钮词汇表扩了一个前缀。

---

## 2. 实测数字

### 2.1 门禁

| 段 | 命令 | 结果 |
| --- | --- | --- |
| 验收（M1 ①–⑦ ＋ M2 ⑧–⑭） | `node next/testing/acceptance.mjs` | **16/16**（与批次 2–5 同） |
| 内核/合同单测 | `node --test "next/tests/*.test.mjs"` | **119/119**（批次 5 是 117，本批 ＋2：右栏纯对话框、主页不许摆无效模块） |
| 外壳界面测 | `vitest run --config next/vitest.next.shell.config.mjs` | **27/27**（三个文件：`shell-ui` 12、`carrier-pane` 12、`carrier-pane-real` 3） |
| 源码 lint | `npm run lint:next` | 0 错 0 警（`--max-warnings 0`） |
| 打包门禁 | `node next/testing/bundleAssertions.mjs` | 全过：主进程 bundle **861.3 kB**（批次 5 是 860.8，＋0.5）、渲染层 js **297.3 kB**（批次 5 是 300.6，**−3.3**：撤掉了运行时说明书那一块）、渲染层 CSS **86.3 kB**（批次 5 是 81.8，＋4.5：搬进老版那套会话样式）、霞鹜文楷 woff2 **607 096 B**、产物内 express 命中 **0**、外部说明符 10 条全在白名单内、import 产物后 in-process 列出 **19** 工具 |
| 规模 | `next/` 源码（`.mjs`/`.vue`/`.js`/`.css`，排除 `node_modules` 与 `.build`） | **74 文件 / 9 715 行**（批次 5 是 74/9 705）。按目录：`tests` 17/3252、`shell` 15/1485、`runtime` 9/964、`kernel` 7/901、`shell/styles` 2/567、`testing` 4/513、`carriers/novel` 3/447、`carriers/setting` 3/432、`project` 4/417、`fs` 3/384、根 6/288、`carriers` 1/65 |

### 2.2 真模型调用（本批 1 次，真实 Electron 窗口）

| 通道 | 用时 | 证据 |
| --- | --- | --- |
| 真实 Electron 窗口（纯对话框形态下） | **7 826 ms** | `D:\next-preview\shots\18-batch6-agent-dialog-answered.png`、`D:\next-preview\agent-dialog-ui.json` |

问法：「这一章开头压得太紧，帮我看看第二章的场次节奏，给三条能直接改的意见。」

**模型这一次答了什么（原文照抄）：**

- summary：`开场过短过密，节奏缺停顿，场感不足。`
- 审稿意见 3 条（severity 均为 `medium`）：
  1. `全章仅127字，距2000字目标差距大，第一节点"雨夜槐巷"几乎没展开，入场感缺失。`
  2. `门内对话一拍接一拍，中间无停顿与场景拍，压迫感有了但没有换气点。`
  3. `停摆的表已摸一下，符合纪律；但缺少槐巷地点细节（布幌、檐口滴水），世界书元素未落地。`
- 可执行动作 3 条：`在进门前补一段柯秒在巷中站立的场次：雨、檐口滴水、半个字的布幌，约300字，垫足入场节点。`／`对话"两炷香"前后各插一拍静场（点灯或倒水的动作），让关系张力有呼吸。`／`屋内再给表一次特写（四点十七），为"表为什么停"的推进节点埋证据，控制在第三卷解释之外。`

**界面上现在长什么样（两张截图，本机预览目录，不在仓库内）：**

- `D:\next-preview\shots\17-batch6-agent-dialog-empty.png`：空态——顶栏「Pi-Agent」、开场白「接下来，想写什么？」、折叠的「工具面（20）」、输入区与圆形发送键；左边索引窗只列两章；核心区是正文。
- `D:\next-preview\shots\18-batch6-agent-dialog-answered.png`：一问一答——右对齐的提问气泡、「助手 01:54」、一句结论、「审稿意见」3 条（带 severity）、「可执行动作」3 条、折叠的工具面、输入区。**截图上找不到任何一处「运行时／一级公民／预算／写族闸／载体接管」字样**。

取证脚本同时记了一个数字：`面板里有没有开发者向的备注 = 0`（`D:/next-preview/capture-real-ask.mjs` 在 DOM 里数 `.dock-meta, .dock-reserved, .dock-provenance, .dock-surface, .dock-tools`）。

---

## 3. 踩坑账（这一轮踩的、查清的）

1. **老版里有两个助手组件，只有一个是真的。** `AuthoringKnowledgeAssistant.vue`（950 行）在用；`AuthoringDock.vue`（182 行）**全仓零引用**，是孤儿。差点抽错——查法：`grep -rn "AuthoringDock.vue" src/ scripts/`，零命中才敢下结论。教训：**「原版有」这句话得先查清楚是哪一个原版**。
2. **抽象组件时差点让视觉门禁红。** 老版那套 `--assistant-gutter`／`--assistant-input-padding`／`--assistant-input-radius` 是组件内局部变量，视觉门禁只从老前端那 5 份 CSS ＋ `next-shell.css` 里收 token 定义——自造 `--assistant-*` 会被判「token 没有定义」。改法：把老版默认态的值写成字面量（16px／14px／20px／98px／15px），**不动门禁**。
3. **这个工作副本不是 git 仓库，删文件不可逆。** 一度把 `RuntimeDock.vue` 改名成 `AgentDock.vue`，接着发现 `git rev-parse --is-inside-work-tree` 报 `not a git repository`——改名等于「删掉旧文件」，而新文件还没提交。改法：文件名保持 `RuntimeDock.vue` 不动，只重写内容；只删掉本轮自己刚建的另一个文件。**教训：改名／删除前先确认这个目录有版本控制兜底。**
4. **上一轮那个僵尸 Electron 又占了一次 9222。** `TaskStop` 停掉的是 `node electron/cli.js` 包装进程，真正的 `electron.exe` 还活着，于是重启时端口冲突、CDP 驱动的还是旧窗口（旧窗口跑的是旧 bundle，看起来像「改了没生效」）。查法同批次 5：`Get-CimInstance Win32_Process` 逐个核对命令行里带 `next-preview` 的 `electron.exe`，全部停掉再起一个；然后 `curl http://127.0.0.1:9222/json/list` 确认只有一个 page target。
5. **一个后台任务报了 exit 127。** 那是上一轮起 Electron 的后台任务，被我停进程时一并带死；空输出文件是块缓冲没刷盘，**不是**本批改动引起，也不是失败信号。已按新 bundle 重起，窗口正常。
6. **`ELECTRON_RUN_AS_NODE=1` 会被 agent 的 shell 继承。** 这次改用 `D:/next-preview/start-preview.mjs` 起进程（脚本里显式 `delete env.ELECTRON_RUN_AS_NODE`），凭据从 `D:/storymasterv4/.external/agent-model.json` 读出后**只经 env 传**，Pinax 仓库里没有落盘。

---

## 4. 复现

```bash
npm run verify:next                                  # 五段全跑，exit 0
node next/testing/acceptance.mjs                      # 16/16
node --test "next/tests/*.test.mjs"                  # 119/119
npx vitest run --config next/vitest.next.shell.config.mjs   # 27/27
npm run lint:next                                    # 0 错 0 警
node next/testing/bundleAssertions.mjs               # 打包门禁 a–j
```

真模型这一调要三样东西同时在位（本机预览目录，不在仓库内）：

```bash
# ① 内核任务面（隔离端口 8461；key 只经 env，不落盘）
node D:/next-preview/start-taskplane.mjs

# ② 重建并起预览窗口（PINAX_ADAPTER_ENDPOINT 指向那个隔离端点）
cd /d/Pinax-main/Pinax-main
npm run next:build:main && npm run next:build:shell && npm run next:build:renderer
node D:/next-preview/start-preview.mjs

# ③ 在真窗口里问一句并取证
node D:/next-preview/capture-real-ask.mjs 9222 "这一章开头压得太紧，帮我看看第二章的场次节奏，给三条能直接改的意见。"
```

产物：`D:\next-preview\agent-dialog-ui.json`（窗口侧，含 findings/actions/用时）、`D:\next-preview\kit-taskplane.json`（任务面配置，key 已掩）、`D:\next-preview\shots\17-batch6-agent-dialog-empty.png`、`18-batch6-agent-dialog-answered.png`。

---

## 5. 未覆盖项与待裁定（逐条给去处）

1. **模型面仍是外部进程，Next 自己没有模型配置面。** `设置 → 「偏好与模型…」` **是死的**。今天的模型面是手工在 8461 端口起的一份任务面，端点靠 `PINAX_ADAPTER_ENDPOINT` env 传进去。**待裁**：模型配置归内核任务面一家管（Next 只认端点，界面里那项删掉或做成只读状态），还是 Next 自己做一张模型配置面。
2. **提问只能映射到审稿档，没有自由问答档。** 现在的 canonical task 是 `authoring.review.chapter`，`effectPolicy=review-only`；问什么都被套成审稿腔。**待裁**：加一条自由问答档（引用型回答、只读、不给动作），还是就认定「Pi-Agent＝审稿台」。
3. **窗口仍然只是「截图看过」。** 作者人在手机侧，真实桌面上没人用这窗口点过一轮：鼠标悬停态、滚动、焦点环、真实点击的选中行为都只有静态截图与计算样式作证。**待裁**：要不要在作者方便时开一轮真机走查。
4. **回答质量没有被测量。** 今天量的是「链路通、格式对、素材不缺」；**没有**量「答得对不对、好不好」——只有 1 个靶子项目、1 种任务。**待裁**：要不要拿作者的真稿子跑一轮更严的对照。
5. **明暗默认取哪个。** 仍跟老前端一致，**默认亮色**。**待裁**：Next 作为 Electron 应用是否也默认亮色，还是按 `prefers-color-scheme` 走。
6. **首屏开哪块板。** 现在首屏是主载体那块板（小说），核心区落正文；设定板在竖条第二格。**待裁**：以载体为第一公民，还是首屏给设定板。
7. **UI 缩放 0.85 没有继承**（老前端 `themeStore.js` 那套全局 zoom＋反补偿）。**待裁**：确认不继承；若作者想要放大观感，应调 Next 自己的 `--nx-*` 尺寸变量。
8. **索引窗第三棵树（大纲）还没有。** 本批把「固化骨架」那组静态目录行撤了（它不是活数据），骨架里的大纲目前只有正文面板能用，索引窗列不出来。**待裁**：要不要给索引窗补一棵真的大纲树（走 `大纲/outline.json`）。
9. `next/carriers/.gitkeep` 残留与其配套的点文件过滤、Electron ABI 档／RAG 打包形态／CI 接线——与批次 1–5 同状态，本批未推进。

---

## 6. 下一批的入口

作者说「不需要我来决策什么」，所以下一批按「先有成果」的顺序由这边自己排：**第一件是把模型面从「手工起」变成「产品里能配」**（第 5 节第 1 条——`设置 → 偏好与模型…` 现在是死的，这是唯一一处「界面上有入口但没功能」）；**第二件是给提问加一条自由问答档**（第 5 节第 2 条）；**第三件是给索引窗补第三棵树（大纲）**（第 5 节第 8 条）；**第四件**是补一条现在就值得做的加固——把「模型面不可达」与「模型面可达但没配模型」这两种失败分开说（现在是一句笼统的话，作者分不出自己少配了什么）。

> 本批**没有提交、没有推送**（作者的规矩：没明确指令不 commit）。本工作副本 `D:\Pinax-main\Pinax-main` **本身也不是 git 工作副本**（`git status` 直接报 `not a git repository`），所以本批改动连「待提交」这个状态都不存在——只是本机文件。
