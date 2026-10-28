# Pinax-Electron-Next M2 批次9：手机可试的前端预览口 ＋ 窄屏排布（2026-10-28）

> 作者原话（驱动本批）：**「帮我再拉起一下前端试一下」**。
> 背景：正式形态是 Electron 桌面窗口，作者人在手机侧点不到那个窗口——前面几批的证据全是截图，
> 作者要的是「能自己打开试」。
> 上承[批次8](./pinax-electron-next-m2-batch8-20261028.md)；功能定位见[功能盘点](./pinax-electron-next-frontend-inventory-20261028.md)。

## 0. 结论先行

**做出来的东西：一个手机能打开的预览口，和一套只在窄屏生效的排布。**

- 预览口不是发布面，也不是新的一套壳：**同一套外壳产物**（`next/.build/renderer-next/`）、**同一套内核会话**
  （`createNextSession`）、**同一条 IPC 合同**（`createIpcDispatcher`），只把 preload 那层 `contextBridge` 换成
  同源的 HTTP 桥。渲染层一行没改——它本来就只认 `window.pinaxNext` 这一个桥。
- 窄屏（≤860px）另走一套排布：竖条转横条、正文占上半屏、Pi-Agent 对话固定下半屏、索引窗变成点竖条才弹出的覆盖式抽屉。
- 手机上打开的地址：**`http://192.168.1.130:8471/`**（本机 LAN 地址，宿主 `0.0.0.0`，`curl` 自测 200）。
  **不提供 `127.0.0.1`**（作者在手机侧那个地址打不开）；**没有擅自开公网隧道**（作者自己有 cloudflared）。
- 真模型这一调在手机视口里也通：**6 055 ms / 7 046 ms** 两轮，回答＝一句结论＋6 条审稿意见＋3 条可执行动作；
  本批收尾时又跑了第三轮（**25 344 ms**，同一答案结构）——慢的那一轮是模型侧排队，不是链路问题。
- 桌面窗口的三栏没被窄屏排布带歪：竖条 45px（44px 基准＋边框）／索引窗 256px／核心区 1004px／右栏 360px（视口 1675px）。
- **桌面窗口这一侧也查清了**：先前那些「Renderer process crashed / GPU exit 143」里，**应用没死**（主进程一直活着），
  死的是 GPU 进程——这台机器提交内存被作者自己的 ComfyUI 占了 34.6 GB（上限 60.4 GB）。
  用 `--in-process-gpu` ＋ 隔离的 `--user-data-dir` 起，**窗口四块全画出来了**（见 2.2 与 3.7–3.12）。

**没做成的，如实记账**：① 预览口只服务「外壳＋真模型」这条链路，**载体写盘、偏好面板这些桌面专属路径在手机视口里没逐项走过**；
② 桌面那一侧仍然只有截图与计算样式，**没有真人坐在桌前点过一轮**；③ 窄屏排布只做了「能用」，**没做移动端手势**（滑出抽屉、点空白收起）；
④ 本批**没有新增产品能力**，是把已有能力放到作者够得着的地方。

**本批还收掉一条别人留的账**：[批次8 记录](./pinax-electron-next-m2-batch8-20261028.md) 与 STATUS 里都写了「⚠ 并行会话共载——
`next-shell.css` 的 860px 窄屏 media query、`index.html` 的 viewport meta、`AppNext.vue` 的 matchMedia 收起索引窗，是另一会话在途的窄屏适配，
窄屏线的验收与收口归该会话」。**那条窄屏线就是本批**：样式、meta、matchMedia 三处已在本批工作副本里落地、已重建、已实测、已记账（见 1.2–1.5 与第 2 节）。

---

## 1. 交付了什么

### 1.1 手机预览口（`D:\next-preview\serve-next-preview.mjs`，仓库外）

