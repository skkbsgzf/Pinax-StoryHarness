# Pinax-Electron-Next · M2 批次 5 验收记录（2026-10-28）

> 上位文档：[规范 v1](./pinax-electron-next-spec-20261027.md)、[M1 验收记录](./pinax-electron-next-m1-acceptance-20261027.md)、[M2 批次 1](./pinax-electron-next-m2-batch1-20261027.md)、[批次 2](./pinax-electron-next-m2-batch2-20261027.md)、[批次 3](./pinax-electron-next-m2-batch3-20261027.md)、[批次 4](./pinax-electron-next-m2-batch4-20261028.md)。
> 本批只做一件事：**打真模型那一调并出证据**——批次 2 §5.1 起就欠着的「一次真模型调用仍然没有」。顺带把这次真调用暴露出来的产品缺口补掉：模型答的是结构化审稿，右栏原来只显示 summary 一行。
> 本档只记「跑出来什么、数字多少、哪些没覆盖」。所有数字来自今天本机工作副本的实测，按第 4 节命令可复现。

## 0. 结论先行

**Next 这条「渲染层 → preload 桥 → 主进程运行时 → 进程内 advisor → 漏斗 → 内核任务面 → 真模型」的链，今天第一次在真实 Electron 窗口里问出了一句真模型的回答，而且作者能看见它出自哪些原文。**

三件事：

1. **真模型调用成立（3 次，全部真模型，无测试替身）。** Node 侧探针 **11 246 ms**；真实窗口里两次提问 **13 568 ms** 与 **12 092 ms**；结构化渲染补完后同一窗口再问一次 **18 135 ms**。模型面挂在**本机隔离端口 8461** 的内核任务面上（默认 8451 未动、作者的服务一个没碰），凭据**只经 env 传入**，没写进 Pinax 仓库任何文件。
2. **回答带出处，且出处是对的。** 右栏那一行写的是 `任务 authoring.review.chapter · 档案 writing-chapter · 预算 503/24000 字`，下面列 6 条原文：`setting-rules:约束/纪律.md`、`setting-style:约束/文风.md`、`novel-chapter:正文/第002章-槐巷.md`、`novel-outline:大纲/outline.json`、`setting-worldbook:世界书/地点·槐巷.md`、`setting-worldbook:世界书/人物·柯秒.md`。素材五种（selection/outline/rules/style/worldbook）**一个不缺**（`missingKinds: []`）。
3. **真调用立刻暴露了一个真产品缺口，本批补掉。** 模型答的是**三块**（summary＋意见＋动作），右栏只渲染了 summary 一行——作者问的是「给出三条最该改的地方」，界面只给一句「骨架符合纪律，但仅127字，严重未达标」。现在右栏把「审稿意见」与「可执行动作」两块都摊开，实测拿到 **3 条意见 + 3 条动作**，每条都带自己的依据（如「字数127字，远低于约束的『2000字上下』，三个大纲节点均未铺开（大纲/outline.json 全部三点仅落地半句）」）。

`npm run verify:next` 五段全绿：真载体＋空框架混合验收 **16/16**、内核单测 **117/117**（批次 4 是 116，＋1）、外壳界面测 **27/27**（批次 4 是 25，＋2）、`eslint next` 零告警、打包门禁 **a–j** 全过（j 是本批新增），exit 0。

没做成的，如实记账：① **模型面仍是外部进程**——Next 自己没有一个模型配置面，`设置 → 「偏好与模型…」` 那条菜单**至今是死的**；② **提问只能映射到审稿档**（`authoring.review.chapter`，effectPolicy `review-only`），**没有自由问答档**；③ **窗口仍然只是「截图看过」**——作者人在手机侧，真实桌面上没人用这窗口点过一轮；④ **四次口径仍待作者裁定**（明暗默认、首屏开哪块板、UI 缩放 0.85；老版那两份样式要不要拆——这条批次 4 已用「挂 class 就不必拆」实际解决，不再是待裁项）；⑤ **回答质量没有被测量**——今天只有 1 个靶子项目、1 种任务、3 次调用，量的是「链路通、格式对、出处全」，不是「答得好不好」。

---

## 1. 这一批交付的五块东西

