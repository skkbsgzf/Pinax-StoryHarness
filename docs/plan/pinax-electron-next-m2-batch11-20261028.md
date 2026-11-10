# Pinax-Electron-Next M2 批次11：调度派单制首跑——载体管理面板＋世界书条目编辑＋大纲树（2026-10-28）

> 作者两项新指令的合成：①配置项面板（插件系统）与核心页面（世界书/大纲/小说套件）逐步补全，边盘点边推进，保持前后端契合度；
> ②作者承担调度派单身份，执行交 coder（原点名 DeepSeek V4 Flash；该模型本机未配置，本批实际用 GLM-5.3-Flash——**批次12 起按作者修正切 Qoder 侧 DS V4 Flash**，工单交接面 = [批次12 派工单](./pinax-electron-next-m2-batch12-dispatch-20261028.md)）。
> 本批 = 派单制首跑：调度方写 3 张工单 → coder（动态工作流，门禁硬闸）执行 → 调度方验收修复提交。

## 1. 三张工单的交付（全部门禁一次实跑全绿）

**A1 载体管理面板**（`next/shell/menus.mjs`、`AppNext.vue`、`shell-ui.spec.mjs`、`shell-contract.test.mjs`）
- 菜单「设置 → 载体管理…」→ 独立面板：逐载体列标题/主载体徽标/dataDirs/scopes/工具数；启用停用走 `carrierSetEnabled`、切主载体走 `carrierSetPrimary`，均带 expectedRevision 并操作后刷新；主载体不可停用（禁用+提示）。
- 真窗口截图 `png/10-light-carriers.png`：面板与索引窗大纲树、右栏工具面(21) 同框。

**A2 世界书条目编辑**（`next/carriers/setting/*`、`useBoardData.mjs`、`CarrierPaneHost.vue`、7 个测试文件、`acceptance.mjs`）
- 合同变更（作者批准）：设定载体 `file:世界书:r→rw`、工具 +`pinax_worldbook_save`，manifest 版本 0.2.0→0.3.0。
- `pinax_worldbook_save`：path/text/expectedRevision 必填，返回形状照 `pinax_chapter_save`；面板 entry-detail 加编辑态（textarea + 保存为新版本 + 取消），保存走工具通道、成功刷新版本号。真窗口截图 `png/11-light-entry-edit.png`。
- **语义裁定 dwfq-f2369ffa-2**：save 保存的是正文——契约条目保留既有 frontmatter 只换正文（parse/serialize 复用 `shared/worldbookFileContract.js` 同一对，产物恒为契约 v2），裸 md 与新建原样写。工单字面（整份落盘）会让面板首次保存就洗掉 id/type/keys/tags/relations 且 openEntry 按 id 重读必断（coder 实测复现后升级，调度方裁定采纳其推荐）。
- **断言同步裁定 dwfq-f2369ffa-1/3**：合同变更使 5 个清单外文件把旧合同编成硬断言（declaredOutsideKernel 清单、写族闸拒绝语、聚合面 20→21、自有工具白名单留名、acceptance 两条 record 含只读板块不变量改写为「约束仍拒＋世界书经自有 save 覆写种子文件 revision 1→2」）。全部按「只改断言事实、不动判定逻辑、不增删用例、不碰内核 19 面红线」同步，逐处列名。

**A3 大纲树进索引窗**（`useBoardData.mjs`、`IndexWindow.vue`、`carrier-pane.spec.mjs`）
- 复用已认领的 `pinax_outline_read`：章节树下「大纲」区静态列出节点（空大纲给说明不报错、错误摊 `.nx-index-error`、设定板块切换时清状态）。真窗口截图 `png/10`（大纲 3 行可见）。
- 大纲行用序号不假设节点形状（outline.json 的 nodes 无固定 depth 字段）；散文稿大纲的 warning 未上面板（记账）。

## 2. 验收阶段调度方另修的三件事

1. **真窗口克隆 bug（批次1 起潜伏，A1 面板首次踩中）**：截图时误点「设为主载体」触发真 IPC，`carrierSetPrimary` 的返回值带着 `fileService`（含函数属性）→ Electron 结构化克隆报 `An object could not be cloned`。进程内分发器与单测从不克隆所以一直没暴露。修复：`ipcContract.slimForIpc`（深剪成功结果：丢函数、剪顶层内核内部对象 fileService，ok/error 外形保留），`main.mjs` 的 `ipcMain.handle` 出线统一过裁剪；失败载荷原样。加单测锚（shell-contract）。
2. **三处过时注释**（coder 标记、不在其允许清单）：`next/carriers/index.mjs`、`next/carriers/setting/context.mjs`、`next/testing/acceptance.mjs` 的「设定只读/写盘一个都不声明」改为批次11 后事实。
3. **收编 Qoder 批次9 漏账**：`AssistantDialog.vue` 的老版 16px gutter 补回（+3 行，legacy-copied 块）此前未入库，本批收编。

## 3. 门禁与截图

- 调度方独立复跑 `verify:next`：验收 16/16、内核单测 **135/135**、外壳界面测 **36/36**、eslint 0 警、打包 a–k 全过。
- 工作流侧每张工单后门禁一次实跑全绿（`world.run`，Windows 沙箱 spawn 裸 npm ENOENT 一次，改 `node npm-cli.js` 显式路径后修复——批次9 已记过同款坑，工作流脚本又踩了一次）。
- 截图：`png/10-light-carriers.png`、`png/11-light-entry-edit.png`、`png/12-light-outline.png`（`D:\Pinax-e2e\next-batch7-shots\`）。

## 4. 诚实边界

- 新建向导截图（09）仍缺：并行会话清理 electron 实例会误杀截图进程（批次10 已记账），向导状态由界面测覆盖。
- **切主载体把 project.kind 一并改写**（novel→切设定后 kind 变 generic）：`setPrimaryCarrier` 既有行为，规范 D5 只说「切主载体只改 carriers」——kind 是否该跟随主载体待作者裁（批次10 截图事故的根因之一）。
- 散文稿大纲（只有 大纲.md）的 warning 未上面板；大纲行无层级缩进（不假设节点形状）；`pinax_outline_read` maxNodes 300 截断未处理。
- 世界书写入与 MCP 提案链的联动（agent 改世界书仍走提案）本批未动；载体交互写与 MCP 填充语义的对齐细节留给批次12 B3 对齐核对工单。
- 「设为主载体」按钮与「关闭」共用 `.control-quiet` 导致截图脚本误点——界面无歧义问题（人点不会错），脚本选择器已改精确；但按钮语义词汇可再分档，记账不立项。

## 5. 派单制首跑的复盘

- 工单纪律生效：coder 三次升级全是「宁停不猜」（合同断言余波×2、保存语义×1），取证到 file:line 级。
- 调度方的教训：合同变更类工单要预扫 verify 链的断言爆炸半径（只读语义/工具计数/白名单三个 grep 就能圈全），批次12 工单已按此写。
- 工作流基础设施：Windows 沙箱 world.run 的 npm 要走 `node npm-cli.js`（第二批工作流同款坑，已写进脚本注释）。