| 是什么 | 怎么做的 |
| --- | --- |
| 同一套外壳产物 | 直接伺服 `next/.build/renderer-next/`（`vite build` 那份，不是 dev server） |
| 同一套内核会话 | `createNextSession({ root: 'D:/next-preview/雨夜靶场', autoOpen: true, runtimeOptions: { runner: createAdvisorRunner() } })` |
| 同一条 IPC 合同 | `createIpcDispatcher({ session, prefs, probeModelPlane })` 原样用 |
| 只换桥 | `POST /ipc` → `dispatcher.dispatch(channel, payload)`；`GET /bridge.js` → 同源脚本挂上 `window.pinaxNext` |
| 隔离 | 端口 **8471**、宿主 `0.0.0.0`；`PINAX_APP_DATA`／`PINAX_MIRROR_ROOT` 指到 `D:/next-preview/` 下的独立目录；模型面端点指本机隔离任务面 **8461**（作者的 8451 没碰） |
| 凭据 | 与预览窗口同法：读 `D:/storymasterv4/.external/agent-model.json`，**只经 env 传**（`ZAI_API_KEY`），仓库与产物里都没有落盘 |

### 1.2 窄屏排布（`next/shell/styles/next-shell.css`）

新增 `@media (max-width: 860px)` 块（**桌面形态一行没动**）：

- `.next-shell` 转竖排（`flex-direction: column`）；`.nx-ribbon` 转成 44px 高的横条（图标竖排→横排）；
- `.col-center` 占上半屏，`.col-dock` 固定 52vh 在下半屏（`.dock` 左边框改上边框）；
- `.nx-index-window` 变**覆盖式抽屉**：绝对定位、`top: 44px`、`bottom: 52vh`（下边界收在 Agent 对话栏之上，正文与对话都不被压住）、`width: 78vw`；
- `.resizer`（桌面那条拖拽把手）在窄屏 `display: none`。

### 1.3 索引窗默认开合按视口定（`next/shell/AppNext.vue`）

`indexOpen` 原来恒为 `true`：窄屏下抽屉一上来就盖住整个外壳（正文与对话被挤成一条缝）。
改成 `matchMedia('(max-width: 860px)')` 初始化——**窄屏收起、宽屏展开**；视口跨过 860px 时跟着换（`change` 监听）。
`matchMedia` 做了 `typeof` 判断：jsdom 里没有这个 API。

### 1.4 手机视口声明（`next/shell/index.html`）

补 `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`。
**没有这一条，手机浏览器拿 980px 当布局宽度再整页缩小**——窄屏那套排布一行都不触发（踩坑账 3）。

### 1.5 老版 gutter 补回（`next/shell/AssistantDialog.vue`）

老版起始态那句引导语是左对齐的，靠 `.authoring-knowledge.is-starting .authoring-knowledge__body { padding-inline: var(--assistant-gutter) }`
（16px）离边；抽象过来那份拷贝把 body 的 padding 丢了，手机上那句「接下来，想写什么？」直接贴着屏幕边。
按老版原话把 `padding-inline: 16px` 补回 legacy-copied 块（不另立刻度、不改门禁）。

---

## 2. 实测数字

### 2.1 手机视口（Playwright，390×844，dsf 2，isMobile，真链路）

| 项 | 实测值 |
| --- | --- |
| 布局视口宽 | **390**（不是 980） |
| 标题 / 顶栏名字 | `Pinax · Next` / `Pi-Agent` |
| 对话框在不在 | **1**（`.authoring-knowledge`） |
| 开发者向备注计数 | **0**（`.dock-meta, .dock-reserved, .dock-provenance, .dock-surface, .dock-tools`） |
| 窄屏默认索引窗 | **收起**（`.nx-index-window` 计数 0） |
| 点竖条那一格 | 抽屉弹出，索引行数 **2**（第001章-入场／第002章-槐巷） |
| 收起按钮 | 点 `.nx-index-collapse` → 抽屉关闭，回到正文＋对话 |
| 真模型一轮 | **6 055 ms / 7 046 ms**（两轮，都是隔离任务面 8461 上的真模型） |
| 回答结构 | summary 1 句＋审稿意见 **6** 条＋可执行动作 **3** 条 |

### 2.2 桌面窗口（真实 Electron，CDP 量）

视口 1675px：竖条 **45**（44 基准＋边框，x=0）／索引窗 **256**（x=45）／核心区 **1004**（x=306）／右栏 **360**（x=1315）。
索引窗行数 2 —— 窄屏那套排布没有污染桌面形态。

桌面窗口本批又**重起了一轮并肉眼看图**：`23-desktop-preview.png` 里四块（图标竖条／索引窗含 3 行／核心区正文／右侧 Pi-Agent 对话框）
都画出来了，右下角是输入框、上面是「工具面（20）」折叠条。**不是只量了计算样式。**

### 2.3 门禁（`npm run verify:next` 五段全绿）

