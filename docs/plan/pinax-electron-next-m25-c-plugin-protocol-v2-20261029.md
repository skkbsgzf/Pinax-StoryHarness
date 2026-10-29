# M2.5-C 交付记录：载体协议 v2 与工作区模型（2026-10-29）

> 执行方：Qoder（本会话，Pinax-Electron-Next 执行线）
> 工单：[pinax-electron-next-m25-c-plugin-protocol-v2-ticket-20261029.md](./pinax-electron-next-m25-c-plugin-protocol-v2-ticket-20261029.md)
> 结论：四条任务全部落地，门禁全绿。一块载体的「怎么摆」从单枚举拆成四轴（placement／minimized／geometry／restore），
> 状态从浏览器缓存搬进 `.pinax/workspace.json`；pane 可以用 `view:` 声明内容面，外壳不再按 id 前缀写死；
> 七块内置载体全部迁到 `pinax-carrier@2`，安装/卸载多了 `dispose`；宿主有了描述符与五态体检。

## 0. 来意（这批在整条路线里的位置）

M2.5 是一条三段的收口线，本批是第三段：

- **A（工具循环，默认关）**：解决「模型能不能动手」——工具选择、写策略、循环与轨迹。
- **B（技能包／模式真值／会话落盘）**：解决「模型说什么、记在哪」——技能渐进披露、写模式成为会话真值、会话落到 `.pinax/sessions/*.jsonl`。
- **C（本批）**：解决「界面上的东西怎么摆、载体怎么自我介绍」——工作区四轴、多实例、视图注册表、清单 v2、宿主描述符。

三批合起来才是「载体协议 v2 ＋ 工作区 ＋ 技能 ＋ 模式 ＋ 会话」这一层完整底座；C 之后，第三方载体第一次有了
「声明自己长什么样（contributes）」和「被宿主接纳或拒绝的明确理由（doctor 五态）」两件东西，而不是靠外壳加 if 分支。

本批的范围纪律：只做 C 单四任务与它点名的测试/门禁；不碰 `server/**`、`src/**`；不新增依赖；不启动 Electron；
不 commit／push（本工作副本本来就不是 git 仓库，改名即等于删除——所以本批只用新增与原地修改）。
账本更新是为了让主 agent 与后续会话能直接接管：`docs/STATUS.md` 里补 A/B/C 三段摘要，细节分别落在三份记录里；
本批没有产生新的待裁事项，已知遗留沿用 R 系列挂账。

## 1. 任务一：形态四轴（工作区模型）

| 文件 | 内容 |
| --- | --- |
| `next/shell/workspace.mjs` | 四轴状态机（纯函数＋可注入持久化）：`PLACEMENTS`／`MINIMIZED_MODES`（none／bubble／collapsed）／`SNAP_EDGES`；geometry 钳位 200–900 × 120–2000；`instanceIdFor`／`parseInstanceId`（`<paneId>#<n>`）；`createWorkspaceStore`、单例 `hostWorkspace`、`resetWorkspace`；方法 get／list／instancesOf／openInstance／place／restorePlacement／minimize／expand／setGeometry／bringToFront／dockPane／adoptLegacy／load／attachPersistence／snapshot／subscribe |
| `next/workspaceStore.mjs` | 磁盘层 `.pinax/workspace.json`（`version:1`）：写前 `mkdir`、先写 `.tmp` 再原子 rename、内容没变不写；坏文件不崩不覆盖——回空工作区并带 `WORKSPACE_BAD_JSON`／`WORKSPACE_NOT_OBJECT`／`WORKSPACE_VERSION_<n>`／`WORKSPACE_ENTRIES_MISSING` 记账 |
| `next/shell/workspaceMigration.mjs` | 老键迁移：`paneForm.<paneId>`（形态）＋`overlay.<paneId>`（位置）→ 工作区；localStorage 只读（唯一入口 `legacyLocalStorage()`），`adoptLegacy` 成功才 `removeItem`，解析失败只记账不删 |
| `next/shell/paneForms.mjs` | 只剩「词」：`PANE_FORMS`／文案／`sanitizePaneForms`；与 `PLACEMENTS` 逐项相等由测试钉住（改一边就是两套真相） |
| `next/shell/FloatingWidget.vue` | 宿主容器：收 `instance`／`minimized`／`geometry`，拖动结束发 `geometry`；气泡与侧缘标签的位置都由同一份坐标算；`fullscreenReturn` 与本地 `snap` 补丁删除 |
| `next/shell/AppNext.vue` | 实例解析、打开/收起/展开/再开一份、几何回写、挂载时 `workspaceLoad` → `attachPersistence(workspaceSave)`、老键迁移后整份回写 |
| `next/shell/ipcContract.mjs`／`next/index.mjs` | 通道 `pinax:agent:workspace:load|save`；服务未接时如实报缺，不静默 |

气泡不是第五种形态：`placement` 仍是 overlay，只是 `minimized='bubble'`，`restore` 记展开回哪一轴，所以「展开回原位置」是读状态而不是猜。

## 2. 任务二：多实例与视图注册

