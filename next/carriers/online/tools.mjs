import { createRecordTools } from '../jsonRecords.mjs'
import { ONLINE_CARRIER_ID } from './manifest.mjs'

/** 联机记录集：房间／成员／邀请／备注；服务器地址、邀请码等私有字段放 meta（只记，不连）。 */
export const ONLINE_RECORD_CONFIG = Object.freeze({
  prefix: 'pinax_online',
  dir: '联机',
  file: '联机.json',
  label: '联机房间',
  typeHint: '可用：room（房间）／member（成员）／invite（邀请）／note（备注）。',
  statusHint: '可用：open／closed／archived。'
})

export const ONLINE_TOOL_NAMES = Object.freeze([
  'pinax_online_list',
  'pinax_online_read',
  'pinax_online_save',
  'pinax_online_remove'
])

export function createOnlineTools(context = {}) {
  return createRecordTools({ ...context, pluginId: context.pluginId ?? ONLINE_CARRIER_ID }, ONLINE_RECORD_CONFIG)
}

export default createOnlineTools
