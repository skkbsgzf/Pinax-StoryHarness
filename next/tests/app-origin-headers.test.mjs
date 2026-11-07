import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectAppOrigins, rewriteAppOriginHeaders } from '../shell/appOriginHeaders.mjs'

/**
 * 〔批次76-R3 另案·作者裁定豁免红线1（仅限本链路）〕应用面放行名单三件闸：
 * 名单制（只认声明过的 origin，清单＋工程覆盖两个来源）、回环制（非回环 host 进不了名单）、
 * 单头制（只改 cross-site→same-origin 这一个头，其余头原样）。
 */

test('名单制：清单 app.url 与工程覆盖都进名单，重复 origin 去重', () => {
  const origins = collectAppOrigins({
    manifests: [
      { id: 'comic', contributes: { panes: [{ id: 'comic.comfyui', app: { url: 'http://127.0.0.1:8188' } }] } },
      { id: 'ext.media-suite', contributes: { panes: [{ id: 'media.toonflow', app: { url: 'http://127.0.0.1:3010/' } }] } }
    ],
    overrides: { 'ext.media-suite': { 'media.comfyui': { url: 'http://localhost:9999' } } }
  })
  assert.deepEqual([...origins].sort(), ['http://127.0.0.1:3010', 'http://127.0.0.1:8188', 'http://localhost:9999'])
})

test('回环制：非回环 host／非 http(s) 的声明进不了名单', () => {
  const origins = collectAppOrigins({
    manifests: [
      { contributes: { panes: [{ app: { url: 'https://evil.example.com' } }] } },
      { contributes: { panes: [{ app: { url: 'file:///etc/passwd' } }] } },
      { contributes: { panes: [{ app: { url: 'http://192.168.1.5:8188' } }] } }
    ],
    overrides: null
  })
  assert.equal(origins.size, 0)
})

test('单头制：命中名单且 cross-site 才改，只动这一个头', () => {
  const origins = collectAppOrigins({ manifests: [{ contributes: { panes: [{ app: { url: 'http://127.0.0.1:8188' } }] } }], overrides: null })
  const rewritten = rewriteAppOriginHeaders({
    url: 'http://127.0.0.1:8188/',
    headers: { 'Sec-Fetch-Site': 'cross-site', Accept: 'text/html', Cookie: 'a=1' },
    origins
  })
  assert.deepEqual(rewritten, { 'Sec-Fetch-Site': 'same-origin', Accept: 'text/html', Cookie: 'a=1' })
})

test('不放行面：未声明 origin／same-origin 请求／空名单一律原样（返回 null）', () => {
  const origins = collectAppOrigins({ manifests: [{ contributes: { panes: [{ app: { url: 'http://127.0.0.1:8188' } }] } }], overrides: null })
  assert.equal(rewriteAppOriginHeaders({ url: 'https://evil.example.com/', headers: { 'Sec-Fetch-Site': 'cross-site' }, origins }), null)
  assert.equal(rewriteAppOriginHeaders({ url: 'http://127.0.0.1:8188/', headers: { 'Sec-Fetch-Site': 'same-origin' }, origins }), null)
  assert.equal(rewriteAppOriginHeaders({ url: 'http://127.0.0.1:8188/', headers: { 'Sec-Fetch-Site': 'cross-site' }, origins: new Set() }), null)
  assert.equal(rewriteAppOriginHeaders({ url: null, headers: {}, origins }), null)
})