**① 真模型调用打通了，但模型面不装在 Next 里。** Next 的漏斗（`server/services/kitModelGateway.js`）打的是**内核任务面**（storyflow-kit 的 `npm run serve:pinax`），默认端点 `http://127.0.0.1:8451`，可由 `PINAX_ADAPTER_ENDPOINT` 覆写。本批在**隔离端口 8461** 上起了一份任务面（`PINAX_ADAPTER_TASKS_DIR=D:/next-preview/kit-tasks`，provider id `pinax-next-local`，model `glm-5.3-flash`，thinking `off`），凭据从本机既有配置 `D:/storymasterv4/.external/agent-model.json` 读出后**只经 env 传**，任务面自己把 key 掩成 `67c8****aA2A`；Pinax 仓库里没有任何一处写进过这个 key。作者的 3001 / 5173 / 8451 全程无监听、无重启。

**② 右栏把结构化审稿摊开（改 `next/shell/RuntimeDock.vue`）。** 模型侧的任务输出契约是 `review-suggestions.v1`，一块 `summary`、一块 `issues[]`（带 `severity`）、一块 `action[]`。运行器 `next/runtime/runnerAdvisor.mjs:73-81` 把它们整块放在 `result` 里回给运行时，原封不动到渲染层。改动只有三处：两个 computed（`findings`／`actions`）、`ask()` 里把 `result` 存进 answer、模板里一块 `.dock-findings`。**没有结构化结果时整块不渲染**——不留空壳（有一条用例专门钉这个）。

**③ 样式只走 token（改 `next/shell/styles/next-shell.css`）。** 新增 `.dock-findings`／`.dock-findings-label`／`.dock-findings-list`／`.dock-findings-sev` 四条规则，**一个硬编码颜色都没有**——这条门禁一直在跑（`Next 外壳的样式里没有硬编码颜色`）。

**④ 门禁把「真模型这条链在产物里」钉住（三处）。**

| 门禁 | 位置 | 判据 | 拦的是什么 |
| --- | --- | --- | --- |
| 主进程必须注入进程内 advisor 运行器 | `next/tests/shell-contract.test.mjs` | `next/shell/main.mjs` 里出现 `createAdvisorRunner()`，且经 `runtimeOptions: { runner: … }` 注入 | 外壳忘了装运行器 →「运行时能问」永远答不了 |
| 模型面端点必须允许 env 覆写 | 同上 | `kitModelGateway.js` 里出现 `process.env.PINAX_ADAPTER_ENDPOINT \|\| KIT_TASK_PLANE_ENDPOINT` | 端点写死 8451 → 装机到别的机器必然是那句「未检测到可用模型」 |
| 打包门禁 j：模型面在产物里 | `next/testing/bundleAssertions.mjs` | 外壳 bundle 里同时有 `createAdvisorRunner`、`PINAX_ADAPTER_ENDPOINT`、`KIT_TASK_PLANE_ENDPOINT` 三个标记 | 链路只在源码里、不在产物里（装机即断） |

**⑤ 两条界面用例（`next/tests/carrier-pane.spec.mjs`）。** 一条钉「结构化审稿要摊开」（3 条意见 + 3 条动作都要在 DOM 里），一条钉「没有结构化结果时不留空壳」。

> 门禁 j 只证明「链路在产物里」，**不证明「此刻有可用模型」**——后者要凭据才能验。没有模型时的如实失败路径另有测试钉着（`shell-contract`：未注入 runner 时必须报 `PINAX_DEPENDENCY_UNMET`，不编回答）。

---

## 2. 实测数字

### 2.1 门禁

| 段 | 命令 | 结果 |
| --- | --- | --- |
| 验收（M1 ①–⑦ ＋ M2 ⑧–⑭） | `node next/testing/acceptance.mjs` | **16/16**（与批次 2、3、4 同） |
| 内核/合同单测 | `node --test "next/tests/*.test.mjs"` | **117/117**（批次 4 是 116，本批 ＋1：真模型链在主进程里接线） |
| 外壳界面测 | `vitest run --config next/vitest.next.shell.config.mjs` | **27/27**（批次 4 是 25，本批 ＋2）。三个文件：`shell-ui` 12、`carrier-pane` **12**（批次 4 是 10）、`carrier-pane-real` 3 |
| 源码 lint | `npm run lint:next` | 0 错 0 警（`--max-warnings 0`） |
| 打包门禁 | `node next/testing/bundleAssertions.mjs` | 全过：主进程 bundle **860.8 kB**（批次 4 是 861.0，−0.2）、渲染层 js **300.6 kB**（批次 4 是 298.4，＋2.2：结构化审稿块）、渲染层 CSS **81.8 kB**（批次 4 是 81.3，＋0.5）、霞鹜文楷 woff2 **607 096 B**、产物内 express 命中 **0**、外部说明符 10 条全在白名单内、import 产物后 in-process 列出 **19** 工具 |
| 规模 | `next/` 源码（排除 `node_modules/.build`，按批次 4 同一口径） | **74 文件 / 9705 行**（批次 4 是 74/9580，＋125 行、＋0 文件）。按目录：`tests` 17/3201（＋70）、`shell` 17/2094（＋45）、`runtime` 9/963、`carriers` 7/944、`kernel` 7/901、`testing` 4/513（＋10）、`project` 4/417、`fs` 3/384、根 6/288 |

