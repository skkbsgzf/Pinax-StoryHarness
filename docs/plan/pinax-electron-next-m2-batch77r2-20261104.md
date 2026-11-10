# 批次77-R2 执行记录（2026-11-05）

> 工单：[批次77-R2 工单](./pinax-electron-next-m2-batch77r2-ticket-20261104.md)｜规格：[批次77 工单](./pinax-electron-next-m2-batch77-ticket-20261103.md) 任务6 全文
> 执行方：Qoder CLI（工单指定的实现工程师）。**未 commit、未执行 git 命令、未启动／未杀 Electron 进程。**

## §7 执行方回填

### §7-0 结论

`npm run verify:next` 官方命令**原样跑到 exit 0**（五段全绿：acceptance 44/44 · node --test **815/815** · vitest **235/235**（15 文件） · eslint 0 问题（`--max-warnings 0`） · 打包门禁全过）。四条任务全部落地，本批主验收**守卫⑩分支非破坏**有用例且为绿（分叉那次写入只往文件尾补行，既有行逐字节不变＋首行内容双断言）。做不到的条目集中在 §7-6，界面实拍按工单口径交调度方（我不启动 Electron，见限制）。

一句话口径：**分支不是「新山河图」，是把同一段历史允许长出并列的第二串**——原始支仍然是「不带标签的那一串」（这是既有行能逐字节不变的前提），分出去的支是追加在文件尾的拷贝，拷贝的头一条明写它挂在哪个分叉点、排第几号；看哪一支由会话级指针决定，指针只挪、内容不动。

### §7-1 任务1：消息级分叉字段（`branch:{parentId,index,count}`）

判定与净化只做在一份模块里（`next/shell/agentSessions.mjs`），磁盘层复用同一份，不另造 schema：

| 落点 | 现值 |
| --- | --- |
| 字段净化 | `sanitizeMessageBranch`（`:444`）——只认三个确定字段：`parentId` 净化成 ≤80 字符串（**空串＝根层**，分叉点就是「整串消息之前」）、`index` 必须 `Number.isSafeInteger && ≥1`、`count ≥ index`。不是对象／数组／缺字段一律 `null`（按原始支走），**不猜近义、不补默认** |
| 白名单 | `sanitizeSessionMessage` 的返回形状里 `branch` 紧跟 `id`（`agentSessions.mjs:546`；没带就是 `null`，不是 `undefined`——落盘形状要稳定）；`copyMessage` 深拷 `branch`，界面拿到的不是内部对象 |
| 当前支指针 | `normalizeBranchChoice`（`:460`）——只认对象、键 ≤80 字符（含空串那一个）、值为正整数序号；坏值不进存储也不参与判读。落点在**会话元数据行**（`branchChoice`），见 §7-5 补登记 |
| 可见路径 | `visibleMessagePath(session)`（`:505`）：从根层起，每一层按 `branchChoice` 挑那一层的第 `index` 支，产出 `{message, index, parentKey, rank, count}` 序列。`messageParentKey`（`:475`）／`siblingsAt`（`:487`）是它的两个纯函数底座 |
| 派生格 | `branchNav:{index,count}` 由 `visibleOf` 现算挂给界面，**从不落盘**（读回来的消息里没有这一格，测试钉着）；`count` 一律按 `siblingsAt` 现算，不信任消息里存的那个 `count`（上限挤出早期兄弟时那个数只可能偏大，见下） |

`next/sessionStore.mjs` 的 `parent` 预留位（:79/:95，会话的父会话）**本批一字未动**，工单第 1 条就是这么定的。

形状钉（批次76 workspace.test.mjs:106 纪律）两处都按「断言漂移」写明了理由并同步更新：`next/tests/agent-sessions.test.mjs:216`（键名清单 13→14，多出的就是 `branch`）、`:316`（整份对象钉里补 `branch: null`，并加一条「没分过叉的会话读回来就是原始支，不编一个链接格」）。