| 文件 | 内容 |
| --- | --- |
| `next/shell/viewRegistry.mjs` | `createViewRegistry()`：registerView／resolve／bind／unregister／disposeOwner／list；六个宿主视图 `pinax.view.tree|list|editor|reader|diff|graph` ＋第三方唯一口 `pinax.view.custom`；同名重复注册拒（`DUPLICATE_VIEW`），第三方注册宿主视图名拒（`RESERVED_VIEW_TYPE`）；`LEGACY_VIEW_BINDINGS` 长前缀优先，只作迁移期对照表 |
| `next/shell/CarrierPaneHost.vue` | 七个写死分支改为「`resolvePaneView` → 有则按 kind 渲染 → 没有则占位」；认不出的视图如实说没实现，不假装能编辑 |
| 七份载体清单 | 每个 pane 补 `view:` 声明（novel／notes／script／setting／outline 编辑面→editor，worldbook／reference 阅读面→reader，树面→tree，板面→list） |

视图实例由宿主创建与销毁：factory 是纯函数，每次解析现算，插件拿不到实例引用（对齐 Obsidian Views 的原话）。

## 3. 任务三：清单 v2 与 dispose

- `next/kernel/carrierManifest.mjs`：v2 必须显式 `manifestVersion: 2`；归一化结果同时保留 v1 字段名（`provides`↔`capabilities`、`permissions`↔`scopes`），**写时只出 v2**；两个都写且不一致即拒；`panes` 与 `contributes.panes` 同时写即拒（一份清单只能有一个来源）。
- `contributes` 只认四个键：`panes`／`commands`／`settings`／`renderers`（未知段直接拒）。命令 `{id,title,run}`：id 须匹配 `^[a-z][a-z0-9.-]{0,63}$`、title 1–60 字、run 是函数或 ≤120 字实现名、同插件内 id 重复拒。renderers 只登记 `pinax.view.custom`，声明宿主视图名按其它的码拒。`subscriptions` 只认 `project.changed`，其余报 `UNKNOWN_SUBSCRIPTION`。
- 七块内置载体全部迁 v2（novel／outline／notes／worldbook／setting／script／reference）。
- `next/kernel/pluginRegistry.mjs`：新增 `impl.dispose()`＋`onDispose(pluginId, fn)`＋`onUninstalled(listener)`＋`commands()`／`commandOwner()`；卸载顺序＝先跑清理（impl 与钩子，单个抛错不阻断其余并记账）→ 释放工具/命名空间认领 → 除名 → 广播。重复 install 走既有 `DUPLICATE_PLUGIN` 拒绝。
- `next/kernel/errors.mjs`：补登记 `RESERVED_VIEW_TYPE`／`UNKNOWN_SUBSCRIPTION`——`fail()` 对未登记码会回落到 `PINAX_INVALID_INPUT`，不登记就等于错误码撒谎。

## 4. 任务四：宿主描述符与体检

| 文件 | 内容 |
| --- | --- |
| `next/host-descriptor.json` | `descriptorVersion:1`、`host:'pinax-next-shell'`、`kernelContract:'1'`、`trustMode:'same-process'`、slots（left-dock／center／overlay）、reservedSlots（right／top-menu）、forms 四档、views 七项、uiLayers 三层、`supportsPopout:false`、platforms:['electron'] |
| `next/doctor.mjs` | `loadHostDescriptor`（缺字段逐项报）＋`diagnoseCarrier`／`diagnoseAll` 五态：`ok`／`needs-host-upgrade`（minKernel 或外壳合同不认）／`permission-denied`（保留槽、别人的目录、网络）／`incompatible-form`（形态或视图类型）／`missing-capability`（requires 凑不齐）；每种都带一句可执行修复；CLI 只在被直接执行时读盘 |

判定顺序是「先能不能装（升级）→ 再准不准装（权限）→ 再装得下吗（形态）→ 最后依赖齐不齐」，所以一条清单同时踩多条时先报根因。

`doctor.test.mjs` 新增一条：用真描述符跑七个内置载体，七份全 `ok`——描述符与清单不会各说各话。

## 5. 测试

| 文件 | 内容 |
| --- | --- |
| `next/tests/workspace.test.mjs`（13） | 四轴往返、bubble 不丢 restore、geometry 钳位、坏文件回落并记账、老键迁移后删除、迁移失败保留键、`PANE_FORMS` ↔ `PLACEMENTS` 同源 |
| `next/tests/view-registry.test.mjs`（9） | 注册/解析/重复注册拒绝/第三方占宿主名拒/未知类型回落占位/disposeOwner 后解析失败/前缀绑定长前缀优先 |
| `next/tests/manifest-v2.test.mjs`（12） | v1 可读、v2 归一化保留双名、permissions ↔ scopes 映射、panes 双源拒、commands/settings/renderers 校验、未知订阅拒 |
| `next/tests/doctor.test.mjs`（8） | 五态各一条夹具＋七载体全 ok |
| `next/tests/pane-forms.test.mjs`（3） | 只剩词表合同（旧状态机断言随模块迁去 workspace） |
| `next/tests/shell-ui.spec.mjs` | 新增两条工单点名场景：①大纲拖到 (160,90) → 缩成气泡球（`data-minimized="bubble"`、留在原坐标、状态机 `minimized='bubble'`）→ 点气泡展开回 (160,90)；②同一 pane 再开一份得 `outline.widget#2`，两份坐标与最小化互不串（拖 #2 到 x200，#1 仍在 x40；收起 #2 后只有一张卡、一个标签页）。位置记忆用例从 localStorage 改成「读回 workspace.json 存档」 |

