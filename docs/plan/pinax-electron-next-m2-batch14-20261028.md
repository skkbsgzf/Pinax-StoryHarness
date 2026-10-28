# Pinax-Electron-Next M2 批次14：git 快照历史（D0–D2）（2026-10-28）

> 作者裁定：R3 关闭（全面摒弃浏览器缓存/全面本地化）；历史用 git 机制定时存；
> 体积「Kit 包不算大，忽略门禁，打到包里」→ 内置 git 库随包发布。
> 执行：workflow（coder 跑在 **DeepSeek**：`deepseek/deepseek-flash$max`）三单全绿；调度方验收修复提交。
> 设计与派工单：[next-git-history-design](./next-git-history-design-20261028.md) ／ [batch14 dispatch](./pinax-electron-next-m2-batch14-dispatch-20261028.md)。

## 1. 交付

**D0 历史引擎 `next/history/gitHistory.mjs`**（内置 isomorphic-git 1.44.7）
- `ensureHistoryRepo`：`<root>/.pinax/history.git` 独立 git-dir＋外部工作树（项目根**没有** `.git`，不碰作者既有仓库）；仓库本地身份 `pinax <pinax@local>`。
- `markDirty`／`commitSnapshot`：脏清单只是"要不要提交"的触发闸；提交时只 add 允许前缀（正文/大纲/世界书/构思/约束/资料＋`.pinax/project.json`），`assets/` 永不入库。
- `listFileHistory`／`readVersion`／`diffVersions`（自写 Myers，25 轮随机属性检查验证 hunks 可精确还原两版）。
- 全返回 `{ok,value}|{ok:false,error:{code}}`；oid 只认 40 位完整十六进制。
- 打包门禁：体积上限 1.6 MB→**6 MB**（注释写明按 R3 裁定；实测内核 bundle 873.4 kB）；新增「渲染层产物不含 git 库」断言；Node 内建按 `isBuiltin` 放行（isomorphic-git 的 CJS 以裸名 `crypto`/`buffer` 被外部化）。
- 单测 `history-git.test.mjs` 7 例（两版历史/内容/diff/资产不入库/空脏/非法路径/删除进历史）。

**D1 定时与接线**
- `next/runtime/historyScheduler.mjs`：5 分钟定时（偏好 `historyIntervalMinutes`，0＝关闭）＋关窗兜底＋手动提交；定时器 `unref`。
- `fileService.setOnWrite` 钩子（未注入零行为）；`main.mjs` 在项目打开/新建/刷新时给新 fileService 重挂。
- 五条 IPC（`pinax:agent:history:list/show/diff/commit-now/probe`），未注入如实报缺。

**D2 历史 UI＋缓存退役**
- 统一二级页新增**「文档」组 → 文档历史**：左栏快照列表（时间＋摘要＋pinax），右栏 diff（新增行绿 `--signal-warm`）、「恢复到这一版」＋弹窗内二次确认。
- 入口：索引窗每行「历史…」内联按钮＋菜单「文件 → 当前文档历史…」。
- 恢复＝经载体工具（chapter/worldbook/notes/outline save，带 expectedRevision）**新增一版**，不改写历史；恢复前后各提交一次快照。世界书只恢复正文（frontmatter 保留现行）。
- `theme` 迁到偏好 JSON。

## 2. 验收（调度方）

- `package-lock.json` 同步（`npm install --package-lock-only --offline`，`npm ci` 不再会挂）。
- 独立复跑 `verify:next`：验收 16/16、内核单测 **155/155**、外壳界面测 **49/49**、eslint 0 警、打包 a–k 全过（内联 git 后内核 bundle 873.4 kB／渲染 386.7 kB／CSS 98.2 kB；外壳 bundle 约 1.5 MB 含 git 库，外壳暂无体积断言，记账）。
- **真链路实测**（`seed-history.mjs`，演示项目）：建仓→两次提交→`listFileHistory` 2 版→`diffVersions` 8 段且新增行正确→`readVersion` 旧版内容正确。
- **真窗口截图**：`png/24-light-history-list.png`（浅色·列表）、`25-light-history-diff.png`（diff）、`26-dark-history.png`（深色）。

## 3. 验收期修的两个真问题

1. **主题双真相源（真 bug）**：D2 让偏好成为权威，但仍从 localStorage 读首帧——两者不一致时启动结果取决于异步时序（实测：偏好写 light、界面起成 dark）。修复：**localStorage 只写不读**（仅保留给老前端的双写桥），`readScheme()` 返回应用默认；门禁从"≤2 处访问"收紧为"≤1 处且禁止 getItem"；迁移测试改为"不从缓存迁移、写默认值"。这正是 R3-1 的机器版。
2. **lock 缺口**：package.json 加了依赖但 lock 未同步（coder 环境不能联网装），调度方同步。

## 4. 诚实边界

- `.pinax/proposals/` 未进历史（设计 §5 曾提例外，D0 白名单未含）——提案留痕待补。
- 历史调度器没有仓内单测（D1 允许清单未含新测试文件，coder 用临时 smoke 验证）；本批未补，记账待补。
- `projectClose` 不停定时器（session.close 不清 projectRoot，既有语义）。
- 恢复只验证了章节分支的真链路；世界书/构思/大纲三条分支是代码走查＋jsdom。
- 世界书恢复只覆盖正文（frontmatter 不回滚）——与 save 工具既定契约一致，但是产品语义要作者知悉。
- 打包安装态未实测（内置 git 库的启动开销未量）；外壳 bundle 无体积断言。
- 旧 IndexedDB `revisions` 快照按裁定不导入（git 取代历史）。
- DeepSeek 侧发现的两处工单措辞问题（theme 双写与禁 localStorage 自相矛盾；D1 接线与"shell 不引 history"断言冲突）已由调度方在验收中裁定落地。
