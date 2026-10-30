import { createRecordTools } from '../jsonRecords.mjs'
import { COMIC_CARRIER_ID } from './manifest.mjs'

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

export function createComicTools(context = {}) {
  return createRecordTools({ ...context, pluginId: context.pluginId ?? COMIC_CARRIER_ID }, COMIC_RECORD_CONFIG)
}

export default createComicTools
