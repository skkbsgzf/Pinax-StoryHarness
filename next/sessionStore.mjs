// 会话落盘的业务规则（行类型／30 会话与 200 消息上限／标题 24 字／墓碑 re-parent／
// 分支指针与追加式 JSONL 恢复）单一真源在 @pinax/core：`adapters/fileSessionStore.js`。
// 本文件只做宿主适配——注入 Node fs、路径拼接、回执信封与项目事件总线，不再自带一份实现。
import { readdir, readFile, appendFile, mkdir, writeFile, rename as renameFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFileSessionStoreModule } from '@pinax/core/adapters/fileSessionStore'
import { fail, ok } from './kernel/errors.mjs'
import { emitProjectEvent } from './runtime/eventBus.mjs'

// 注入面全部是宿主能力：core 是平台无关包，不 import node:fs、不认 PINAX_ 错误前缀、
// 也不持事件总线。这里的注入就是「core 规则 ↔ 宿主行为」的唯一接缝。
const coreSessionStore = createFileSessionStoreModule({
  filesystem: { readdir, readFile, appendFile, mkdir, writeFile, rename: renameFile },
  join,
  fail,
  ok,
  emitProjectEvent
})

export const SESSIONS_DIR = coreSessionStore.SESSIONS_DIR
export const SESSION_FILE_SUFFIX = coreSessionStore.SESSION_FILE_SUFFIX
export const SESSION_LINE_TYPES = coreSessionStore.SESSION_LINE_TYPES
export const MAX_SESSION_PROPOSALS = coreSessionStore.MAX_SESSION_PROPOSALS

export const isSessionId = coreSessionStore.isSessionId
export const sessionFilePath = coreSessionStore.sessionFilePath
export const sessionLine = coreSessionStore.sessionLine
export const foldSessionLines = coreSessionStore.foldSessionLines
export const createFileSessionStore = coreSessionStore.createFileSessionStore