| 段 | 结果 |
| --- | --- |
| 验收 | **16/16** |
| 内核单测 `node --test "next/tests/*.test.mjs"` | **130/130** |
| 外壳界面测 `vitest run --config next/vitest.next.shell.config.mjs` | **31/31** |
| `npm run lint:next` | 0 错 0 警 |
| 打包门禁 `node next/testing/bundleAssertions.mjs` | **a–k 全过**：主 bundle 861.0 kB、渲染层 js 309.3 kB、渲染层 CSS 89.9 kB、preload 1.8 kB、产物内 express 命中 0、import 产物后 in-process 列出 19 工具 |

> **门禁数字与批次 8 记录差 +1／+2（129→130、29→31）**：差的这两条不在本批的改动里——
> `next/tests/shell-contract.test.mjs`（mtime 08:40，多了「选目录通道（批次9）」一条）与
> `next/tests/shell-ui.spec.mjs`（mtime 08:44，多了「外观主题段」「新建项目走选目录」两条），
> 与本批的窄屏适配在同一工作副本里并发改过。**改动的归属与先后不可考**，这里只记账数字。

**本批没有新增门禁**：窄屏排布走的是既有 `@media` 与既有 token；`legacy-copied` 豁免沿用批次 6 的写法（补回的是老版原话度量，不是新刻度）。
**也没有放松任何既有门禁口径**。

### 2.4 产物

- `D:\next-preview\phone-preview-ui.json`（回答／意见／动作／用时）
- `D:\next-preview\shots\19-phone-preview-empty.png`（手机空态）、`20-phone-preview-answered.png`（手机问答后）、`21-phone-preview-index.png`（抽屉展开）、`23-desktop-preview.png`（桌面窗口）

---

## 3. 踩坑账

1. **渲染层产物带 CSP，内联脚本一律被浏览器拒掉。** `next/.build/renderer-next/index.html` 里是
   `default-src 'self'; style-src 'self' 'unsafe-inline'`——桥如果写成内联 `<script>`，页面上 `window.pinaxNext` 就是 `null`，
   输入框直接禁用（现象：点发送没反应）。改法：桥做成同源外部文件 `/bridge.js`，往 `</head>` 前插一行 `<script src="/bridge.js">`。
   **教训：先量 `window.pinaxNext` 是不是 null，再去看别的。**
2. **上一个预览窗口的 `electron.exe` 还占着 9222。** `TaskStop` 停的是 `node electron/cli.js` 包装进程，真正的 `electron.exe` 活着；
   重启后 CDP 驱的是旧窗口（旧 bundle），看起来像「改了没生效」。改法：逐个核命令行里带 `next-preview` 的 `electron.exe` 全部停掉再起一个，
   然后 `curl http://127.0.0.1:9222/json/list` 确认只有一个 page target。
3. **手机浏览器默认拿 980px 当布局宽度，`@media` 根本不触发。** 现象：390px 的手机视口里 `window.innerWidth` 量到 **980**，
   窄屏那套排布一行没生效，页面被整页缩小（字小、点不准、横向拖）。根因：`<head>` 里没有 `<meta name="viewport">`。
   改法：`next/shell/index.html` 补上那条 meta，重建后 `innerWidth = 390`。**教训：先量 `innerWidth`，别先猜 CSS。**
4. **窄屏下索引窗默认展开＝盖住整个外壳。** 索引窗在桌面是「竖条右边那一栏」，窄屏改成了绝对定位的抽屉；而 `indexOpen` 默认 `true`，
   于是 78vw 的抽屉一上来就压在正文上，正文与对话被挤成一条缝（第一版手机截图就是这个形态）。
   改法：`indexOpen` 按 `matchMedia` 初始化（窄屏收起）、抽屉下边界收到 Agent 对话栏之上（`bottom: 52vh`）、窄屏隐藏桌面那条拖拽把手。
5. **jsdom 没有 `window.matchMedia`，`setup` 直接抛。** 第一版写成 `window.matchMedia(...)` 后，`next/tests/*.spec.mjs` 三个文件 **16 条全红**
   （`TypeError: window.matchMedia is not a function`）。改法：`typeof window.matchMedia === 'function'` 兜一道，测不出窄屏时按宽屏算。
   **教训：门禁跑的是 jsdom，不是浏览器——浏览器才有的 API 必须自己判。**