### §7-2 任务2：追加式落盘（本批主验收＝守卫⑩）

`rewriteSession`（`next/sessionStore.mjs:460`）原来是「快照整份原子重写：tmp＋rename」。现在改成**先问一句「这次是不是只往尾上长」**：

1. 读现有文件 → 折叠（fold）成内存形状；**追加路径要求 `folded.badLines === 0`**——文件里有坏行就不猜位置，直接走原子重写（把脏档收干净优先于省几行写）。
2. `isGrow(disk, next)`（`:445`）：按净化后的内容逐条 `JSON.stringify` 严格对前缀，且只允许变长（`ts` 不进比较——同一条消息被重打时间戳不算内容变化，否则守卫⑩的「逐字节」会被自家时钟打掉）。
3. 是增长 → 只 `io.appendFile` 尾部新增那几条（元数据行只在 `sameMetaLine`（`:450`）判出真变化时补一行，`ts` 剥离后比较）；无新行则直接返回，**一次写都不发**。
4. 不是增长（截断、改写、删除）→ 落回原来的 tmp＋rename 整份重写，先做既有那句 `current === text` 空写保护。
5. `pick(key, limit, cleanOne, diskKey)`（`:477`）：**快照没交某个数组＝保留盘上那份，不是清空**。这条不是顺手写的——渲染层的 `snapshot()` 从来不带 `proposals`，若按缺省语义当空数组，分叉那次追加会顺手抹掉主进程记的提案。用例：`next/tests/session-store.test.mjs:454`。

守卫⑩与追加式三条验收（`next/tests/session-store.test.mjs`，函数级 store 直调＋真临时目录）：

- **守卫⑩分支非破坏** → `:351`：分叉那次保存后 `after.length === before.length + 2`（只多两条拷贝行）、`after.slice(0, before.length)` 与 `before` **逐行 deepEqual**、`after[0] === before[0]`（首行那条元数据仍是被拷来的那一条，一个字节没变）。行数＋首行内容双断言齐。
- **切支只多一行元数据** → `:385`：`branchChoice` 落盘后读回 `{ 'm-a1': 2 }`（重开外壳还在这一支上）、消息行数与内容一字未动；同一份再存一次**行数不变**（没变化就不写）。
- **截断不是增长** → `:420`：`dropFrom` 之后的保存落回整份重写，盘上只留内存里那一份（5 行→再问到 6 行时又走追加，两条路径在同一次测试里都过）。
- **两叉都在盘上且互不覆盖** → `:351`／`:375`：`read.value.messages` 里不带标签的仍是原始支那 4 条，拷贝支的 `branch` 逐字段读回（`:379`）。
- **墓碑后子会话 re-parent 不回归**：沿用既有断言（`next/tests/session-store.test.mjs:160` 那条「删父不删子、子 re-parent 回根」＋IPC 三条通道那条），本批未改墓碑口径（`tombstone` 未动），零回归。

### §7-3 任务3：UI「‹ 2/3 ›」切换器＋分叉动作件

动作件长在**问句那一行**（分叉点是问句，不是回答：同一问才有「另一支」可言）：

