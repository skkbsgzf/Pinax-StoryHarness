import { createFileWorldbookToolsModule } from '@pinax/core/usecases/fileWorldbookTools'
import { fail, ok } from '../../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../../fs/projectPath.mjs'
import { WORLDBOOK_CARRIER, WORLDBOOK_CARRIER_ID } from './manifest.mjs'

/**
 * T10：世界书载体的工具实现整体交给 `@pinax/core/usecases/fileWorldbookTools`。
 *
 * 本文件原先自持 600 行实现（list／read／save、类别层、meta 口、关系口、frontmatter 双写），
 * 与 core 的同名模块逐字同源；T10 起只做依赖注入——宿主错误信封（fail／ok）、项目根归一与
 * 比较（next/fs/projectPath）、本栏清单（WORLDBOOK_CARRIER／WORLDBOOK_CARRIER_ID）由载体给，
 * 库／条目语义只有 core 一份。作者可见的一切不变：三把工具名与 schema、输出字段、warning
 * 文案、meta／relations 的上限与 PINAX_* 错误码全部照旧。
 *
 * 边界（本批不接、也不假装接了）：
 *   - 文件双写协调（core/worldbook/worldbookFileSyncController）不适用：Next 的落盘只有
 *     fileService 一个持久主，没有 localStorage 镜像，也没有 debounce 推送队列；并发口径由
 *     上送 expectedRevision、错号落 PINAX_STALE_REVISION 承担。
 *   - worldbookState（Pinia＋localStorage 的 Web 状态机）与结构化投影／资料迁移
 *     （sourceDocuments、writeMergeMigration、sourceArchive*）在 Next 这一栏没有对应数据与入口。
 *   - 上下文块（context.mjs）仍是载体自己的取数口：core 的 worldbookContextBuilder 是运行时
 *     注入引擎（token 预算／tier 分档），与本栏「按提问命中取前 8 条」不是同一种语义。
 *   - 文件契约（frontmatter／links／relations 的 parse／serialize）已经经 shared 单行再导出
 *     `@pinax/core/domain/worldbookFileContract`；core 的 fileWorldbookTools 也吃同一份实现。
 */
const { createWorldbookTools, WORLDBOOK_TOOL_NAMES } = createFileWorldbookToolsModule({
  fail,
  ok,
  isSameProjectRoot,
  normalizeProjectRoot,
  WORLDBOOK_CARRIER,
  WORLDBOOK_CARRIER_ID
})

export { createWorldbookTools, WORLDBOOK_TOOL_NAMES }

export default createWorldbookTools