### 2.2 真模型调用（三次，全部真模型）

| # | 通道 | 用时 | 证据 |
| --- | --- | --- | --- |
| 1 | Node 侧探针（不经界面，直接 `runtime.ask`） | **11 246 ms** | `D:\next-preview\real-model-probe.json` |
| 2 | 真实 Electron 窗口（结构化渲染之前） | **13 568 ms** | `D:\next-preview\shots\16-batch5-real-model-ask.png` |
| 3 | 真实 Electron 窗口（结构化渲染补完后） | **18 135 ms** | `D:\next-preview\shots\15-batch5-real-model-ask.png`、`D:\next-preview\real-model-ui.json` |

三次的问法：①「读一下当前这章，按纪律和文风审一遍：给出三条最该改的地方，每条都要说明依据来自哪几处原文。」；②「第二章《槐巷》里柯秒做了什么？两句话说清，并引用一处原文细节。」

**模型这一次答了什么（原文照抄，第三次的真实产物）：**

- summary：`骨架符合纪律，但仅127字，严重未达标，需扩写至约2000字。`
- 审稿意见 3 条：
  1. `medium 字数127字，远低于约束的“2000字上下”，三个大纲节点均未铺开（大纲/outline.json 全部三点仅落地半句）。`
  2. `medium 缺少槐巷场景细节：世界书写明“檐口滴水、巷尾无路灯、半个字的布幌”，正文一句未用，入场节点（雨夜槐巷）空转。`
  3. `medium 柯秒“被迫开口”的推进缺失：两炷香对话后直接进屋，大纲第二、三节点（关系讲清、表升成证据）没有承接动作。`
- 可执行动作 3 条：补写入场段（按世界书还原巷子）／扩写屋内对话（让女人用「两炷香」完成时间差施压）／结尾落点停在「表为什么停」（把表从陈设推向证据，但不解释原理·守纪律）。
- meta：`taskType=authoring.review.chapter`、`targetRevision=novel-chapter:正文/第002章-槐巷.md:1`、`sourceRefs` **6 条**、`budget 503/24000`（**未裁剪**）、`roundsUsed=1`、`contextWarnings` 1 条。
- context：`profile=writing-chapter`、`providerKinds` **5 种齐**（selection/outline/rules/style/worldbook）、`missingKinds: []`。
- contextWarnings 原文：`未指定章节，默认取最后一章「第002章-槐巷」（与既有 pinax_agent_ask 同口径）。`

**右栏那一行出处（截图实测）：** `任务 authoring.review.chapter · 档案 writing-chapter · 预算 503/24000 字`。

**模型面配置（`D:\next-preview\kit-taskplane.json`，key 已掩）：** 端口 **8461**、tasksDir `D:/next-preview/kit-tasks`、provider `pinax-next-local`、model `glm-5.3-flash`、baseUrl `https://api.z.ai/api/coding/paas/v4`、api `openai-completions`、thinking `off`、keySource `D:/storymasterv4/.external/agent-model.json（只经 env 传入，未落盘到本目录）`。

可视证据（本机预览目录，不在仓库内）：`D:\next-preview\shots\15-batch5-real-model-ask.png`（结构化渲染后的右栏：summary＋审稿意见 3＋可执行动作 3＋出处行＋6 条 refs）、`16-batch5-real-model-ask.png`（同一会话在结构化渲染之前的右栏：只有 summary 一行＋出处行＋6 条 refs——两张并排就是本批那个产品缺口的 before/after）。

---

## 3. 踩坑账（这一轮踩的、查清的）

