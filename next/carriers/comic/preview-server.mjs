#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * comic 载体的本地预览服务（零依赖，单文件）。
 *
 * 只读一份文件：`<项目>/漫画/漫画.json`（漫画载体的真实数据源），渲染成一页极简 HTML：
 * 页序＋每页 meta.panels 的构图与台词。没有写口，不落任何文件，图片一律不碰（refs only）。
 *
 * 项目根怎么来（服务由监督器起，cwd 是载体目录，不是项目根）：
 *   1) 查询串 `/?root=<项目绝对路径>`（外壳“预览”按钮走这条，天然按项目隔离）；
 *   2) env `PINAX_COMIC_PROJECT`（载体专用覆盖，作者手动起服务时用）；
 *   3) env `PINAX_PROJECT_ROOT`（宿主摆给所有载体服务的当前项目根）。
 * 三者都没有时回一页说明，不猜任何路径。
 * 端口：PORT → PINAX_SERVICE_PORT → 8191；只绑 127.0.0.1。
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'

const DEFAULT_PORT = 8191
const BIND_HOST = '127.0.0.1'
const PAGE_FILE = join('漫画', '漫画.json')
const MAX_PAGES = 500

function portOf() {
  for (const raw of [process.env.PORT, process.env.PINAX_SERVICE_PORT, DEFAULT_PORT]) {
    const port = Number(raw)
    if (Number.isSafeInteger(port) && port > 0 && port < 65536) return port
  }
  return DEFAULT_PORT
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

function lineOf(panel) {
  for (const key of ['dialogue', 'line', 'text', '台词']) {
    const value = panel?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function compositionOf(panel) {
  for (const key of ['composition', 'shot', 'frame', '构图']) {
    const value = panel?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pagesOf(doc) {
  const records = Array.isArray(doc?.records) ? doc.records.filter((item) => item && typeof item === 'object') : []
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const left = Number.isFinite(a.record.order) ? a.record.order : a.index
      const right = Number.isFinite(b.record.order) ? b.record.order : b.index
      return left - right || a.index - b.index
    })
    .map(({ record }) => record)
    .slice(0, MAX_PAGES)
}

function renderPage(root, doc, warning) {
  const pages = pagesOf(doc)
  const cards = pages.map((page, index) => {
    const panels = Array.isArray(page?.meta?.panels) ? page.meta.panels : []
    const panelItems = panels.map((panel, panelIndex) => {
      const composition = compositionOf(panel)
      const line = lineOf(panel)
      const bits = [composition && `构图：${escapeHtml(composition)}`, line && `台词：${escapeHtml(line)}`].filter(Boolean)
      return `<li>第 ${panelIndex + 1} 格${bits.length ? ` — ${bits.join('；')}` : '（空）'}</li>`
    }).join('')
    return `<section><h2>${index + 1}. ${escapeHtml(page?.title || page?.id || '未命名')}</h2>`
      + `<p class="meta">${escapeHtml(page?.type || '')} · ${escapeHtml(page?.status || '')} · ${panels.length} 格</p>`
      + `<ul>${panelItems || '<li>（这页还没有格）</li>'}</ul></section>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>漫画预览</title>`
    + `<style>body{font:15px/1.7 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#222}`
    + `section{border-top:1px solid #ddd;padding:.6rem 0}.meta{color:#777;font-size:13px}ul{margin:.3rem 0}</style></head><body>`
    + `<h1>漫画预览</h1><p class="meta">${escapeHtml(PAGE_FILE)} · ${pages.length} 页 · 只读</p>`
    + `${warning ? `<p class="meta">${escapeHtml(warning)}</p>` : ''}`
    + `${cards || '<p>这份漫画.json 里还没有页。</p>'}`
    + `<p class="meta">本页不落盘、不取图片；图片按各页 refs 自行查看。</p></body></html>`
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

async function serveIndex(req, res) {
  const url = new URL(req.url || '/', `http://${BIND_HOST}`)
  const root = String(
    url.searchParams.get('root') || process.env.PINAX_COMIC_PROJECT || process.env.PINAX_PROJECT_ROOT || ''
  ).trim()
  if (!root) {
    return send(res, 200, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>漫画预览</title>`
      + `<body style="font:15px/1.7 system-ui,sans-serif;max-width:720px;margin:2rem auto">`
      + `<h1>漫画预览</h1><p>还没指定项目目录。用 <code>/?root=&lt;项目绝对路径&gt;</code> 打开，`
      + `或起服务时设 <code>PINAX_COMIC_PROJECT</code>。</p></body>`)
  }
  const file = join(resolvePath(root), PAGE_FILE)
  let text
  try {
    text = await readFile(file, 'utf-8')
  } catch (error) {
    return send(res, 200, 'text/html; charset=utf-8', renderPage(root, { records: [] }, `读不到 ${file}（${error.code || error.message}）。`))
  }
  let doc = null
  let warning = ''
  try {
    doc = JSON.parse(text)
  } catch {
    return send(res, 200, 'text/html; charset=utf-8', renderPage(root, { records: [] }, `${file} 不是合法 JSON，没法预览。`))
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) warning = `${file} 顶层不是对象，按空记录集预览。`
  return send(res, 200, 'text/html; charset=utf-8', renderPage(root, doc, warning))
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0]
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: '只读服务' }))
  if (path === '/health') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }))
  if (path === '/' || path === '/index.html') {
    return void serveIndex(req, res).catch((error) => send(res, 500, 'text/html; charset=utf-8', renderPage('', { records: [] }, String(error?.message || error))))
  }
  return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: '没有这个页' }))
})

server.on('error', (error) => {
  console.error(`[comic-preview] 起不来：${error?.message || error}`)
  process.exitCode = 1
})
server.listen(portOf(), BIND_HOST, () => {
  console.log(`[comic-preview] http://${BIND_HOST}:${server.address().port}/`)
})
