import { createRecordTools } from '../jsonRecords.mjs'
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

export function createVideoTools(context = {}) {
  return createRecordTools({ ...context, pluginId: context.pluginId ?? VIDEO_CARRIER_ID }, VIDEO_RECORD_CONFIG)
}

export default createVideoTools