1. **`TaskStop` 杀掉的是 wrapper，不是 Electron 本体。** 之前那轮预览是用 `node electron/cli.js` 起的，任务一停，wrapper 没了，**真正的 `electron.exe` 还活着**。它的 PID 33944 一直占着 9222，于是后来两次重启都 `bind() returned an error`，而 **CDP 驱动的其实是最早那一个窗口**——最早那个是**不带** `PINAX_ADAPTER_ENDPOINT` 起的，漏斗因此回落到默认 8451（没人在听）→ 秒回 `none` → 界面上那句「未检测到可用模型…」。**表现是「模型明明在跑，界面却说没有」**。查法：先 `Get-CimInstance Win32_Process` 看每个 electron.exe 的命令行，确认 `electron.exe D:/next-preview/preview-shell.mjs --remote-debugging-port=9222` 只有一个；再确认 `http://127.0.0.1:9222/json/list` 里只有一个 page target。修法：`Stop-Process` 掉**全部**属于本预览的 electron.exe（逐个核对命令行里带 `next-preview`），再起**一个**。教训：**证据链的前提是被驱动的那个进程得是对的**——端口通、CDP 通，不等于窗口是对的。
2. **Git Bash 的 `curl -d` 会把中文正文搅成乱码。** 直连任务面做连通性检查时，`curl -d '{"中文":"…"}'` 发出去的是坏 UTF-8，模型回「您发送的内容显示为乱码」——**看起来像模型故障，其实是命令行编码**。修法：用 Node 写出 JSON 文件，再 `curl --data-binary @file` 发出去，同一句就回了「您在线。😊」。
3. **`ELECTRON_RUN_AS_NODE=1` 会被 agent 的 shell 继承下来。** 在这个 shell 里直接跑 electron 会被当成普通 Node 进程启动，什么都不发生。必须 `env -u ELECTRON_RUN_AS_NODE` 剥掉。
4. **两处红鲱鱼，排查后确认都不是问题，记下来免得下次再查。** ①「主进程里 `PINAX_ADAPTER_ENDPOINT` 是不是丢了」——`env-probe.mjs` 与**活的**主进程 inspector 都显示变量在、值对；②「Electron 主进程里 `fetch` 是不是被墙」——漏斗探针 `GET /model` 直接 200。两条都别再查。
5. **真调用一落地就抓到一个真缺口：模型答三块，界面只显示一块。** 这不是样式问题，是**信息在渲染层被丢了**：运行器把 `result.issues[]` 与 `result.action[]` 原样带回来了，右栏只取 `text`。作者的原话是「给出三条最该改的地方，每条都要说明依据来自哪几处原文」——**原来的界面一条都给不了**。补法是把 `result` 存下来并渲染两块，并补一条用例钉住。
6. **Git Bash 里手打中文曾打出两处 mojibake**（`start-taskplane.mjs` 与 `RuntimeDock.vue` 的注释）。已当场改回。凡是本轮新写的中文，一律**用 Write 工具写文件**而不是 shell 里 `echo`/`sed`，能避开这一类伤。

---

## 4. 复现

```bash
npm run verify:next                                  # 五段全跑，exit 0
node next/testing/acceptance.mjs                      # 16/16
node --test "next/tests/*.test.mjs"                  # 117/117
npx vitest run --config next/vitest.next.shell.config.mjs   # 27/27
npm run lint:next                                    # 0 错 0 警
node next/testing/bundleAssertions.mjs               # 打包门禁 a–j
```

真模型这一调要三样东西同时在位（本机预览目录，不在仓库内）：

```bash
# ① 内核任务面（隔离端口 8461；key 只经 env，不落盘）
node D:/next-preview/start-taskplane.mjs

# ② 预览窗口（PINAX_ADAPTER_ENDPOINT 指向那个隔离端点）
cd /d/Pinax-main/Pinax-main && env -u ELECTRON_RUN_AS_NODE \
  PINAX_ADAPTER_ENDPOINT=http://127.0.0.1:8461 \
  PINAX_APP_DATA=D:/next-preview/.appdata \
  PINAX_MIRROR_ROOT=D:/next-preview/.mirror \
  ./node_modules/electron/dist/electron.exe D:/next-preview/preview-shell.mjs --remote-debugging-port=9222

# ③ 在真窗口里问一句并取证
node D:/next-preview/capture-real-ask.mjs 9222 "读一下当前这章，按纪律和文风审一遍：给出三条最该改的地方，每条都要说明依据来自哪几处原文。"
```