- 分一支：`AssistantDialog.vue:725-733`，`data-test="question-branch"`，`aria-label="分一支"`，`title="分一支（把这条之后的历史存成另一支，再改这一问）"`，图标用现成的 `network`（节点树那张），busy／未接桥时禁用。
- 切换器：`:749-775`（`data-test="branch-nav"` / `branch-prev` / `branch-count` / `branch-next`），**只在 `branchNav.count > 1` 时存在**——没分过叉的会话不许凭空长出一枚 `1/1`。文案就是工单那一句式：计数格 `{{index}}/{{count}}`，整条 `title` 说「这一层共 N 支，正在看第 i 支」。
- 位置与可见性：摆在问句气泡**右侧**（工单原话「消息行右侧」），且**不**跟随动作区那一层 `opacity`——「我正在看第几支」是常驻事实，hover 才显形等于没告诉人；只有真分了叉的那几行才多出这一格。
- 命中区（批次76 度量闸口径）：`.authoring-knowledge__branch-step { width/min-width/height/min-height: 24px }`，计数格 `min-width/min-height: 24px`；判据进既有那条度量测试，**新增两条在册规则**（`next/tests/visual-contract.test.mjs:900-902`），反向「声明的 px 尺寸不许 <24」的扫描同时覆盖它们。该条测试标题里的「六处」已改成「各处」（清单早已不止六处，数字留在标题里会误导）。
- 组件不许自己判读：`branchCount`／`branchIndex`（`:527`／`:531`）只读 `message.branchNav`；`branchQuestion`／`cycleBranch`（`:536`／`:541`）只 `emit`。**切支不改写任何一支的内容**这句规格，落到实现就是这一层没有任何 messages 突变代码，动指针的活儿在 store。

宿主侧接线（`RuntimeDock.vue`）：`@branch="branchQuestion"`／`@switch-branch="switchBranch"`（`:529-530`），`switchBranch`（`:457`）只调 `store.cycleBranch`。`cycleBranch`（`agentSessions.mjs:939`）要求那条消息在**当前可见路径**上且该层 `count ≥ 2`，否则返回 `null` 一个字节不动——单孩子的层不演「切了」（用例 `agent-sessions.test.mjs:591` 指针落空那条，以及 DOM 层的负断言 `shell-ui.spec.mjs:671`）。

### §7-4 任务4：与编辑重发的关系（写清＋落测试）

工单那两句话在代码里是这样的，两个动作**共用一次历史重写入口**：

- **编辑重发＝截断当前支**：`RuntimeDock.editQuestion`（`:422`，未改）→ 三要素乐观失效校验 → `store.dropFrom(id, sessionId)` → 回填输入框。
- **分支＝在截断前先存一支**：`RuntimeDock.branchQuestion`（`:443`）→ **同一套三要素校验**（原文／时间戳／角色，对不上一个字节都不动）→ `store.branchFrom(id)`（把**当前可见支从这条往后的整段**拷成新序号支；一条既有消息都不动、不重打，所以落盘能走追加式）→ **再走同一个 `store.dropFrom(id)`** 截当前支 → 回填输入框。截断入口全项目只有 `dropFrom` 一处，没有第二套。
- 分完**不自动切支**：作者改的是这一问，屏上该看见重新长出来的那一支，退路留在 `‹ i/n ›` 里随时回得去（`branchFrom` 拨都不拨指针，用例 `agent-sessions.test.mjs:494` 那句「分叉不切支：屏上仍是作者正在看的那一条串」，以及盘上 `branchChoice` 仍是 `{}`：`shell-ui.spec.mjs:704`）。
- 序号**从不留洞**：`append`（`:839`）算 `rank` 时先回 1 号位（截断后接着问＝原始支重新长出来，不是新开支），1 号有人才往后排一位并把指针拨过去。所以 `count === rank` 恒成立，除非早期兄弟被 `MAX_SESSION_MESSAGES` 挤出——那种情况 `count` 取 `Math.max(rank, options.size + 1)`，而界面读到的 `count` 永远是 `siblingsAt` 现算的那一份。
- 可见支之外的写口也一起换了靶子：`updateLast`／`dropLast`／`dropFrom` 现在都以 `visibleMessagePath` 为准（`dropFrom` 只摘可见那一段的数组下标、降序 splice，并 `pruneBranchChoice` 清掉指向已消失消息的指针）。这就是工单那句「截断与追写只碰看得见的那一段，别的一支不陪葬」（用例 `agent-sessions.test.mjs:546`）。
- 与「重新生成」的分工也照本批更新了两处过期文案：`AssistantDialog.vue` 回答行注释与中间那条的禁用 `title`（原本写着「分支还没做」），现在说清**想保历史走分一支，再生成是就地替换**，那条口子本批仍只对最后一条回答开。

