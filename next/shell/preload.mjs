import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, IPC_PUSH_EVENTS } from './ipcContract.mjs'

/**
 * 渲染层能拿到的全部能力：一条 request(channel, payload) ＋ 一条事件订阅。
 * 通道白名单直接来自 ipcContract——渲染层拿不到 ipcRenderer，也就拿不到任意 IPC 面。
 * 事件白名单取两张表：IPC_EVENT（pinax:agent:event:*）＋ IPC_PUSH（批次29 的运行过程事件，名字由工单钉死）。
 */
const ALLOWED_REQUEST = new Set(Object.values(IPC_CHANNELS))
const ALLOWED_EVENTS = new Set([...IPC_EVENTS, ...IPC_PUSH_EVENTS])

contextBridge.exposeInMainWorld('pinaxNext', {
  request(channel, payload = {}) {
    if (!ALLOWED_REQUEST.has(channel)) {
      return Promise.resolve({ ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `渲染层请求了未注册通道：${String(channel)}` } })
    }
    return ipcRenderer.invoke(channel, payload)
  },
  onEvent(channel, handler) {
    if (!ALLOWED_EVENTS.has(channel)) return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  channels: IPC_CHANNELS
})
