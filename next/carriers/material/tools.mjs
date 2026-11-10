import { randomUUID } from 'node:crypto'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { fail, ok } from '../../kernel/errors.mjs'
import { MATERIAL_CARRIER_ID } from './manifest.mjs'

/**
 * 素材记录集：老 narrative_assets_v1 的七种 kind 与四种 status 原样收进来（不丢字段、不改名）。
 */
export const MATERIAL_RECORD_CONFIG = Object.freeze({
  prefix: 'pinax_material',
  dir: '素材',
  file: '素材.json',
  label: '素材',
  typeHint: '可用：draft-prose／event／character-fact／worldbook-draft／inspiration／storyboard-seed／reference-image。',
  statusHint: '可用：inbox／accepted／rejected／archived。'
})

export const MATERIAL_TOOL_NAMES = Object.freeze([
  'pinax_material_list',
  'pinax_material_read',
  'pinax_material_save',
  'pinax_material_remove'
])

/**
 * T7（material 接 core）：记录文献的规则改由 `@pinax/core` 的 fileRecordTools 决定——
 * 文档形状（{ schemaVersion:1, records }）、修订号闸、未传字段保留、id 形制与四条工具的描述，
 * 只在 core 这一处；本文件只剩载体配置与宿主端口注入。
 *
 * 为什么不是 domain/material ＋ usecases/materialService：那是 0.8 从 Web localStorage
 * `narrative_assets_v1` 抽的扁平资料表（kind/status 白名单、空正文拒绝、最新在前、标题 24 字回退），
 * 与素材载体「一份 JSON 记录文献 ＋ 老数据 kind/status 混用不硬枚举」的实际合同不同；硬接会改作者可见行为。
 * core 0.11 把 Next 记录型载体的实际文件规则原样抽到 usecases/fileRecordTools，才是这条线的单一真源。
 *
 * 错误码：core 模块通过注入的宿主 fail／ok 出结果，回执天生是 PINAX_*，不存在 CORE_ERROR_CODES
 * 需要翻译的中间态，也就没有第二个翻译点可能漏码。二进制（图片）不在本批：refs 只存相对路径／外链，
 * 字节仍由宿主媒体通道负责，这份文档永远只有 JSON 文本。
 */
const recordTools = createFileRecordToolsModule({ randomUUID, fail, ok })

export function createMaterialTools(context = {}) {
  return recordTools.createRecordTools(
    { ...context, pluginId: context.pluginId ?? MATERIAL_CARRIER_ID },
    MATERIAL_RECORD_CONFIG
  )
}

export default createMaterialTools
