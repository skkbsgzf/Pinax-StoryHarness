import { randomUUID } from 'node:crypto'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { fail, ok } from '../../kernel/errors.mjs'
import { VIDEO_CARRIER_ID } from './manifest.mjs'

/** 视频记录集：镜头／分镜／成片段／音轨／备注；时长、画幅、提示词等私有字段放 meta。 */
export const VIDEO_RECORD_CONFIG = Object.freeze({
  prefix: 'pinax_video',
  dir: '视频',
  file: '视频.json',
  label: '视频镜头',
  typeHint: '可用：shot（镜头）／storyboard（分镜）／clip（成片段）／audio（音轨）／note（备注）。',
  statusHint: '可用：draft／rendering／ready／archived。'
})

export const VIDEO_TOOL_NAMES = Object.freeze([
  'pinax_video_list',
  'pinax_video_read',
  'pinax_video_save',
  'pinax_video_remove'
])

/**
 * T21（video 接 core）：记录文献语义（{ schemaVersion:1, records } 文档形状、修订号闸、
 * 未传字段保留、id 形制、四条工具描述与 schema）一律由 `@pinax/core` 的 fileRecordTools 决定；
 * 本文件只剩载体配置与宿主端口注入，回执经注入的 fail／ok 天然是 PINAX_*。
 *
 * 为什么只接记录 CRUD：本载体的工具面就是镜头记录存取，没有渲染入口，也没有原件归档/转码的
 * 调用点可交给 core 的 media 运行时；渲染管线与原件动的是二进制与外部进程，留在宿主，按
 * limitations 记账。meta 里的时长、画幅、提示词、原件路径等私有字段原样进、原样出。
 */
const recordTools = createFileRecordToolsModule({ randomUUID, fail, ok })

export function createVideoTools(context = {}) {
  return recordTools.createRecordTools(
    { ...context, pluginId: context.pluginId ?? VIDEO_CARRIER_ID },
    VIDEO_RECORD_CONFIG
  )
}

export default createVideoTools
