# 批次75 工单：工作区状态与产物拷贝根治（2026-11-02）

> 调度方工单（独立可执行）。来源：批次66 记录的状态侧欠账（schema 停在 v3、`recentOpen` 本地 ref、滚动位置未做）、批次66/69 都提到但没人根治的**首趟产物拷贝**（第五段首跑红 7 项）、批次61/66 的订阅投递欠账、渲染层体积无闸。
> 基线：批次69 收口点（开工时以 git log 现查为准）。
> **注意**：本批会动 `next/testing/**` 与 `next/vite.*.config.mjs`——这两片以往不在允许清单里，本批把它们放进来，但**不与其它批并行**（拷贝顺序一动，别的批的门禁读数会跟着变）。开工前确认没有并行批次在跑门禁。

## 任务（七条）

1. **首趟产物拷贝根治**（**时序成因已实测**：拷贝在 `:79`、主进程构建在其后、`emptyOutDir: true` 在 `next/vite.next.main.config.mjs:16`；**「首跑红 7 项、原地重跑即绿」这个读数是【沿用】批次66 记录的实测量**（见 [批次66 记录:76](./pinax-electron-next-m2-batch66-20261102.md)），本轮未复跑——执行方开工第一件事就是自己复现一次 clean 首跑，把这条从【沿用】变成【实测】）：`next/testing/bundleAssertions.mjs:79 copySkillsToBuild()` 排在主进程构建**之前**，而 `next/vite.next.main.config.mjs:16 emptyOutDir: true` 会整目录抹掉 `.build/`，全靠外壳 `closeBundle`（`next/vite.next.shell.config.mjs:166-184`）补第二遍——于是全新工作树首跑第五段红 7 项（m／m2／n／n3／n4／n6／o），**原地重跑才绿**。修法择一并写理由：①拷贝挪到三段构建之后；②`emptyOutDir` 改成只清各自产物子目录；③两者都做。验收判据是**clean 首跑即全绿**，不是「重跑一次就绿」。
2. **workspace schema 升 v4**：批次66 明写「version 仍是 3，schema 未升」，而工单口径要 v4 补两格。升版本＋兼容读旧档（读到 v3 正常用、不硬拒），并把「哪两格、为什么」写进记录——**别造没人消费的新字段**。
3. **写盘 debounce 记账**：对照 Obsidian 的 1000ms 口径，工作区写盘加 debounce；**只记账不打回**（每次合并掉几笔、最长等待多少 ms，进 `服务与通知` 或记录）。
4. **`recentOpen` 进 viewState**：现在「最近打开栏自身开合」只在组件本地 `ref`，重启回默认展开（批次66 记的）。收进工作区状态轴，与批次66 已做的逐视图状态同构。
5. **滚动位置恢复**：批次61/66 两次写明「不进本批」，这次做。按页/按 pane 记滚动偏移，重启与换项目后回到原位；`normalizeViewState` 的形状扩展要与任务2 同批定，别改两次 schema。
6. **订阅精投与 IPC 负载细化**：【实测订正，本批比原先想的轻】多 topic 精投的**能力已经在总线上**——`next/runtime/eventBus.mjs:142 normalizeTopics(options.subscriptions)` 存进订阅者，`:200` 发的时候按 `payload.topic` 跳过不匹配的人（批次66 加的，缺省不给＝全收，行为兼容）。缺的是**调用方把每块载体自己的订阅词传进去**：`next/runtime/agentRuntime.mjs:209-211` 只挂一个宿主级订阅、不传第三个参数，`next/runtime/mcpSurface.mjs:88-89` 又把这个名单压成「谁含 `project.changed`」（硬编码一个词），`agentRuntime.mjs:56-67 deliverProjectEvent` 再把同一事件广播给名单全员——所以今天是「一份名单、全员广播」，不是「按词精投」。另注：【实测】`next/carriers/**` 内 `onProjectEvent` **0 实现**（11 份 manifest 声明了 `subscriptions`），投递路径按注释自己说的「是真实的、空的」；逐载体订阅可改用已存在的 `eventBus.mjs:164 subscribeProjectEventsEffect`（带注册表回卷），要不要换这条要裁。②IPC 那一跳仍只带 `{kind, at}`——【实测】`next/shell/main.mjs:525` 只转 `kind`／`at`，而总线 payload 本来就有 `topic` 与 `path`（`eventBus.mjs:192-196`），渲染层拿不到细负载，补上。
7. **渲染层体积闸（等人裁数）**：实测读数 `renderer js 1173.3 kB`（单 chunk、无体积闸；【实测】`next/testing/bundleAssertions.mjs:111` 闸主进程 <6 MB、`:182` 闸外壳 <2.5 MB、`:195` 把 renderer 体积**写成 check 的消息**——只有一条 `f 渲染层依赖薄` 的依赖内容断言，没有数值闸）。本批**先出拆分账**（谁占多少：老 CSS 3893 行、`@tiptap`、`isomorphic-git` 已排除在外等），给一条建议数值线＋理由，**由作者拍板后才进闸**——不自设阈值当隐形闸。

## 允许文件

`next/testing/bundleAssertions.mjs`、`next/vite.next.main.config.mjs`、`next/vite.next.shell.config.mjs`、`next/vite.next.renderer.config.mjs`、`next/workspaceStore.mjs`、`next/shell/AppNext.vue`、`next/shell/useWorkspaceState*`／视图状态所在文件、`next/runtime/mcpSurface.mjs`、`next/runtime/agentRuntime.mjs`、`next/shell/main.mjs`（IPC 负载段）、`next/tests/**`＋受影响 spec、`docs/plan/**`。

## 禁止边界

不改协议形态词表与窗口语义；不动写族闸；不改 `server/**`、`src/**`；不加 npm 依赖；不执行 git、不起 Electron；**体积数值线未经作者裁定不得进闸**；本批不与其它批并行跑门禁（见工单头注意）。

## 守卫标记

批次45–70 全清单继承；本批新守卫：**clean 首跑第五段全绿**（新增一条跑前清 `.build/` 的验收命令）、workspace v4 兼容读 v3、滚动位置与 `recentOpen` 的往返用例。

## 验收判据

`npm run verify:next` 五段全绿**且首跑即绿**（清 `.build/` 后跑，不用重跑第二次）；重启应用后开合状态与滚动位置一致（jsdom 层给可测部分，真机一致性随调度方实览并如实标注）；体积拆分账出到组件粒度。

## 记账指标（不进闸）

debounce 合并笔数与最长等待；`.build/` 拷贝时序改动前后的第五段耗时；体积拆分表；建议数值线（留名待裁）。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch75-20261102.md`；§8 调度方补。任务7 的数值线是本批唯一必须作者点头的产出。）
