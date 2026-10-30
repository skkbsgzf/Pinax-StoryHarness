import { createRecordTools } from '../jsonRecords.mjs'
import { EXPERIENCE_CARRIER_ID } from './manifest.mjs'

/** 体验记录集：本子／会话／一次跑团／备注；状态机快照、骰子记录等私有字段放 meta。 */
export const EXPERIENCE_RECORD_CONFIG = Object.freeze({
  prefix: 'pinax_experience',
  dir: '体验',
  file: '体验.json',
  label: '体验会话',
  typeHint: '可用：scenario（本子）／session（会话）／run（一次跑团记录）／note（备注）。',
  statusHint: '可用：draft／running／ended／archived。'
})

export const EXPERIENCE_TOOL_NAMES = Object.freeze([
  'pinax_experience_list',
  'pinax_experience_read',
  'pinax_experience_save',
  'pinax_experience_remove'
])

export function createExperienceTools(context = {}) {
  return createRecordTools(
    { ...context, pluginId: context.pluginId ?? EXPERIENCE_CARRIER_ID },
    EXPERIENCE_RECORD_CONFIG
  )
}

export default createExperienceTools