DOM 层用例（`next/tests/shell-ui.spec.mjs`，+3）：`:591` 分一支把尾段存成另一支并回填原文、`‹ ›` 只挪当前支指针、两支内容逐字段对拍（除 `id`／`branch`／`branchNav` 三格外全等）；`:671` 过期点击与错角色点击不动任何一支、不回填、无叉可切时不演「切了」；`:704` 分叉后两支同时在落盘快照里（消息数组 `['原问','那一答','改后的问','那一答']`，两支头部分别带 `index:2` 与 `index:1`），切支后 `branchChoice` 变而 `JSON.stringify(messages)` 逐字节相同。

### §7-5 越界补登记（照批次77 工单 §补登记 格式）

- `next/sessionStore.mjs` 的**会话元数据行新增一格 `branchChoice`**——工单第 1 条只把 `branch` 落在消息行上。理由：「此刻看哪一支」是**会话级真值**，不是某条消息的属性，必须随会话落盘，否则刷新后作者被送回默认支、那条退路就找不着了。落点是 `normalizeMeta`（`:86-88`，带一句「工单只把 branch 落在消息行上，这一格是它的落点补充」）与 `sessionLine`（`:105`）；净化函数复用 `agentSessions.normalizeBranchChoice` 一份，不长第二套判读。**没动** `parent` 预留位。
- `next/shell/AssistantDialog.vue` 的分支钮图标取现成的 `network`（节点树那张）。图标键表在 `src/components/workbench/WorkbenchIcon.vue`（**老 web 轨、本批禁改**，那里没有 `git-branch` 这个键），所以不新造图标、不加键，只从在册的那几张里挑语义最近的。
- `next/tests/visual-contract.test.mjs` 在允许文件列表内（`next/tests/**`），但登记一句：本批**没有放宽任何既有度量判据**，只是往那条在册清单里追加两行（`branch-step`／`branch-count`），并把标题里那个已经对不上数的「六处」改掉。
- 未新增 IPC 通道：`branchChoice` 与带 `branch` 的消息都走既有 `pinax:agent:sessions:save`／`load` 那条载荷（`ipcContract.mjs:542` 是原样转发，字段白名单在 store 那两份净化函数里），preload 白名单 `new Set(Object.values(IPC_CHANNELS))` 因此不需要改第二份表。

### §7-6 未做／未验证（limitations）

