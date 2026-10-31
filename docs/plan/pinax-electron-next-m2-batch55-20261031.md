# 批次55 记录：渲染器注册＋长稿分页读（Cordis 线C · 体感优先）（2026-10-31）

> 执行：Qoder CLI（DeepSeek-Flash）。工单源：[执行工单](./pinax-electron-next-m2-batch55-ticket-20261031.md)。
> 不执行 git；不启动/不杀 electron；未改 `server/**`、`src/**`；未加 npm 依赖；未动写口语义（expectedRevision／STALE_REVISION 一字未动）；未动编辑态 textarea；未动 12 份载体清单；`readRange` 无缓存层（首版直读）。

## 交付

1. **`next/fs/fileService.mjs` 只读分页口 `readRange({ pluginId, dir, file, from, to })`**
   - 按字节区间读，返回 `{ text, from, to, totalBytes, revision, requested, startExpandedBy, endExpandedBy, eof }`；`to` 为右开区间并钳到文件末尾。
   - 归属闸（`locate` → DIR_CONFLICT）、作用域闸（`file:<目录>:r`）、路径合法性照走；**不碰写链**，写仍必须 `expectedRevision` 过既有三道闸。
   - 修订号经 `peekRevision`（新增）：与整读同口径（盘上没有＝0、账上有按账、既有未记账＝1），但**不写 revisions 账、不清陈账**——分页读是浏览，不是建档。
   - UTF-8 边界只向外扩：起点落在 continuation 字节就前移到字符首字节，终点落在 continuation 上就后移到下一个字符首字节；扩了多少在 `startExpandedBy／endExpandedBy` 如实标注，`text` 里不会被劈开的半个字符（无 U+FFFD）。
   - 非法区间（负数、`to <= from`、非整数）如实 `INVALID_INPUT`；文件缺失同样 `INVALID_INPUT`。

2. **`next/shell/CarrierPaneHost.vue` 阅读面按 `preview.loading` 分两档**
   - 档位解析：`pane.preview.loading`（兼容 `pane.previewLoading` 覆盖口）→ 未声明时按 pane kind 回落（正文阅读面 `text-pages`，其余 `bytes-complete`）。
   - `text-pages`：`CHAPTER_PAGE_CHARS = 2400` 字一页；首屏只渲染当前页。草稿覆盖当前页时直接切片；草稿只载入前段（`truncated`）时，页尾缺口经 `pinax_chapter_read` 的 `offset／maxChars` 懒补（按 `file:offset:maxChars` 去重，页号票号防串页）。
   - 翻页：底部出现「上一页／N / M／下一页」分页条（`data-test="chapter-page-*"`）；阅读区滚到底（80px 内）自动补下一页。
   - `bytes-complete`：保留整读（`props.data.draft` 整份渲染），不出分页条；小文件与写前校验行为不变。
   - **编辑态 textarea 未动**：进入编辑仍用 `props.data.draft` 整读，自动保存／指纹基线路径不受分页影响。

3. **Wiki 双链按页生效（治理「看着能点却点不动」复发面）**
   - 词表仍走 `buildEntryTokenMap`（唯一归属才进表）；`chapterLinkTokens` 按**当前页文本**现算（`token => 当前页 text.includes(token)`）。
   - 阅读面 `:key="chapterReadingKey"`（页码＋文本长度；bytes-complete 档为 file＋revision）强制重渲染，**跨页不残留旧蓝链**。
   - 监听依赖含 `chapterEntryTokenMap`：条目晚于正文载入时也会重新链一次；点击 `.nx-wikilink` 经 `data.entry` 回到 `openEntry`。
   - 每页各自 `renderMarkdown`（批次43 的 marked＋DOMPurify 路径不变），分页路径不另开渲染分支。

4. **测试与门禁**
   - `next/tests/file-service.test.mjs` +1：字节区间、UTF-8 边界外扩标注、`revision` 与整读一致且 `revisions.json` 不变、EOF 钳位、非法区间、文件缺失、跨目录 DIR_CONFLICT、只读档读成功。
   - `next/tests/chapter-paging.spec.mjs` 新增 5 条：`text-pages` 首屏只取第一页／翻页才取下一页；24000 字大稿草稿之外经 `offset／maxChars` 懒补；`bytes-complete` 整读且无分页条；**跨页不残留旧蓝链**；唯一归属纪律照旧（共用词不染蓝）。
   - `next/testing/acceptance.mjs` +1 条（27 条）：真载体链路上 `readRange` 与整读同修订号、字节区间是整读前缀、UTF-8 外扩 2 字节如实标注、快照 `revisions.json` 前后一字节不动。
   - `next/testing/bundleAssertions.mjs` 新增守卫 `s1`（`readRange` 实现体走 `peekRevision`，不得出现 `saveRevisions／adoptRevision／revisions.set|delete`）与 `s2`（宿主 `text-pages／bytes-complete` 两档、`CHAPTER_PAGE_CHARS`、`offset／maxChars` 懒补、按页词表 watch，且分页 spec 里「跨页不残留旧蓝链」「唯一归属纪律照旧」两条断言在）。

## 验收

- `npm run next:build:main && npm run next:build:shell`：通过（main 1766.82 kB、shell 2028.78 kB、preload 5.30 kB）。
- `npm run verify:next`：**五段全绿，exit 0**。
  - acceptance：**27/27**（本批 +1 分页读记录；工具面 40／46、载体工具 24／23 不变）。
  - node tests：**601/601**（本批 +1 条 `readRange`）。
  - vitest shell UI：**192/192**（14 files，本批 +5 条分页／跨页蓝链）。
  - eslint：0 error／0 warning。
  - bundleAssertions：全过；新增 s1／s2；主进程 1791.9 kB（< 6 MB）、外壳 2066.4 kB（< 2.5 MB）。
