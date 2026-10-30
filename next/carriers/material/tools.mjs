import { createRecordTools } from '../jsonRecords.mjs'
import { MATERIAL_CARRIER_ID } from './manifest.mjs'

/** 素材记录集：老 narrative_assets_v1 的七种 kind 与四种 status 原样收进来（不丢字段、不改名）。 */
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

export function createMaterialTools(context = {}) {
  return createRecordTools(
    { ...context, pluginId: context.pluginId ?? MATERIAL_CARRIER_ID },
    MATERIAL_RECORD_CONFIG
  )
}

export default createMaterialTools
