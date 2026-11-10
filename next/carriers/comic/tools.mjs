import { randomUUID } from 'node:crypto'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { fail, ok } from '../../kernel/errors.mjs'
import { COMIC_CARRIER_ID } from './manifest.mjs'
import { normalizeComicMetaForSave } from './comicPageStore.mjs'

/** 漫画记录集：一页一条；panels 原样放 meta，画画／排版工具进来时不必再改文档形状。 */
export const COMIC_RECORD_CONFIG = Object.freeze({
  prefix: 'pinax_comic',
  dir: '漫画',
  file: '漫画.json',
  label: '漫画页',
  typeHint: '可用：comic-page（成品页）／comic-script（脚本页）／note（备注）。',
  statusHint: '可用：draft／ready／archived。'
})

export const COMIC_TOOL_NAMES = Object.freeze([
  'pinax_comic_list',
  'pinax_comic_read',
  'pinax_comic_save',
  'pinax_comic_remove'
])

/**
 * T8（comic 接 core）：记录文献的规则改由 `@pinax/core` 的 fileRecordTools 决定——
 * 文档形状（{ schemaVersion:1, records }）、修订号闸、未传字段保留、id 形制与四条工具的描述
 * 只在 core 这一处；本文件只剩载体配置、宿主端口注入，以及漫画页 meta 的媒体域归一。
 *
 * 媒体域语义（comicPageStore.mjs）只挂在 save 上：显示选择与「阶段产物 vs 普通图片候选」
 * 的选中规则由 core 的 media/comicPanelDisplay 决定，其余字段（composition／dialogue／未知字段）
 * 一个字节不改——对作者可见的 JSON 与回执形状保持原样。list／read／remove 与 core 产物逐字同形。
 */
const recordTools = createFileRecordToolsModule({ randomUUID, fail, ok })

function withComicPageSemantics(tool) {
  return {
    ...tool,
    run: (args = {}) => tool.run(
      args.meta === undefined ? args : { ...args, meta: normalizeComicMetaForSave(args.meta) }
    )
  }
}

export function createComicTools(context = {}) {
  const tools = recordTools.createRecordTools(
    { ...context, pluginId: context.pluginId ?? COMIC_CARRIER_ID },
    COMIC_RECORD_CONFIG
  )
  return tools.map((tool) => (tool.name === 'pinax_comic_save' ? withComicPageSemantics(tool) : tool))
}

export default createComicTools
