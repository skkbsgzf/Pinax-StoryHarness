# M2.5-C 执行工单：载体协议 v2 与工作区模型（2026-10-29）

> 执行方：Qoder
> 调度方：作者（逐批点头）
> 作者指令：「大纲可以悬浮在小说上、可以展开、可以缩成气泡球；这些形态差异要用 Obsidian / DSH 的协议来指导」（诊断文档第 3 章、结论 5/6/8/9）。

## 0. 现状锚点

- `next/kernel/carrierManifest.mjs:24-25`：`OPEN_SLOTS = ['left-dock','center','overlay']`，`RESERVED_SLOTS = ['right','top-menu']`。
- `next/kernel/carrierManifest.mjs:142-190`：pane 是静态 `{ slot, id, title, icon, width? }`，一块载体最多一个 overlay。
- `next/shell/paneForms.mjs:21,74-80`：形态是四值枚举 `dock / split / overlay / fullscreen`，状态写 `localStorage['paneForm.<paneId>']`。
- `next/shell/FloatingWidget.vue:42-46,48-82`：`snap` 一个布尔记吸附，位置写 `localStorage['overlay.<paneId>']`。
- `next/shell/AppNext.vue:668-706,758-772`：全屏/分屏互斥，`fullscreenReturn` 记「从哪来」；这是用补丁表达「多轴状态」。
- `next/shell/CarrierPaneHost.vue:40-51`：按 pane id 前缀把七种界面写死在外壳，认不出的前缀显示「还没实现」。
- `next/kernel/pluginRegistry.mjs:35-70`：`install/uninstall` 只释放工具与命名空间认领，impl 没有 `dispose`。
- 协议底稿：`docs/plan/next-plugin-ui-protocol-20261028.md`（P13 渲染器注册只把 richtext/html 记账、P15 命令未实现、P18–P21 形态与宿主状态）。

## 1. 任务一：形态四轴（`next/shell/workspace.mjs`）

把单枚举拆成四轴，气泡不再是第五种形态：

```json
{ "instance": "outline.tree#1", "pane": "outline.tree",
  "placement": "overlay", "minimized": "bubble",
  "geometry": { "x": 1180, "y": 96, "w": 320, "h": 520, "snap": "right" },
  "restore": "overlay", "z": 3 }
```

- `placement ∈ dock|split|overlay|fullscreen`（兼容旧值）；`minimized ∈ none|bubble|collapsed`；`restore` 记展开回哪一轴；`geometry` 记像素与吸附边。
- 状态文件 `.pinax/workspace.json`（项目级），`version:1`；渲染层只读写经主进程通道，**不再写 localStorage**。
- 老键迁移：`paneForm.<paneId>` / `overlay.<paneId>` 首次读取时搬进 `workspace.json`，成功后删键；搬不动就保留并提示。
- `FloatingWidget` / `AppNext` 的 `fullscreenReturn`、`snap` 两个补丁删掉，改成读四轴。

## 2. 任务二：多实例与视图注册

- pane 实例 id：`<paneId>#<n>`；同一 pane 可开多份（大纲浮在正文上的同时，中栏也能有一份树）。
- `createViewRegistry()`：`registerView(type, factory)` / `resolve(type)`；首批六个宿主视图 `pinax.view.tree|list|editor|reader|diff|graph`，pane 用 `view: 'pinax.view.tree'` 声明，不再靠 id 前缀猜。
- `CarrierPaneHost` 的七个写死分支改为「查注册表 → 有则渲染 → 没有则占位」，第三方载体可以带自己的 `view` 描述（富视图逃生口，v2 只开 `pinax.view.custom` 一个类型名）。
- 视图实例由宿主创建与销毁，插件不得持有引用（Obsidian 的原话，`obs/Plugins__User interface__Views.md:45-99`）。

## 3. 任务三：清单 v2（`pinax-carrier@2`）

五类声明，v1 字段全部保留可读：

```json
{ "manifestVersion": 2,
  "provides":   ["outline.tree"],
  "requires":   [{ "capability": "text.chapters", "min": 1, "fix": "装小说载体" }],
  "permissions":[{ "type": "file", "dir": "大纲", "mode": "rw" }],
  "contributes":{ "panes": [], "commands": [], "settings": [], "renderers": [] },
  "subscriptions": ["project.changed"] }
```

- `permissions` 是 `scopes` 的新名字（旧字段读时映射，写时只写 v2）；依赖闭包与目录唯一主人的判定不变。
- `contributes.commands`：`{ id, title, run }`，宿主注册进命令表（P15 落地）；`contributes.settings`：声明式控件 `{ id, title, type, default, options }`，宿主渲染与持久化。
- `subscriptions`：今天只认 `project.changed`（A 批收尾时发的事件）；未订阅的载体收不到。
- `pluginRegistry.install/uninstall` 增加 `dispose()`：注册的视图、命令、订阅、定时器一并释放；重复 install 必须幂等拒绝（已有 DUPLICATE_PLUGIN）。

## 4. 任务四：宿主描述符与体检

- `next/host-descriptor.json`：`{ descriptorVersion, host, kernelContract, trustMode, slots, forms, views, uiLayers, supportsPopout, platforms }`。
- `next/doctor.mjs`：读任意载体清单 + 描述符，产出五态：`ok / needs-host-upgrade / missing-capability / permission-denied / incompatible-form`；每种都带一句可执行修复。
- 描述符里的 `supportsPopout: false` 是今天的事实（`FloatingWidget` 是应用内 absolute 卡片），写清楚，不假装支持。

## 5. 测试

- `next/tests/workspace.test.mjs`：四轴往返、bubble 不丢 restore、`workspace.json` 坏文件回落默认并记账、老键迁移后删除。
- `next/tests/view-registry.test.mjs`：注册/解析/重复注册拒绝；未知类型回落占位；插件 dispose 后视图解析失败。
- `next/tests/manifest-v2.test.mjs`：v1 清单可读、v2 写入、`permissions` ↔ `scopes` 映射、命令与设置声明校验。
- `next/tests/doctor.test.mjs`：五态各一条夹具。
- `shell-ui.spec.mjs` 扩：大纲收成气泡 → 展开回原位置；同一 pane 开两份不串状态。

## 6. 门禁

`npm run test:next` → `npm run test:next:ui` → `npm run lint:next` → `npm run verify:next`。

## 7. 边界

- 不改 `server/**`、`src/**`；不新增依赖；七个内置载体全部迁 v2，但 v1 读取保留一个版本周期。
- 不做真实多窗口（popout 记为不支持）；不做富视图的第三方运行时沙箱（v2 只登记类型名）。
- 不在本批改编辑器内核：正文/剧本的编辑面仍是 textarea 源文。
