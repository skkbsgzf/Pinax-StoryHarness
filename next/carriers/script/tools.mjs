import { createFileScriptToolsModule } from '@pinax/core/usecases/fileScriptTools'
import { fail, ok } from '../../kernel/errors.mjs'
import { SCRIPT_CARRIER_ID } from './manifest.mjs'

/**
 * T21（script 接 core）：剧本三把工具（pinax_script_list／read／save）的实现整份由
 * `@pinax/core` 的 fileScriptTools 决定——篇目清单与文件名排序、前 20000 字随列表截断并标注、
 * 只认 .md、maxChars 读取截断、标题／路径定位、修订号闸与 .md 文件名清洗都在 core 那份里，
 * 与仓内旧内联实现逐字同源。本文件只剩宿主端口（PINAX_* 的 fail／ok、载体 id）注入。
 *
 * 读盘仍走内核文件服务（next/fs/fileService.mjs）：归属闸、作用域闸、修订并发都在那边。
 */
const scriptTools = createFileScriptToolsModule({ fail, ok, SCRIPT_CARRIER_ID })

/** 剧本目录：对外仍从这里取，值由 core 模块给。 */
export const SCRIPT_DIR = scriptTools.SCRIPT_DIR

/** 载体自有的三把工具名，供门禁核「认领面只增不减」。 */
export const SCRIPT_TOOL_NAMES = scriptTools.SCRIPT_TOOL_NAMES

export function createScriptTools(context = {}) {
  return scriptTools.createScriptTools({ ...context, pluginId: context.pluginId ?? SCRIPT_CARRIER_ID })
}

export default createScriptTools