- 两条点名断言在：**「分页读的 revision 与整读一致」**（acceptance 新记录 ＋ `file-service.test`）与 **「跨页不残留旧蓝链」**（`chapter-paging.spec` ＋ 守卫 s2）。
- 两档各有用例：`text-pages`（首屏／翻页／懒补）与 `bytes-complete`（整读无分页条）。

## 计数变化与理由

| 位置 | 变化 | 理由 |
|---|---|---|
| acceptance | 26 → 27 | +1：真链路分页读（revision 与整读一致、字节区间是整读前缀、边界外扩如实标注、revisions 账未动）。 |
| node tests | 600 → 601 | +1：`file-service.test` 的 `readRange` 纯逻辑（含不写账与 UTF-8 边界）。 |
| vitest shell UI | 187 → 192（13 → 14 files） | +5：新文件 `chapter-paging.spec.mjs`（两档渲染 3 条 ＋ 分页后 Wiki 双链 2 条）。 |
| bundleAssertions | +s1／s2 | s1 守「`readRange` 只读不写账」；s2 守「两档渲染＋按页词表＋跨页断言在」。行为本体由用例守，门禁只钉纪律面。 |
| 工具面计数 | 40／46、载体工具 24／23 不变 | `readRange` 是纯渲染层口，按工单默认**不进工具面**；12 份清单未动。 |

## 《大梦》记账（不进闸）

路径：`C:\Users\Administrator\D盘归档\写作\写作\Kit Project\大梦\正文`（只读；本批零写入）。

| 章节 | 字节 | 字符 | 页数（2400 字/页） | 首屏字节 |
|---|---|---|---|---|
| 第001章.md | 7748 B | 2698 | 2 | 6904 B（2400 字） |
| 第002章-延迟.md | 5403 B | 1917 | 1 | 5403 B（整章） |
| 第003章-倒带.md | 4539 B | 1579 | 1 | 4539 B（整章） |

- **分页参数**：每页 2400 字；《大梦》首章首屏约 **6.7 KB**（6904 B），全章 2 页。
- **首绘时间（node 级测量，非真窗口首绘）**：首屏文本 `renderMarkdown` 平均 **0.194 ms**（50 次，预热后）；整读文件＋首屏渲染平均 **0.403 ms**（100 次，文件缓存已热）。
  - 同一机器重复跑有抖动（前一次读数 0.475 ms／0.302 ms），记账只报数字不设阈值；Electron 未起，真窗口首绘未测。
- **参照**：当前 `useBoardData.openChapter` 仍先读 `maxChars: 20000`，三章均小于 2 万字，实际项目里正文一次就进了草稿；「草稿之外懒补」由 24000 字夹具用例覆盖。

## 偏离（已记录，非静默）

1. **`preview.loading` 的清单投影缺口**：`ipcContract.shellView` 尚未把清单里的 `preview.register` 投影到 `pane`，内置载体也未声明 `preview`；`ipcContract.mjs`／`useBoardData.mjs` 不在本批允许清单内。处置：`CarrierPaneHost` 先读 `pane.preview.loading`（或 `pane.previewLoading`）覆盖口，未声明时按 pane kind 回落（正文阅读面＝`text-pages`，其余＝`bytes-complete`）。清单侧声明留待后续批次（本批禁止动 12 份清单）。
2. **`readRange` 首版直读整份再切片**：按工单明确不做缓存层；`totalBytes／revision` 取自同一次读取／只读账本，浏览器侧按页补读已足够。后续若要避免整读，另开工单。
3. **`text-pages` 只接在正文阅读面**：小说编辑面 textarea 仍整读（PM 岔口未裁）；其他 pane 的 `bytes-complete` 行为与批次43 一致。
4. **`wikiLinks.mjs` 未改**：按页词表只需在宿主侧过滤 token 即可复用既有 `linkifyEntryNames`，无需开小切口。

## limitations

1. `pane.preview.loading` 目前只有宿主覆盖口生效；清单声明要等 `ipcContract.shellView` 投影与载体清单解冻后才能落到生产路径（默认值已保证正文阅读面走 `text-pages`）。
2. 首绘时间是 **node 级**（renderMarkdown＋读文件）测量，不是 Electron 真窗口首绘；未起 Electron，无法目视分页与滚动补页，交互由 jsdom 挂载级 vitest 覆盖。
3. 滚动触发「滚到底补下一页」只在阅读区容器上生效；若未来正文外层再套滚动容器，需要同步调整监听目标。
4. 懒补页按 `file:offset:maxChars` 去重且票号防串页，但同一页在外部改稿后仍靠 `chapterReadingKey`（页文本长度）重渲染；极端情况（改稿后长度恰同）由用户翻页或重载兜底。
5. 未做块编辑器（PM 岔口未裁）；`readRange` 未接任何工具名，模型与外部 MCP 都看不到分页口。

（§8 由调度方补。）

## §8 调度方验收（Zcode）

- 门禁独立复跑 exit 0（五段全绿）；真实改动 9 文件 +776/−4 零行尾翻转；执行方记录自落盘。
- 评审 1 条 low 裁定：**接受为披露偏离**——分页在渲染层（2400 字/页），底层 openChapter 仍整读 2 万字（useBoardData 不在允许清单），懒补分支由 24000 字夹具真实覆盖；《大梦》KB 级章节无实际影响。**登记**：首屏读路收窄（openChapter maxChars 降档）等真有大稿（>2 万字章节出现）再立小批。
- readRange 三道校验照走＋peekRevision 不写账＋UTF-8 边界外扩标注——写口零接触核实。
