import { ok } from '../kernel/errors.mjs'

/**
 * 批次76-R3 另案收口（作者 2026-11-07 裁定：豁免 CF2TF 红线1 的「第二提交方」限制——
 * **仅限本条链路**：Pinax 壳内对清单声明过的本机回环 app 档窗放行原生界面）。
 *
 * 背景：ComfyUI 0.39 的 server.py origin_only_middleware 对 `Sec-Fetch-Site: cross-site`
 * 一律空体 403，而渲染层 iframe 嵌它的导航天然带这个标记——外部应用窗因此**从未真的渲染过**。
 * 放行的边界（三件闸，一条不许省）：
 *   ① 名单制：只改写「清单 app.url／工程覆盖声明过」的本机回环 origin——没声明的地址一个字节不动；
 *   ② 回环制：127.0.0.1／localhost／[::1] 之外的 host 一律不进名单（与 validateAppPane 同一条边界）；
 *   ③ 单头制：只把 `Sec-Fetch-Site: cross-site` 改成 `same-origin`，其余头（含 Cookie/Origin）原样透传。
 * ComfyUI 页面自己的请求（它在 iframe 里以 8188 为 own origin）天然 same-origin，不经过这里。
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function isLoopbackOrigin(originUrl) {
  try {
    const url = new URL(originUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function overrideUrlOf(entry) {
  const candidate = typeof entry === 'string'
    ? entry
    : entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.url : ''
  return typeof candidate === 'string' ? candidate.trim() : ''
}

/**
 * 放行名单：内置货架＋外部插件清单里声明的 app 档地址，叠加工程覆盖改过的端口。
 * 重复 origin 自然去重（Set）；非回环/非 http(s) 的声明进不了名单——清单校验本来就拒，
 * 这里再挡一次是让放行链自己站得住，不依赖上游一定闸过。
 */
export function collectAppOrigins({ manifests = [], overrides = null } = {}) {
  const origins = new Set()
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    // 两形状都认：registry 归一后的清单 panes 在顶层；@4 原始声明在 contributes.panes。
    const panes = [...(Array.isArray(manifest?.panes) ? manifest.panes : []), ...(Array.isArray(manifest?.contributes?.panes) ? manifest.contributes.panes : [])]
    for (const pane of panes) {
      const url = String(pane?.app?.url ?? '').trim()
      if (!url) continue
      const origin = originOf(url)
      if (origin && isLoopbackOrigin(origin)) origins.add(origin)
    }
  }
  if (overrides && typeof overrides === 'object') {
    for (const panes of Object.values(overrides)) {
      if (!panes || typeof panes !== 'object') continue
      for (const entry of Object.values(panes)) {
        const url = overrideUrlOf(entry)
        if (!url) continue
        const origin = originOf(url)
        if (origin && isLoopbackOrigin(origin)) origins.add(origin)
      }
    }
  }
  return origins
}

/**
 * 头改写本体：命中名单且带了 cross-site 标记才动，返回新头对象；不命中返回 null（调用方透传）。
 * 只此一个头：ComfyUI 的 Host/Origin 配对检查对 iframe 导航不触发（GET 导航无 Origin），
 * 页内自己的请求本来就是 same-origin——这一改写不替任何请求「伪造同源」，只解掉导航那道闸。
 */
export function rewriteAppOriginHeaders({ url, headers, origins }) {
  if (!url || !headers || !(origins instanceof Set) || origins.size === 0) return null
  const origin = originOf(url)
  if (!origin || !origins.has(origin)) return null
  if (String(headers['Sec-Fetch-Site'] ?? '').toLowerCase() !== 'cross-site') return null
  return { ...headers, 'Sec-Fetch-Site': 'same-origin' }
}

/**
 * 挂到 Electron session 的 webRequest 上（主进程专用；测试只吃上面两个纯函数）。
 * filter 只圈本机回环 http(s)——外网请求根本不进这个回调，名单再挡一层。
 * 每次请求现算名单（registry／覆盖都可能被换项目改掉），量级是「几个 origin 的遍历」，不值得缓存。
 */
export function installAppOriginHeaderRewrite({ session, getSources }) {
  if (!session?.webRequest || typeof getSources !== 'function') {
    return failShape('installAppOriginHeaderRewrite 需要 electron session 与 getSources')
  }
  // 诊断口（PINAX_DEBUG_APP_ORIGIN=1 才开）：放行链是「看不见的中间件」，排障时把每一发回环请求
  // 的判定结果打到 stderr——名单有没有算出来、这一发改没改，一眼可查。生产不开，零输出。
  const debug = process.env.PINAX_DEBUG_APP_ORIGIN === '1'
  const filter = { urls: ['http://127.0.0.1/*', 'http://localhost/*', 'http://[::1]/*'] }
  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    try {
      const { manifests, overrides } = getSources() ?? {}
      const origins = collectAppOrigins({ manifests, overrides })
      const rewritten = rewriteAppOriginHeaders({ url: details.url, headers: details.requestHeaders, origins })
      if (debug) {
        // eslint-disable-next-line no-console -- 诊断口：只在 PINAX_DEBUG_APP_ORIGIN=1 时输出
        console.error('[pinax-next][app-origin]', details.url.slice(0, 80), 'site=', details.requestHeaders['Sec-Fetch-Site'] ?? '-', 'declared=', origins.size, 'rewritten=', Boolean(rewritten))
      }
      callback({ requestHeaders: rewritten ?? details.requestHeaders })
    } catch (error) {
      // 名单算不出来＝按不放行走：原头透传，绝不让放行链把正常请求也挂掉。
      callback({ requestHeaders: details.requestHeaders })
      // eslint-disable-next-line no-console -- 主进程没有渲染层可报，这行必须留在 stderr
      console.error('[pinax-next] 应用面放行名单计算失败（按不放行走）：', String(error?.message ?? error))
    }
  })
  return ok({ installed: true })
}

function failShape(message) {
  return { ok: false, error: { code: 'INVALID_INPUT', message } }
}
