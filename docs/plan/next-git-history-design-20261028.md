# R3 裁定落地方案：全面本地化 ＋ git 快照历史（2026-10-28，作者已裁）

> 作者裁定（原话）：「Next 的文件和数据管理是，全面摒弃浏览器缓存，全面应用文档和数据的本地化留存。
> 设计变更历史、快照缓存的部分，此前考虑过的方案是利用 git diff 机制定时存，可以支持文档历史的回溯和查看。」
> 本文把该裁定落成可实现的设计与工单（D0–D2）。**R3 至此关闭**：不再有"迁到哪个面"的选择，只有落地。

## 0. 裁定要点（三条，不再讨论）

| 编号 | 裁定 | 落地含义 |
|---|---|---|
| R3-1 | **全面摒弃浏览器缓存** | Next 不再用 localStorage/IndexedDB 承载任何业务状态；老浏览器存储降级为**一次性导入的只读迁移源**（导入后不删、不写） |
| R3-2 | **全面本地化留存** | 项目数据只落磁盘（已裁中文标准目录）；应用级只留一个偏好 JSON（`next-preferences.json`） |
| R3-3 | **历史＝git 快照，定时存** | 变更历史/快照缓存用 git 机制：定时提交，支持回溯与查看 |

由此产生的必须先改的两处现状（都在 Next 里，成本很小）：
- `next/shell/theme.mjs` 目前用 localStorage（`app_theme`，与老前端共享）→ **改存偏好 JSON**（老前端退役后共享契约自然失效；过渡期可双写，见 D2）。
- 现状 `expectedRevision` 是**并发号不是历史**，历史能力完全由本方案提供——两者并存、职责不重叠（并发号防覆盖，git 存历史）。

## 1. 存储布局（不进用户已有 git 仓库）

```
<项目根>/
  正文/ 大纲/ 世界书/ 构思/ 约束/ 资料/ …        ← 工作树（作者可见）
  assets/                                        ← 媒体二进制（默认不进历史，见 §4）
  .pinax/
    project.json  proposals/  state/
    history.git/        ← 独立的 git 目录（--git-dir），不是 <项目根>/.git
```

关键点：**用 `--git-dir=<项目根>/.pinax/history.git --work-tree=<项目根>` 方式建仓**，绝不在项目根放 `.git`。
理由：作者的真稿目录常常本身就在某个 git 仓库里（或将被纳入），根上放 `.git` 会与用户的版本管理互相踩。独立 git-dir 还让"清历史"=删一个目录。

`.pinax/history.git/info/exclude`（建仓时写入，等价于不污染工作树的 .gitignore）：
```
/.pinax/
/assets/
```

## 2. 机制

**写入不触发提交**（保持 fileService 纯、快）——`fileService.write` 成功后**只标脏**（`state/history-dirty.json`，记时间戳与文件清单）。

**定时提交**（"定时存"的字面实现）：
- 默认 **5 分钟**一次（偏好可改）；有脏才提交，无脏跳过（空转成本＝读一个 json）。
- 另有三个触发点：项目关闭前、`history.restore` 前（先存现场）、手动「存一个快照」（目录内的动作项）。
- 提交信息格式：`snapshot 2026-10-28 15:04 · 3 文件` + body 列出改动文件名（便于 `git log` 直接读）。
- 提交身份固定为仓库本地配置 `pinax <pinax@local>`（不许继承/污染用户全局 git 配置）。

**回溯与查看**：
- 列某文件的历史：`git log --follow --format=… -- <path>`；
- 看某版内容：`git show <rev>:<path>`；看差异：`git diff <revA> <revB> -- <path>`；
- 恢复：把 `git show` 的内容经 **fileService.write（带当前 expectedRevision）**写回——**恢复＝新增一次版本，不改写历史**（与提案链同口径：只前进）。

## 3. 关键取舍：系统 git vs 内置 git 库

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| **A. 调系统 `git`**（spawn，`--git-dir/--work-tree`） | 零包体；diff/log 能力完整 | 要求机器装了 git；无 git 时历史功能不可用 | **现在选 A**：缺失时**如实降级**（历史面板显示"未检测到 git，历史未启用"，不假装有）；作者本机有 git（我们一直在用） |
| B. 内置 isomorphic-git（纯 JS） | 不依赖外部程序，装机即用 | **约 +1MB 进主 bundle**；当前打包门禁「主 bundle < 1.6 MB」而现状已 860.9 kB → **会直接撑爆门禁**；大仓库性能弱 | 出安装包时再评估（需同时抬高门禁或代码分割） |
| C. 自造快照目录（每版拷贝到 `.pinax/state/history/`） | 不依赖 git | 没有 diff/blame/压缩，作者明确要 git diff → 不符裁定 | 否决 |

**A 的降级语义（必须写进 UI）**：`git` 不可用 → 历史面板顶部一条如实说明 + 「重试检测」；**绝不静默假装历史可用**（与模型面三态同一纪律）。

## 4. 体积与噪声控制

- **默认只版本化文本目录**（正文/大纲/世界书/构思/约束/资料、`.pinax/project.json`）；`assets/`（图片二进制）与 `.pinax/` 进 exclude——图片靠"原样拷贝＋不覆盖"策略管，不进历史（否则仓库几周就上 G）。
- 偏好可开「连资产一起存」，默认关；开启时提示体积风险。
- 提交频率与内容都可在偏好里看到（本批只暴露间隔，其余记账）。

