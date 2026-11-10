# 批次46B 记录：标杆1 周边工具——查找替换＋快捷词取名＋导入导出＋排版偏好（2026-10-31）

> 标杆1 功能账周边收尾（下半）。执行：Qoder CLI（DeepSeek-Flash，303 轮/约 40 分钟，退出码 0），Zcode CreateWorkflow 编排派发＋独立复核。工单与 §7 详见 [工单](./pinax-electron-next-m2-batch46b-ticket-20261031.md)。

## 交付（细节以工单 §7 回填为准）

1. **查找替换**：fileService `searchChapters`（全书按 NNN 扫、命中封顶 500、带上下文 snippet）＋IPC `book:search`/`book:replace-current`（替换走 expectedRevision 闸，**全书一键替换有意不做**）＋索引窗查找条（Ctrl+F/查找钮、命中按章分组跳转）。
2. **快捷词＋取名**：`quickWords.mjs`（世界书 name/keys＋正文 n-gram 词频≥2 派生，启用/最近项纯内存不落盘）＋`nameGenerator.mjs`（纯本地词库＋世界书查重）＋浮层（快捷词/取名双页签＋搜索＋点击插入光标处）。
3. **导入导出**：`exportService.exportBook`（全书 NNN 聚合 txt/doc，清洗同源表）＋IPC `book:import-doc`（标题解析→NNN 顺延→`正文/NNN-标题.md`）＋索引窗导入入口。
4. **排版偏好**：WritingPrefsSection +4（段距/首行缩进/打字机滚动 rAF 节流/段落聚焦遮罩）＋prefsSet 白名单＋CSS 变量；novel manifest settings 本批不动（通用渲染器收编挂账批次47+）。
5. 执行中自修两处：换板 watch 复位查找状态（测试改挂载后基线）；`ipcContract` 引 exportService 把 node:fs 带进渲染层 bundle——拆纯口径模块 `bookText.mjs`，exportService 改导入再导出。

## 调度方验收（含验收期补刀三处，均调度方亲修）

- **补刀①（评审员 medium，真缺陷）**：单篇导入 NNN 顺延只数顶层散章——卷结构书（大梦 正文/卷一/）导入会得与卷内重号的顶层 001（盘面无冲突静默成功，fixture 全平铺钉不住）。修：`ipcContract.bookImportDoc` 收集 existing 时**下钻一级子目录**（卷章两级口径），带相对路径喂 `nextChapterName`（纯函数本就支持嵌套路径，执行方已有嵌套测试）。handler 级测试无现成挂点，如实挂账。
- **补刀②③（评审员 low，排版）**：`ipcContract.mjs` menuInvoke case 标签换行还原；`useBoardData.mjs` 批次41 块注释两行结构还原。
- **越界追认（评审员 low）**：useBoardData/appPreferences/AppNext/bookText 四文件在允许清单外但 §7 偏离 1–4 逐条自报且理由成立（数据层接线/偏好归一/CSS 变量落点/渲染层纯常量拆分）——**追认入批**。
- 基线漂移归属：93 个非 next/ 文件差异（叙事 agent 流式线主题、mtime 10-20/10-25）再次确认与执行窗口无关；**commit-worktree 只加 next/＋docs/＋根白名单，这些文件不可能随批次入库**（评审员提醒的「随本批带上」在提交脚本设计上不成立）。
- 门禁（补刀后调度方复跑 exit 0）：验收 20/20（toolCount **39/24** 不变——本批不加 MCP 工具）·内核 **548/548**（+18）·界面 **179/179**（+11）·eslint 0 警·打包 a–n3 全过（主 1,711.0 kB/外壳 1,986.9 kB/渲染 1,053.9 kB）。
- **真窗口抽查**（dameng-px，`D:\Pinax-e2e\next-batch46-shots\png\`）：98 Ctrl+F 查找条（搜索输入框实现确认）；99 快捷词浮层（双页签＋搜索框＋**正文提取组真出 dameng-px 的 n-gram 词**：柯秒/白灼/霓虹/积水…）。整本导出/单篇导入走系统对话框，自动实拍不做（服务层测试覆盖）。

## 已知边界（如实记）

1. 单篇导入的卷结构场景无 handler 级自动化测试（补刀①修后靠纯函数嵌套测试＋现场走查）。
2. 查找替换只做当前章替换（全书一键替换有意不做）；快捷词/取名不落盘（有意）。
3. 排版偏好仍应用级（与 novel.writing 同体系）；打字机/聚焦为行为开关。
4. 导入不支持 .docx（只 .txt/.md，老线同口径）。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
```