1. **没有真机实拍**：工单边界写明「不启动／不杀 Electron 进程」。以上断言全来自 jsdom＋真 DOM 结构＋node:test 直测纯函数与真临时目录落盘，**不是像素级确认**。特别是「切换器命中区 ≥24×24」——度量闸量的是 CSS 声明，jsdom 没有排版，量不出真实 `getBoundingClientRect`；批次76 那句「真机逐屏复测仍记在『未真机复核』的账上」这条口径原样沿用，不由测试冒充。
2. **窄屏不动**（禁止边界）：`‹ i/n ›` 与分一支钮在窄栏里的换行／挤压没有设计，真窗口复验时若挤，属下一批。
3. **分支深度与「多层分叉」没有做上限**：树可以每层再分（每层各自一条指针），但没有「整棵树的鸟瞰视图」——工单只要 `‹ i/n ›` 这一层的切换器，跨层导航（跳到祖先分支／列全树）本批不做，也不自设阈值当闸。
4. **`branchFrom` 的拷贝是整段尾段复制**：一条问句之后挂了很长的回答与多条轨迹时，分叉会在盘上多出一段等长的行。上限由既有 `MAX_SESSION_MESSAGES = 200` 兜（挤出早期兄弟时一并 `pruneBranchChoice`），**没另设尺寸闸**。
5. **追加路径要求 `badLines === 0`**：档里已有坏行时保存会走整份重写（并因此可能改动既有行的字节）。这是「先把脏档收干净」优先于「守住追加式」的取舍，如实登记；守卫⑩的用例是在干净档上跑的，这也是分叉唯一被支持的前置状态。
6. **指针落空不擅自换支**：作者停在第 2 支上又把那一支截了，可见路径就到头为止（不会滑去别的支冒充「这一支」）。屏上此时只剩截断后重问那一段，符合直觉但**没有 toast 说明**「你刚看的那支没了」——补这句提示要动消息流文案，本批不做。
7. **任务6 之外的面一字未动**（禁止边界）：任务1／2／4／3／5 的既有用例零回归；写族闸、`writePolicy` 三档、协议形态词表与 PANE/PAGE 状态轴、`server/` 与 `src/` 均未触碰；`subagent`／`workflow-step` 的产生逻辑仍归批次78。
8. **未 commit**（作者纪律＋工单明令）。
9. **AGENTS.md 硬规则表要求的 `ui-style-check` skill 在本机可用 skill 列表里不存在**；界面改动按既有口径自行核对（颜色走老前端 token、字号走 `--nx-fs-*` 刻度、圆角走 `--nx-radius-xs`、聚焦环与禁用态与同族 `row-btn` 一致），并由 `next/tests/visual-contract.test.mjs` 的机器判据把关（该门禁本轮新增两条在册规则，未放宽任何既有条）。
10. **本机内存见底时官方命令会间歇 OOM**：本轮第一次整跑 `npm run verify:next` 在 node --test 段撞 `JavaScript heap out of memory`（16 核并发 worker × 宿主机 free≈2.1 GB，多个测试子进程同刻崩，与被测代码无关）。取数办法是把五段拆开跑并限并发（`node --test --test-concurrency=4`、`vitest --minWorkers=1 --maxWorkers=3`），读数与上表一致；随后**官方命令整跑复验一次到 exit 0**（44/44 · 815/815 · 235/235 · eslint 0 · 打包全过）。两种跑法读数相同，登记为环境态（批次77 §7-4 已记过同类间歇）。

### §7-7 门禁读数（只增不减，逐段现跑）

| 段 | 基线（批次77-R1b §7-4） | 现值 | 判定 |
| --- | --- | --- | --- |
| `node next/testing/acceptance.mjs` | 44/44 | **44/44** | 持平 |
| `node --test "next/tests/*.test.mjs"` | 805/805 | **815/815（0 失败）** | ＋10：`agent-sessions.test.mjs` ＋6（`:473` 字段校验、`:487` 指针表校验、`:494` 分叉／切支／指针持久、`:546` 只碰可见段、`:577` 未分叉会话形状不变、`:591` 指针落空不换支）；`session-store.test.mjs` ＋4（`:351` 守卫⑩、`:385` 切支只多一行元数据、`:420` 截断落回原子重写、`:454` 快照未交数组＝保留）。**无删项、既有断言零放宽**（两处形状钉按漂移纪律同步补 `branch` 并写明理由） |
| vitest（`next/vitest.next.shell.config.mjs`） | 232/232（15 文件） | **235/235（15 文件）** | ＋3：`shell-ui.spec.mjs` 的 `:591`／`:671`／`:704`（分叉与切支的 DOM 行为、乐观失效保护、落盘载荷两支同存）。既有用例一条未删 |
| `npm run lint:next` | 0 问题 | **0 问题**（`--max-warnings 0`） | 持平 |
| 打包门禁（bundleAssertions） | 全过 | **全过** | 持平 |
| 主进程 bundle | 1684.8 kB | **1688.6 kB** | ＋3.8 kB（记账，既有 <6 MB 线未动） |
| 外壳 bundle | 2015.5 kB | **2019.1 kB** | ＋3.6 kB（记账，既有 <2.5 MB 线未动；产物 mtime 晚于本批源码改动，故已含本批） |
| renderer js | 1257.7 kB | **1268.4 kB** | ＋10.7 kB（记账；含并发批次落进既有文件那部分，体积线沿用既有口径，**未新增数值线**） |

### §7-8 记账指标（不进闸，工单原三条）