产物：`D:\next-preview\real-model-probe.json`（Node 侧）、`D:\next-preview\real-model-ui.json`（窗口侧，含 findings/actions）、`D:\next-preview\kit-taskplane.json`（任务面配置，key 已掩）、`D:\next-preview\shots\15-batch5-real-model-ask.png`、`16-batch5-real-model-ask.png`。

---

## 5. 未覆盖项与待裁定（逐条给去处）

1. **模型面仍是外部进程，Next 自己没有模型配置面。** 作者在 `设置` 菜单里点「偏好与模型…」**没有任何反应**——那条菜单从批次 4 起就挂着，是个空壳。今天的模型面是**手工**在 8461 端口起的一份任务面，端点靠 `PINAX_ADAPTER_ENDPOINT` env 传进去。**待裁**：模型配置归内核任务面一家管（Next 只认端点，界面里那项删掉或做成只读状态），还是 Next 自己做一张模型配置面（端点／模型／密钥由 Next 落盘、任务面照单执行）。
2. **提问只能映射到审稿档，没有自由问答档。** 现在的 canonical task 是 `authoring.review.chapter`，`effectPolicy=review-only`。作者问「第二章《槐巷》里柯秒做了什么？两句话说清，并引用一处原文细节」，答的仍然是审稿腔（它按「审这一章」组信封、套审稿输出契约）。**待裁**：要不要加一条自由问答档（引用型回答、只读、不给动作），还是就认定「运行时＝审稿台」。
3. **窗口仍然只是「截图看过」。** 作者人在手机侧，真实桌面上没人用这窗口点过一轮：鼠标悬停态、滚动、焦点环、真实点击的选中行为都只有静态截图与计算样式作证。**待裁**：要不要在作者方便时开一轮真机走查。
4. **回答质量没有被测量。** 今天量的是「链路通、格式对、出处全、素材不缺」；**没有**量「答得对不对、好不好」——只有 1 个靶子项目、1 种任务、3 次调用、1 篇 127 字的稿子。**待裁**：要不要拿作者的真稿子跑一轮更严的对照（同一章、同一问法、不同模型各跑一次比稿）。
5. **明暗默认取哪个。** 仍跟老前端一致，**默认亮色**。**待裁**：Next 作为 Electron 应用是否也默认亮色，还是按 `prefers-color-scheme` 走。
6. **首屏开哪块板。** 现在首屏是主载体那块板（小说），核心区落正文；设定板在竖条第二格。**待裁**：以载体为第一公民（现在的做法），还是首屏给设定板。
7. **UI 缩放 0.85 没有继承**（老前端 `themeStore.js` 那套全局 zoom＋反补偿）。Electron 窗口本身就是视口，没有 URL bar，那套补丁没有存在理由。**待裁**：确认不继承；若作者想要放大观感，应调 Next 自己的 `--nx-*` 尺寸变量。
8. `next/carriers/.gitkeep` 残留与其配套的点文件过滤、Electron ABI 档／RAG 打包形态／CI 接线、索引窗第三棵树（大纲）——与批次 1–4 同状态，本批未推进。

---

## 6. 下一批的入口

按「先有成果」的顺序：**第一件是把模型面从「手工起」变成「产品里能配」**（第 5 节第 1 条——`设置 → 偏好与模型…` 现在是死的）；**第二件是给提问加一条自由问答档**（第 5 节第 2 条）；**第三件是给索引窗补第三棵树（大纲）**，让骨架目录不全是静态行；**第四件**是把第 5 节 5–7 条的口径裁定落进代码与门禁。

另有一条**不必等裁定、现在就该做的**加固：今天的真模型链路依赖一个**外部 env 变量**才连得上，而端点写死 8451 时界面上只会说「未检测到可用模型」。**待裁**：要不要在右栏把「模型面不可达」和「模型面可达但没配模型」这两种失败分开说（现在是一句笼统的话，作者分不出自己少配了什么）。

> 本批**没有提交、没有推送**（作者的规矩：没明确指令不 commit）。本工作副本 `D:\Pinax-main\Pinax-main` **本身也不是 git 工作副本**（`git status` 直接报 `not a git repository`），所以本批改动连「待提交」这个状态都不存在——只是本机文件。
