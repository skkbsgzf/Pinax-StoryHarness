import { randomUUID } from 'node:crypto'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { fail, ok } from '../../kernel/errors.mjs'
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

/**
 * T21（online 接 core）：记录文献语义（文档形状、修订号闸、未传字段保留、id 形制、四条工具
 * 描述与 schema）一律由 `@pinax/core` 的 fileRecordTools 决定；本文件只剩载体配置与宿主端口注入。
 *
 * 为什么只接记录 CRUD：联机这块目前只有本地房间记录，没有网络作用域、没有连接能力（清单也不
 * 声明 net）——「只记，不连」是载体边界，不是遗漏。服务器地址、邀请码等私有字段放 meta 原样搬运；
 * core 不碰网络、不碰二进制。
 */
const recordTools = createFileRecordToolsModule({ randomUUID, fail, ok })

export function createOnlineTools(context = {}) {
  return recordTools.createRecordTools(
    { ...context, pluginId: context.pluginId ?? ONLINE_CARRIER_ID },
    ONLINE_RECORD_CONFIG
  )
}

export default createOnlineTools