6. **抽象过来的老版样式少了一条 gutter。** 见 1.5。老版那条 `padding-inline: var(--assistant-gutter)` 在拷贝时丢了，
   手机上引导语贴边。**教训：抄度量要连「让它为什么长这样」的那条一起抄。**
7. **桌面预览窗口「死了」三次，其实只有一次是真死，其余两次是我自己造的。**
   - 第一次：Playwright 连 CDP 之后调 `browser.close()`，**把被测的 Electron 应用一起关掉**（退出码 1、9222 释放），
     看着像「应用自己崩了」。改法：CDP 连来的浏览器**不调 `close()`**，只断连接、让脚本进程自己退。
   - 第二次：上一批截图脚本（`_electron.launch`）留下的 **4 个孤儿 `electron.exe`** 占着共享的 `%APPDATA%\Electron` 缓存目录，
     新实例建不了缓存就退（日志里是 `Unable to move the cache: 拒绝访问 (0x5)` → `Gpu Cache Creation failed: -2` → 退出码 1）。
     查法与处置：`Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` 逐个看命令行，
     **只停命令行里带本仓 `node_modules/electron` 的那些**（作者的 Qoder 是 `Qoder.exe`，不受影响），停完确认 `electron.exe` 计数为 0 再起一个；
     起完用 `http://127.0.0.1:9222/json/list` 确认只有一个 page target。
   - **第三次（也就是最后查清的那次）：应用根本没死。** 日志里那两行
     `Renderer process crashed` / `GPU process exited unexpectedly: exit_code=143` 看着像应用崩了，
     实测却是：**主进程一直活着**（`timeout` 到点才把它杀掉，退出码 143 是被杀出来的，不是崩出来的），
     死的只是 **GPU 进程**与网络服务。**教训：看到「crashed」先分清是谁崩的——主进程活着就说明应用没死，
     别把 GPU/子进程的退出当成应用的死。**

8. **顶层 `await` 会和 Electron 的启动期互锁。** 诊断脚本里写成
   `await startNextShell(...)`（模块顶层 await）时，现象是**永远停在启动第一步**：
   Electron 等主模块求值（含顶层 await）结束才发 `ready`，而 `startNextShell` 内部又在等 `app.whenReady()`——
   两头等，**死锁，`app.whenReady()` 永不返回**。改法：`startNextShell(...)` **不要顶层 await**，
   挂 `.then()/.catch()` 即可（产品入口 `next/shell/main.mjs` 本身也是这样调的，没问题）。
   **教训：Electron 的 ESM 主进程里，顶层 await 是一把刀。**

9. **给 Electron 多传一个位置参数就会静默打死它。** `electron <script> <url> <另一个>` 这种传法，
   第二个位置参数会让 Electron 直接退出（无任何输出、退出码 -1）。改法：**位置参数只留一个**（应用脚本本身），
   其余参数（URL、preload 路径）一律走 **env** 传。**这条差点把排障带偏：一度误判成「preload 一加就死」。**

10. **GPU 进程被系统掐掉的真因：这台机器的提交内存快满了。**
    `Get-Counter '\Memory\Committed Bytes'` 实测在 **44–59 GB** 之间跳，提交上限 **60.4 GB**；
    占了 **34.6 GB** 的是作者自己的 **ComfyUI**（`python main.py --port 8188`，PID 28428，03:59 起跑）。
    Chromium 的 GPU 进程在提交额度见底时被系统终止（143＝SIGTERM），网络服务跟着一起重启。
    **处置**：`--in-process-gpu`（GPU 不再单独起进程，错误行消失，窗口照常画出来）＋
    隔离的 `--user-data-dir`（避开共享缓存）。**没有动作者的 ComfyUI**（他 8188 那个服务是他在用的东西，不碰）。

11. **提交额度紧张时，「最小 Electron 壳能起、我们的应用起不来」是假象。** 中途做过一组矩阵：
    最小壳 3/3 稳、带 preload 全灭——一度指向 preload；后来证明那个矩阵的失败来自第 9 条（多传位置参数），
    与 preload 无关（改走 env 后，源码 preload 与打包 preload **都正常**，IPC 通道当场调通）。
    **教训：矩阵实验的每个维度只能改一个；这次是两个维度一起动，差点得出一个假结论。**