## 5. 与既有机制的关系（不重叠、不冲突）

| 既有 | 职责 | 与 git 历史的关系 |
|---|---|---|
| `expectedRevision`（fileService） | 防并发覆盖（"你基于第 3 版改，但现在已是第 4 版"） | 独立；写路径不变 |
| `.pinax/proposals/`（AI 提案） | 模型改稿先落提案，作者确认才动正文 | 独立；提案本身也随快照进历史（它在 `.pinax/` 被 exclude——**例外**：`proposals/` 单列进 include 以留痕，见 D0 备注） |
| `.pinax/state/` | 运行态 | 不进历史 |

## 6. UI 落点（遵守 U13：不许目录外弹窗）

**历史浏览是二级页面，必须登记进统一弹窗目录**：把 `SettingsModal` 升格为**统一二级页**（目录表加一组）：
- 组「设置」：偏好与模型 / 载体管理 / 新建项目 / 主载体选择（现有四节）
- 组「文档」：**文档历史**（新）——左栏＝该文件的提交列表（时间＋摘要），右栏＝所选版本的 diff（红绿）＋「恢复到这一版」按钮

入口：索引窗行的上下文动作「历史…」（章节/条目/构思/大纲通用）＋菜单「文件 → 当前文档历史…」。
`visual-contract` 的「目录外弹窗不允许存在」断言不变——历史页与设置页共用同一个 `SettingsModal` 底座，天然在目录内。

## 7. 工单拆分（给执行方）

**D0 历史引擎（无 UI，可独立验收）**
- 新 `next/history/gitHistory.mjs`：`probe()`（检测 git 可用与版本）、`ensureRepo(root)`（建独立 git-dir＋写 exclude＋本地身份）、`markDirty(root, paths)`、`commitIfDirty(root, { message })`、`listFileHistory(root, path)`、`showVersion(root, rev, path)`、`diffVersions(root, a, b, path)`。全部**只经 spawn 调 git**，超时/失败返回 typed error（`HISTORY_UNAVAILABLE` / `HISTORY_GIT_MISSING`）。
- 单测：临时目录建仓→写文件→标脏→提交→改→再提交→`listFileHistory` 两版、`showVersion` 内容正确、`diffVersions` 含增删行；`git` 缺失时 `probe()` 报 `HISTORY_GIT_MISSING`（用假 PATH 模拟）。
- 允许文件：`next/history/*`（新）、`next/tests/history-*.test.mjs`（新）。

**D1 定时与接线**
- `next/runtime/historyScheduler.mjs`：5 分钟定时器＋关窗兜底 `before-quit`＋手动触发；只由主进程启动（`main.mjs` 一行接线）；间隔进偏好（`next-preferences.json` 加 `historyIntervalMinutes`，默认 5，0＝关闭）。
- `fileService.write` 成功后调用 `markDirty`（**单点接入**，不许载体各自标）；`project.open` 后 `ensureRepo`。
- IPC：`history.list` / `history.show` / `history.diff` / `history.commit-now` / `history.probe`（五条，`pinax:agent:` 命名空间，应用级不需项目）。
- 门禁：`shell-contract` 钉住五通道与 prefs 新字段；打包门禁加一条「产物内不出现 isomorphic-git」的守卫（防止将来误引撑爆体积）。

**D2 UI＋浏览器存储退役**
- 统一二级页加「文档历史」节（§6 形态）＋索引窗上下文动作与菜单入口。
- `theme.mjs` 从 localStorage 迁到偏好 JSON（过渡期双写 `app_theme` 一版，老前端退役后删）。
- 视觉合同断言：`next/shell` 源码内**不得出现 `localStorage`**（D2 后生效，含 theme.mjs）——这是"全面摒弃浏览器缓存"的机器版。
- 老 IndexedDB `revisions` 快照：**不导入**（作者裁定用 git 取代）；如需保留旧版正文，另立「旧修订史一次性导出为初始 git 提交序列」的可选工单（不在 D 系列）。

## 8. 验收口径

1. 写三次→等一个周期→`git log` 出对应快照；关窗立即补一提交。
2. 打开历史→两版之间 diff 正确→恢复到旧版→正文回到旧版且**多一个新版本**（历史未被改写）。
3. 无 git 的机器（PATH 抹掉）→历史入口如实显示不可用，其它功能零影响。
4. `verify:next` 全绿；`assets/` 不进历史（体积核对）。

## 9. 诚实边界

- D0–D2 合计约 2–3 批；本文只定设计，未写代码。
- 系统 git 方案在**打包安装版**上的可用性未验证（假设机器有 git）；若出包需要自包含，切 B 方案时要同时处理 1.6 MB 门禁与体积记账。
- 「定时存」的间隔、是否连资产一起存、旧修订史是否导出，三项默认值已给（5 分钟/否/不导出），作者可改。
- Windows 下 git 路径/换行（`core.autocrlf`）需要在 D0 显式设定（仓库本地 `core.autocrlf=false`），否则同一文件会因换行反复"变更"。
