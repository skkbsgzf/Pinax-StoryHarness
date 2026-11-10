# 批次55 工单：渲染器注册＋长稿分页读（Cordis 线C·体感优先）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次53 已收口（tip `98c42a8`，@4 全量迁移）。工单源：roadmap §6，实质任务不改；**不做块编辑器**（PM 岔口仍未裁，textarea 保留为编辑态，分页只服务「阅读态＋大稿」）。
> 订正一处 roadmap 前提：《大梦》现稿单章是 KB 级（4–8 KB），不是 1 MB 级——分页读照做（机制迟早要），但测量记账按真实数字来，不预设量级。

## 任务（四条）

1. **`fs/fileService.mjs` 增只读分页口 `readRange({ pluginId, dir, file, from, to })`**：按字节区间读，返回 `{ text, from, to, totalBytes, revision }`；**绝不与写口混用**（写仍必须 expectedRevision 走既有三道闸）；归属闸照走（DIR_CONFLICT）；UTF-8 边界不截断字符（多字节字符跨区间时对齐到字符边界并如实标注）。
2. **渲染层按 `preview.loading` 分两档**：`text-pages` 首次只读首屏若干 KB 并懒补（滚动/翻页触发下一页），`bytes-complete` 保留整读（小文件、写前校验用）；载体经批次52 的 `preview.register` 指定哪个 pane 用哪档；**novel 载体的正文阅读面用 text-pages、编辑面保持整读**（textarea 编辑态不动）。
3. **治理「看着能点却点不动」复发面**：分页渲染后批次38/44 的 Wiki 双链词表（`buildEntryTokenMap` 唯一归属才进词表）**必须对每页各自生效**——词表按当前页文本现算；跨页残留锚点用批次44 那招 `:key` 强制重渲染；新增断言「跨页不残留旧蓝链」。
4. **复核既有阅读面回归**：批次43 的 md 原生渲染（marked+DOMPurify）在分页路径上照常（每页独立 renderMarkdown）；自动保存/指纹基线不受分页影响（编辑态整读不变）。

## 允许文件

`next/fs/fileService.mjs`（readRange）、`next/shell/CarrierPaneHost.vue`（阅读面分页渲染＋懒补）、`next/shell/wikiLinks.mjs`（如需按页词表的小切口）、`next/shell/styles/next-shell.css`（如需）、`next/runtime/agentRuntime.mjs` 或 `mcpSurface.mjs`（如 readRange 需要进工具面则走原生注册路——**默认不进工具面**，纯渲染层口）、`next/tests/`（readRange 纯逻辑＋分页 spec＋跨页蓝链断言）＋受影响测试、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改 `server/**`、`src/**`；不加 npm 依赖；**不动写口语义**（expectedRevision/STALE_REVISION 一字不动）；不动编辑态 textarea（PM 岔口未裁）；不动 12 份清单（@4 刚收口）；`readRange` 不做缓存层（首版直读，记账后另议）；不起 Electron、不执行 git。

## 守卫标记

批次45–53 全清单继承；本批新守卫：`readRange` 存在且不写 revisions 账、`buildEntryTokenMap` 仍唯一归属纪律、跨页蓝链断言在。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；「分页读的 revision 与整读一致」「跨页不残留旧蓝链」两条断言在；《大梦》真稿首屏读取字节数与首绘时间**记账**（数字如实，不设阈值）；`text-pages` 与 `bytes-complete` 两档各有用例。

## 记账指标（不进闸）

《大梦》真实章节的分页参数（每页 KB 数）与首绘时间；未迁移清单（若有）。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch55-20261031.md`；§8 由调度方补。**diff 指引必须用临时索引法**：

```bash
export GIT_INDEX_FILE=$(mktemp) && git --git-dir=D:/Pinax-pr/.git read-tree <基线提交号>
git --git-dir=D:/Pinax-pr/.git --work-tree=D:/Pinax-main/Pinax-main diff --stat <基线提交号> -- next/ docs/
rm -f "$GIT_INDEX_FILE"
```

裸 diff 会被 Pinax-pr 陈旧索引污染（假删除＋漏 untracked），勿用。）