- **分支深度分布**：当前实现是「每个分叉点一层序号」，深度不限、无上限闸；本次新增的 13 条用例里最深的是**同层 2 支 ×段长 2**（一次分叉拷 2 条），没有出现第 3 支。真实作者树上的分布要等真窗口用过之后才有数，本批不编。
- **追加式写入的行数前后对比**：守卫⑩用例的实测——4 条消息的会话分叉一次＝**＋2 行**（两条拷贝），既有 5 行（1 元数据＋4 消息）逐字节不变；再切一次支＝**＋1 行**（元数据覆盖行），消息行零改动；同一状态重复保存＝**＋0 行**（`current === text` 与 `sameMetaLine` 两道空写保护）。
- **切换器命中区实测**：jsdom 量不到排版，本批只有**度量级**读数——`.authoring-knowledge__branch-step` 声明 24×24（`width`/`min-width`/`height`/`min-height` 四格齐），计数格 `min-width/min-height: 24px`；真机 `getBoundingClientRect` 仍待复测（§7-6 第 1 条）。

---

## §8 调度方验收（Zcode · 2026-11-05）

**判定：通过。** 代码评审（2 条 low 已核）＋门禁独立复跑五段全绿（读数与 §7-7 一致）＋**真窗口实拍补掉 §7-6 第 1 条的账**。

### §8-1 真窗口实拍（Playwright _electron，验收场 dameng-px，会话 s-mvtuiho1-1）

截图存 `D:/Pinax-e2e/next-batch77r2-shots/png/`：

1. `125-history-loaded.png` — 重启后历史消息行正常回放（`[data-message-id]` 命中 user 行）。
2. `126-after-branch.png` — hover 问句行 →「分一支」钮（`data-test="question-branch"`）显形并点击；点击后输入框回填原问句待改写，线程让位给新问法——「旧的那条变成退路」的交互口径成立。
3. `127-second-branch.png` — 第二叉发出后，气泡右侧出现常驻切换器 **‹1/2›**（`data-test="branch-nav"`，含 `branch-count` 文本 `1/2`）。
4. `128-switch-branch.png` — 点 `branch-next` 后计数变 **2/2**，问句气泡内容切回第一叉原文「测试分支用消息」——切换只换指针，气泡随支切换，符合工单「不改写任何一支的内容」。

### §8-2 盘上证据（守卫⑩真文件复核）

`.pinax/sessions/s-mvtuiho1-1.jsonl`：分叉前 5 行 → 验收后 8 行，**追加式**——前 5 行（会话元数据＋首轮两消息）逐字节未动，新增 3 行全为 append：

- `m-mw2co4gk-1`（第一叉问句）：`branch:{"parentId":"","index":2,"count":2}`
- `m-mw2co5p9-3`（第二叉问句）：`branch:{"parentId":"","index":1,"count":2}`
- 同层两支同 count=2、各自 index——**两叉都在盘上且互不覆盖**，工单验收第 1 条真窗成立。

### §8-3 真机命中区实测（关 §7-6 第 1 条）

`getBoundingClientRect()` 实测：`.authoring-knowledge__branch-step` 两个按钮均 **24×24**，`branch-count` 计数格 **24×24**——批次76 度量闸口径在真机排版下成立，「未真机复核」就此销账（仅切换器一格；批次76 其余屏的账不在本批范围）。

### §8-4 验收场遗留

验收过程向 dameng-px 会话写入两条测试消息（标题「测试分支用消息」的 user 行＋两行 PINAX_IO_FAILED 错误应答）——无模型凭据下的预期失败路径，顺带验证了批次77 任务2 的 `status:"error"` 落盘。测试会话留在验收场不清理（dameng-px 是测试场，非原稿）；原稿不可变承诺不受影响（PINAX_NEXT_ROOT 指向验收场，原稿只读）。

### §8-5 提交

按作者既定指令（「你做完吧」）执行 commit-worktree＋push，CI 关注 Node22 段。
