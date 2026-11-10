# Pinax-Electron-Next M2 批次18：资料域载体＋备份与恢复＋大纲树层级（2026-10-28）

> 执行：workflow coder（DeepSeek flash）三单全绿；调度方验收发现并裁定两处合同不一致、修一个残留横幅，
> 独立门禁 194/194＋64/64、真窗口截图 35–37。

## 1. 交付

**G1 `pinax.reference` 资料载体（新）**：`资料/` 目录在骨架里早已存在但无人认领（只出现在只读归档）——本批给它正式载体：`dataDirs.documents='资料'`、`scopes ['file:资料:rw']`、capabilities `['reference.documents']`、工具 `pinax_document_list/read/save`（.md/.txt，随手带全文 20000 字封顶，expectedRevision 乐观并发）；索引窗「资料」树＋中栏阅读/编辑＋新建；上下文块「资料目录（篇名＋字数，正文不进信封）」。
**G2 备份与恢复**：零新依赖（不做 zip）——`next/runtime/projectBackupService.mjs`：导出＝整目录复制到 `<选定目录>/<项目名>-backup-<时间戳>/` 并写 `backup-manifest.json`（默认排除 `.pinax/history.git`，可含；备份位置落在项目内直接拒；符号链接不跟随）；恢复＝校验 manifest→目标必须空目录→复制回来（中途失败按目标是否本次创建决定清理或如实报错）。UI：统一二级页「备份与恢复」节＋菜单「文件 → 备份与恢复…」。
**G3 大纲树层级缩进**：按 edges 算 depth 缩进（10+depth×14px）、有子节点加极轻记号；**断链/环/自环/重复 id 一律整份平铺**（宁可全部一级也不造层级）；depth 只用于显示，保存载荷不带。

## 2. 验收期调度方裁定与修复（G1 上报的两处合同不一致）

1. **块种类单复数不一致**（真缺陷）：manifest 声明 `providers: ['reference']`、块 `kind: 'reference'`，而 `shared/agentContextProfiles.js` 的档案允许的是复数 `references` —— 运行时会把这块记成「档案不认这个种类，已忽略」，资料清单**永远进不了上下文信封**。裁定：改为 `references`（与既有档案合同对齐，不改档案）。
2. **上下文档案无只读任务**（真缺陷）：原 `contextProfile: 'setting-field'` 在只读任务表里查不到（`readOnlyTaskForProfile` 返回 null），资料当主载体的泛型项目里右栏提问会 `PINAX_DEPENDENCY_UNMET`。裁定：改 `setting-research`（既有只读档，档案允许 `references` 块）。
3. **换板残留横幅**（UI 缺陷）：资料板顶部显示上一块板的「已载入 1579 字」——`useBoardData.clearTransient()` 在 AppNext.selectBoard 时清 notice/error。

## 3. 门禁与截图

- 调度方独立复跑：验收 16/16、内核单测 **194/194**、外壳界面测 **64/64**、eslint 0 警、打包 a–k 全过。
- 截图（真窗口，`png/`）：`35-light-reference-board.png`（资料板：真实资料「开篇参考·哪吒讲古 1451 字」＋新建）、`36-light-reference-read.png`（阅读态）、`37-light-backup-section.png`（备份与恢复节）。

## 4. 诚实边界

- **RAG 检索未做**（探索结论明确）：`pinax_knowledge_search`/`pinax_project_index` 的实现在 `server/mcp/knowledgeIndex.js:129` 走 HTTP 打本机 Express（`PINAX_SERVER_URL`，默认 3001），Next 桌面没有该进程。三条路待作者裁：①桌面内嵌 HTTP 服务；②知识检索改进程内直调；③资料域先只做读写、检索延后（现状）。
- 资料只认 .md/.txt；PDF/图片/拖拽导入不做；不递归子目录（子目录如实记账）。
- 资料行无「历史…」入口（AppNext 的 historyTarget 未含 document）。
- 资料「渲染层→IPC→聚合面→文件服务→磁盘」目前只有 node 轨真链路覆盖，UI 面是假信封。
- 备份不做增量/定时/云端；导出期间不冻结项目（并发写会让备份"接近但不完全一致"）；`fs.copyFile` 不保时间戳/权限。
- 备份错误码 `BACKUP_INVALID`/`BACKUP_TARGET_NOT_EMPTY` 未走 kernel 码表（该表不在允许清单，`fail()` 会折算未注册码）——是否统一 `PINAX_` 前缀待裁。
- 大纲缩进无深度上限、行号仍按文档顺序（不显示 1.1 式编号）、不做折叠与拖拽。
