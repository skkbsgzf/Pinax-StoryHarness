# Pinax-Electron-Next M2 批次23：载体重划六栏＋索引窗纯粹化＋悬浮大纲窗（2026-10-29）

> 作者模型修正的落地批：①点击载体＝纯粹本域内容页（小说只有正文按卷章分）；②每个模块独有栏（小说/大纲/构思/世界书/设定/资料）；③大纲悬浮窗（悬浮正文、随时收展）。
> 执行：workflow coder（DeepSeek flash）三单全绿；调度方验收（独立复跑 239/239＋83/83）；三次升级裁定（dwfq-fca63318-1/2/3）。

## 1. 交付

**A 载体重划（六栏）**
- novel 瘦身：dataDirs {manuscript:'正文'}，tools 6 把（chapter_list/read/save＋proposal_list/read/discard），scopes ['file:正文:rw','agent:ask']，providers ['selection']。
- 三新载体：**outline**（大纲/，outline_read/save＋散文稿回退块，contextProfile authoring-knowledge）、**notes**（构思/，notes_list/save，writing-selection）、**worldbook**（世界书/，worldbook_list/read/save＋meta 编辑从 setting 迁入，setting-research）——三者都经只读任务表核验（setting-field 的坑没再踩）。
- setting 瘦身：dataDirs {constraints:'约束'}，tools rule_list/save，providers rules/style。
- 竖条六格：小说/大纲/构思/世界书/设定/资料，各一棵本域树。

**B 索引窗纯粹化＋卷章层级＋提案迁移**
- fileService 目录递归语义：dir 接受「dataDir 名＋子路径」，归属按一级目录判、grant 按一级查；前缀只认完整一段（正文2 不算 正文）；子路径仍过 C2 与软链逃逸。
- pinax_chapter_list 返回平铺章＋volume 字段（顶层 null）；卷排序中文数字按数值（第一卷→第十卷）；两级封顶。
- 提案审阅迁统一二级页「文档」组新节（列表→点开→自动切含正文/的板→中栏对照＋采纳）；菜单「文件 → 提案审阅…」（CmdOrCtrl+Shift+P）。

**C 悬浮大纲窗（协议 v1.1-C）**
- `next/kernel/carrierManifest.mjs`：OPEN_SLOTS 加 'overlay'；validatePanes 校验并保留 width（200–600，缺省 300）；每载体至多一枚 overlay pane 的拒装闸。
- `next/shell/FloatingWidget.vue`（新）：宿主容器——拖动（位置记忆 localStorage `overlay.<paneId>`，每条访问走 storageKey.value 供门禁扫）、收起成侧缘标签、Esc 收起（统一二级页开着时挂起）、id props 拼位置键。
- AppNext：渲染 outline 载体的悬浮窗（大纲板未激活时也可用）；开关钮在索引窗大纲区标题行（仅 board 声明 overlay 时出现）。
- visual-contract 加 4 断言：宿主职责清单/载体 SFC 禁拖拽逻辑/AppNext 无硬编码坐标表/outline manifest 声明 overlay＋z 低于 --z-modal。

## 2. 门禁

工单侧三单各自门禁一次实跑全绿（233→235→239 递进）。调度方独立复跑：验收 16/16、内核单测 **239/239**、外壳界面测 **83/83**、eslint 0 警、打包 a–k 全过（内核 931.5 kB、外壳 1614.9 kB、渲染 529.4 kB、CSS 115.0 kB）。

## 3. 执行方上报、调度方已核

1. **scopes 追加 agent:ask 的偏离**：运行时 callTool 对载体持有工具硬性要求 agent:ask，缺了整组拒——四个新清单保留/补上，未改门禁。**裁定：正确**（授权模型不变）。
2. **contextProfile 自选**：outline 用 authoring-knowledge、notes 用 writing-selection、worldbook 用 setting-research——三者均断言只读任务非空且块表认得（批次18 的 setting-field 坑没再踩）。**裁定：正确**。
3. **协议 v1.1-B 挂账**：提案审阅仍留小说栏（SettingsModal/settings 不在允许清单，删了就是功能净损失）——挂账正确，批次24 一并迁。
4. **CARRIER_WRITE_CLASS 落点表**：执行方自建的工具落点表＋guardCarrierWriteGaps 门禁对账（漏点名/多余项/目录不归该载体三类）——好设计，保留。

## 4. 诚实边界

- **v1.1-A 挂账**：novel 板提案区仍在（v1.1-B 未迁，删了提案无处审阅）；大纲区已在（G3 迁入 notes/outline 各自板后 novel 板只留章节）——等等，大纲树已在 novel 板索引窗，纯粹性差提案区一项。
- **卷章两级封顶**：正文/第一卷/子卷/章.md 不进清单（凭完整路径仍可 read/save）；卷无折叠/展开。
- **悬浮窗**：位置记忆 localStorage（协议 v1.1-C 写偏好 JSON——偏差记账）；收起状态不落盘；窗口 resize 不钳位；jsdom offsetParent 回退分支（真实 offsetParent 分支未真窗口验证）。
- **世界书子目录**仍只记 skippedDirs（大梦的世界书/辅助 等子目录内容不进条目清单——按边界，后续批）。
- 大梦真实数据平铺（无卷子目录）——卷章层级能力就位，大梦数据不受影响。
- 未启动 electron（作者窗口在用）；打包产物未重建（源码级门禁全绿，产物重建由调度方验收做）。

## 5. 下批待办（批次24 候选）

1. 提案审阅迁统一二级页「文档」组（v1.1-B 挂账清账）。
2. outline/notes/worldbook 三新载体的「历史…」入口（historyTarget 扩类型）。
3. 写族闸拒绝提示的 ownedTools 精确化收尾（kernelWriteGuard 归属表已建，提示未切）。
4. 悬浮窗收起状态落盘偏好 JSON（v1.1-C 偏差收敛）。
