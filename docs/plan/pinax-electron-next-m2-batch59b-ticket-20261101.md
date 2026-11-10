# 批次59b 工单：AppNext.vue 恢复（调度方误伤修复）（2026-11-01）

> 调度方：Zcode。执行方：Qoder CLI。
> **事故如实通报**：批次59 验收期，调度方为落「多载体共存」裁定对 AppNext.vue 做脚本手术时切除了约 30KB 的错误区域（意图删 collapseBoardWindows 的自动收起调用，因该函数定义在缩进块内、`\n}\n` 锚跨越到远处的列 0 括号），文件自 762 行起语法损坏。执行方批次59 的其余交付完好，本批只恢复这一个文件。

## 规格来源（恢复的验收标准＝这些必须全绿）

1. `next/tests/shell-ui.spec.mjs`（批次59 重写后的窗口系统用例——多窗共存/分屏对半贴/收起标签/关闭）
2. `next/tests/view-registry.test.mjs`、`next/tests/workspace.test.mjs`（v2 迁移与裁决）
3. `next/testing/acceptance.mjs`（35/35）
4. 批次59 记录 `docs/plan/pinax-electron-next-m2-batch59-20261101.md` 的交付描述（AppNext 的窗口管理器接线、多窗共存、事件订阅等）

## 任务

1. **恢复 `next/shell/AppNext.vue`**：按上述规格重建/修复——窗口管理器接线（PaneWindow 挂载、开/收/关/分屏事件、多窗共存渲染）、竖条 selectBoard 接线、服务事件订阅等。当前文件的其余部分（模板可保留的部分）能救则救，不能救就按规格重写该文件的 script 段。
2. **两条已裁定语义必须保持**：
   - `collapseBoardWindows` 的**自动收起调用不得恢复**（切换载体不收起上一载体窗＝多载体共存，调度方裁定）；该函数本体若不再被调用可删除。
   - 竖条右键「打开方式」与七钮不回归（批次59 删除清单）。
3. **验证**：五段全绿；内核 649 与界面 197 全部恢复（当前 3 个测试文件因本文件语法错误加载失败）。

## 允许文件

**仅 `next/shell/AppNext.vue`**（如恢复过程中发现确需子组件一行接线，先在 §7 声明再动，最小化）。

## 禁止边界

不改其他任何文件；不改测试（测试是规格不是被改对象）；不动协议/写族/文件服务；不加依赖；不起 Electron、不执行 git。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿＝恢复完成的唯一判据；§7 列出恢复的接线清单与测试恢复对照。

---

## §7 执行方回填 ／ §8 调度方验收

### §7.1 恢复范围与结果（批次59b 本工单）

- 只动 `next/shell/AppNext.vue`（恢复后 1 569 行）；模板／脚本均按批次59 规格重建，未改子组件、未改测试。
- 恢复依据：批次59 记录 §1／§3（窗口模型）＋`next/tests/shell-ui.spec.mjs`（批次59 重写后的窗口用例）＋`view-registry`／`workspace` 单测。
- 两条已裁定语义保持不变：
  - `collapseBoardWindows` 的自动收起调用**未恢复**，函数本体已不存在；`selectBoard` 只切 `activeBoardId` 并开／抬高该载体的窗，上一载体的窗原地保留（多载体共存）。
  - 竖条右键「打开方式」与批次35 七钮零残留（`visual-contract` 逐项断言通过，`grep "打开方式" next/shell` 零命中）。

### §7.2 恢复接线清单（按文件内落点）

| 接线 | 落点（AppNext.vue） |
|---|---|
| 工作区 v2 单例订阅／退订 | `workspaceSnapshot`＋`subscribeWorkspace`（104–107）、卸载退订（1333） |
| 窗口在册视图 | `openWindows`（按 `z` 升序，696–700）、`descriptorFor`（703）、`anyOpenWindow`（716）、`tabOrdinal`（721）、`chosenCenterPaneFor`（731） |
| 开窗／抬高（首窗占页、后续浮窗） | `showBoardWindow`（743–759） |
| 收起／还原／最大化／几何 | `collapseWindow`（762）、`expandWindow`（766）、`toggleWindowMaximized`（776）、`saveWindowGeometry`（781） |
| 分屏对半贴／关窗 | `splitWindow`（790–815）、`closeWindow`（817） |
| 索引窗「悬浮」钮＝开／收 overlay 窗 | `toggleBoardOverlay`（822–832） |
| 迷你大纲点行→大纲栏＋编辑面 | `openOutlineNodeFromWidget`（839–848） |
| 竖条点选＝切板＋开／还原该载体文档窗 | `selectBoard`（1079–1095）；**不调用任何自动收起** |
| 启动恢复 | `syncWorkspaceForView`（979–995）：首次有效清单→补数→`restoreActiveBoardFromWorkspace`（998）→无窗时开主载体窗；`hydrateWorkspace`（1004）经 `workspace:load` 读档、`attachPersistence` 回写（1031） |
| 窗口层渲染 | `.nx-window-layer`（1462–1511）：`PaneWindow` 逐扇挂载，几何／窗态／叠序／标签序号全透传；overlay 内容＝迷你大纲，其余＝`CarrierPaneHost` |
| Esc＝收最上非标签窗（弹窗／菜单让位） | `onWindowKeydown`（1043–1050）；`window` 捕获监听（1311）／卸载移除（1332） |
| 菜单事件 | `IPC_EVENT.menuInvoked`→`runMenuAction`（1298） |
| 项目事件合并刷新 | `onProjectEvent` 150ms 合并→`data.refreshFromProjectEvent`（1273–1284、1301） |
| 服务与通知公共池 | `IPC_PUSH.runtimeServiceLogChanged` 全量替换→`provide('pinaxServiceSnapshot')`（1303–1305、284） |
| 卸载退订 | 项目事件／服务事件／workspace／键盘监听统一在 `onBeforeUnmount`（1314–1335） |

### §7.3 验证（2026-11-01，执行方实跑）

| 段 | 结果 |
|---|---|
| `node next/testing/acceptance.mjs` | 35/35 通过 |
| `node --test "next/tests/*.test.mjs"` | 649 通过 / 0 失败 |
| `vitest run --config next/vitest.next.shell.config.mjs` | **194 / 197**；`shell-ui.spec.mjs` 88/88 全过；余 3 条在 `carrier-pane.spec.mjs`（2）与 `carrier-pane-real.spec.mjs`（1），原因见 §7.5 |
| `npm run lint:next` | 0 警告 |
| `node next/testing/bundleAssertions.mjs` | a–v 全过 |

### §7.4 与批次59c 的关系

批次59c 承接本工单遗留：按「多载体共存」裁定改写 `shell-ui.spec.mjs` 四条旧语义用例（详见批次59 记录补记）。用例改写对照不重复记在本文件。

### §7.5 遗留与诚实边界

1. **界面段仍 194/197**：`carrier-pane.spec.mjs:1127`（`.entry-text` 未限定窗口）、`carrier-pane.spec.mjs:1656`（`activePane()` 取首扇窗）、`carrier-pane-real.spec.mjs:139`（同 `.entry-text`）——三条都预设「切板后只剩当前板一扇窗」的旧语义，在共存裁定下必红。两个文件不在批次59c 允许清单，执行方未改；最小修法＝把查询限定到 `[data-test="entries-workspace"]` 或叠序最前的 `.nx-pane-window`，见批次59 记录补记 §10.4 的提议补丁。
2. 恢复期未起 Electron、未做真窗口实拍；窗口观感仍以调度方 §8 为准。
3. 未执行 git 命令。

## §8 调度方验收

（待调度方补。）