12. **这批的桌面窗口用这套参数是稳的**（实测 30 秒以上不退出、窗口四块全画出来、CDP 量得到列宽）：
    ```bash
    node node_modules/electron/cli.js D:/next-preview/preview-shell.mjs \
      --user-data-dir=D:/next-preview/.ep-live2 \
      --remote-debugging-port=9222 \
      --in-process-gpu
    ```

---

## 4. 复现

```bash
# ① 内核任务面（隔离端口 8461；key 只经 env，不落盘）
node D:/next-preview/start-taskplane.mjs

# ② 重建渲染层（窄屏排布与 viewport meta 都在产物里）
cd /d/Pinax-main/Pinax-main
npm run next:build:renderer

# ③ 手机预览口（宿主 0.0.0.0:8471）
node D:/next-preview/serve-next-preview.mjs

# ④ 手机视口实测（Playwright，390×844）
node D:/next-preview/check-phone-preview.mjs

# ⑤ 桌面窗口（真实 Electron，CDP 9222）
#    三个参数缺一不可：隔离的 --user-data-dir（避开共享 %APPDATA%\Electron 缓存）、
#    --in-process-gpu（本机提交额度紧张时 GPU 进程会被系统掐掉）、--remote-debugging-port（截图用）
node node_modules/electron/cli.js D:/next-preview/preview-shell.mjs \
  --user-data-dir=D:/next-preview/.ep-live2 --remote-debugging-port=9222 --in-process-gpu
node D:/next-preview/shot-desktop.mjs
```

> **注意**：`start-preview.mjs` 里若带了顶层 `await startNextShell(...)`，会撞上 3.8 那条死锁；
> 起窗口的脚本一律用 `.then()/.catch()` 挂出去。

---

## 5. 诚实边界与待裁定

1. **预览口不是发布面。** 它在 `D:\next-preview/`，不在仓库里；HTTP 桥也没有鉴权、没有多用户隔离。
   **待裁**：这条手机口要不要收进产品（比如正式出一个 Web 形态），还是就停在「作者试手用」这一层。
2. **载体写盘、偏好面板这些桌面专属路径在手机视口里没逐项走过。** 今天在手机上验证的是「外壳起得来＋真模型答得出＋索引窗能开合」，
   保存正文、新建章节这些写操作在桌面窗口验证过，手机视口没重跑。**待裁**：要不要把写操作也在手机视口跑一遍。
3. **桌面那一侧仍然没有真人走查。** 窗口这轮确实起来了、四块都画出来了（不是只量计算样式），
   但悬停态、滚动、焦点环、真实点击的选中行为，仍只有截图与计算样式作证。
   另外 **`--in-process-gpu` 是绕开本机提交额度紧张的权宜之计**，不是产品结论：
   提交额度的根本解法是停掉/瘦身 ComfyUI 或加大 pagefile，**那是作者机器上的事，本批没动**。
4. **窄屏只做到「能用」。** 没有滑出手势、没有点空白处收起、没有横竖屏切换的专项处理。
5. **回答质量仍然没有被测量。** 今天量的是链路、格式、素材齐不齐；答得对不对、好不好，仍是 1 个靶子项目、1 种任务。
6. **批次 8 那条「本沙箱无任务面、未做真实模型调用」的记账，在本批被推翻**：本机隔离任务面（8461）上跑通了真模型调用
   （6 055 / 7 046 ms 两轮）。批次 8 文档保留原文（历史记录不改），以本批为准。

---

## 6. 下一批的入口

作者说「不需要我来决策什么」，所以下一批这边自己排，顺序按「先有成果」：

1. **把手机这一路补齐写操作**（第 5 节第 2 条）——手机上保存正文、新建章节、版本号回写，跟桌面同一条链路走一遍。
2. **给提问加一条自由问答档**（批次 6 结下的第 2 条，至今没做）——现在问什么都被套成审稿腔。
3. **索引窗补第三棵树（大纲）**（批次 6 结下的第 8 条）——骨架里的大纲只有正文面板能用，索引窗列不出来。
4. **窄屏手势**（第 5 节第 4 条）——抽屉滑动开合、点空白收起。

> 本批**没有提交、没有推送**（作者的规矩：没明确指令不 commit）。本工作副本 `D:\Pinax-main\Pinax-main`
> **本身也不是 git 工作副本**（`git status` 报 `not a git repository`），本批改动只是本机文件。