## 6. 门禁（本机实测，2026-10-29 22:53 全链一次跑）

- `node next/testing/acceptance.mjs`：**16/16**。
- `node --test "next/tests/*.test.mjs"`：**387/387**（B 批 346 → ＋41；新增 workspace 13、view-registry 9、manifest-v2 12、doctor ＋1）。
- `vitest run --config next/vitest.next.shell.config.mjs`：**101/101**（shell-ui 64、carrier-pane 34、carrier-pane-real 3；B 批 99 → ＋2 正是两条工单场景）。
- `npm run lint:next`：**0 error / 0 warning**。
- `node next/testing/bundleAssertions.mjs`：**a–l 全过**——主进程 1006.5 kB（＜6 MB）、外壳 1707.0 kB（＜2.5 MB）、渲染层 js 682.5 kB、CSS 133.0 kB、preload 3.3 kB；d 仍是纯内核面 19 把，d2 走真实运行时面 20 把。
- 口径说明：`verify:next` 自己会重建四份产物，所以上面的数字来自同一条链的最后一次构建，不是旧产物读数。

## 7. 边界（没有做到／没有验证的）

1. **没有事件总线**：`subscriptions: ['project.changed']` 现在只是「校验过的声明」，宿主没有发布者，载体也收不到任何事件。工单正文写「A 批收尾时发的事件」，与现状不符——A 批没有做事件流，本批也没有补，不假装有。
2. **命令只进聚合表**：`registry.commands()` 能列出已安装清单声明过的命令，但没有命令面板 UI，也没有跨插件的 command id 冲突拒绝（目前只拒同插件内重复）。
3. **不做真实多窗口**：`supportsPopout:false` 是事实——浮窗仍是应用内 absolute 卡片，不是独立 BrowserWindow。
4. **第三方富视图只登记类型名**：`pinax.view.custom` 解析得到「认这个类型、但没有渲染器」，宿主据此出占位；没有沙箱、不跑第三方代码。
5. **编辑器仍是 textarea**（工单第 7 节明确不在本批范围）。
6. **本批没有启动 Electron**：气泡、多实例、吸附、全屏都是可测行为，但观感（层级、尺寸、遮挡）待作者真机验收。
7. **没有 commit／push**：工作副本不是 git 仓库；本批只用新增与原地修改，没有删除或改名文件。
8. **`workspace.json` 不进历史快照**：R10 仍待裁，与 B 批 `.pinax/sessions/` 同挂；跨进程也没有文件锁——同一项目开两个窗口各自整份重写，后写者赢。
9. **老键迁移只在渲染层首次挂载读一次**：纯浏览器预览（无 localStorage）时迁移为空操作；删键失败会留着，下次再搬（幂等）。

## 8. 踩坑账

1. `visual-contract` 的 FloatingWidget needle 写成 `emit('geometry')`，真实调用是 `emit('geometry', geometry)` → 改为带左括号与逗号的片段。教训：源码 needle 要连参数一起写，只写函数名片段会漏。
2. `shell-ui.spec.mjs` 62 条用例在 `paneForms` 不再导出 `resetPaneForms` 后齐崩 → 换 `resetWorkspace()`。状态从浏览器缓存搬到模块级单例后，隔离责任落在每个用例的 `beforeEach`。
3. 旧断言读 `localStorage['paneForm.*']`／`['overlay.*']` → 改读 store 与 fake bridge 里的 `workspace.entries`；桥必须补 `workspaceLoad`／`workspaceSave`，否则挂载即报「工作区服务未接入」。
4. 两条「网络面只许走这些通道」的白名单漏了工作区两条 → 补上并注明「工作区通道随挂载就会读一次：那是宿主状态，不是项目写入」。
5. `fail()` 对未登记错误码回落 `PINAX_INVALID_INPUT`：新增的 `RESERVED_VIEW_TYPE`／`UNKNOWN_SUBSCRIPTION` 必须先登记，否则 doctor 与清单测试拿到的码与断言不符，还看不出是登记漏了。
6. `doctor.mjs` 的 CLI 直接用 `console` → eslint 4 条 `no-console`；连同未用导入、`AppNext` 里残留的 `getPaneForm` 一共 6 条 warning。门禁是 `--max-warnings 0`，逐条清；CLI 文件需要文件级豁免注释。
7. 同目录 `rename` 遮蔽：B 批在 `sessionStore` 里踩过（本地方法 `rename()` 遮住 `node:fs` 的 `rename`），本批 `workspaceStore` 从一开始就用 `rename as renameFile`，没有再犯。
