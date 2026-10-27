/**
 * Next 外壳复用老前端的视觉层。
 *
 * 导入的是老前端那几份 CSS 的本体（不是拷贝）：改了 src/styles 里的 token，
 * Next 外壳跟着变——这就是「风格复用」的意思，不是把配色抄一份过来。
 * 顺序与 src/main.js:9-13 一致（main → themes/legacy → workbench-controls）。
 *
 * 后两份是老前端工作区的 chrome（AppShell.vue:20-21 引的就是这两份）：
 * 导航行词汇（.workspace-nav-item）与两级选中色（--nav-*）都住在里面。
 * Next 外壳的根节点挂上 .app-shell，老版那两段 token 与行规则才会生效——
 * 于是竖条、索引窗、核心区的颜色与行高全部来自原件，Next 不另配一套。
 *
 * 故意不引的两份：
 *   - experience-reading.css：整份作用域在 .theme-legacy .game-page .prose-reading-plane，
 *     是老前端「跑团阅读页」的排版，Next 外壳用不到；
 *   - interface-language.css：只管 :lang(en) 的语种覆盖与旧页面选择器。
 */
import '../../../src/styles/main.css'
import '../../../src/styles/themes/legacy.css'
import '../../../src/styles/workbench-controls.css'
import '../../../src/styles/workspace-navigation.css'
import '../../../src/styles/workspace-surfaces.css'
import './next-shell.css'
