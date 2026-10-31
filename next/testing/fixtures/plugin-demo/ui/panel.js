/**
 * 夹具面板的脚本：协议 v3 的面板桥最小可跑实现。
 *
 * 面板跑在沙箱 iframe 里（sandbox="allow-scripts"，没有 allow-same-origin），
 * 拿不到宿主的 DOM、存储与 Node——跟宿主说话只有 postMessage 一条路。
 * 合同在 next/shell/pluginBridge.mjs：面板发 ready／callTool，宿主回 toolResult／error。
 */
(function () {
  'use strict'

  var READY = 'pinax.panel.ready'
  var CALL = 'pinax.panel.callTool'
  var RESULT = 'pinax.panel.toolResult'
  var ERROR = 'pinax.panel.error'

  var pending = new Map()
  var seq = 0

  function post(type, body) {
    var message = { type: type }
    if (body) for (var key in body) if (Object.prototype.hasOwnProperty.call(body, key)) message[key] = body[key]
    parent.postMessage(message, '*')
  }

  function callTool(name, args) {
    var id = 'call-' + (++seq)
    return new Promise(function (resolve) {
      pending.set(id, resolve)
      post(CALL, { id: id, name: name, arguments: args || {} })
    })
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || typeof data !== 'object') return
    var id = String(data.id || '')
    if (data.type === RESULT) {
      var resolve = pending.get(id)
      if (!resolve) return
      pending.delete(id)
      resolve({ ok: Boolean(data.ok), payload: data.payload, error: data.error })
      return
    }
    if (data.type === ERROR) {
      var fail = pending.get(id)
      if (!fail) return
      pending.delete(id)
      fail({ ok: false, error: { message: data.message || '宿主回了一个说不清的错' } })
    }
  })

  var listEl = document.getElementById('list')
  var emptyEl = document.getElementById('empty')
  var metaEl = document.getElementById('meta')

  function show(text, isError) {
    emptyEl.className = isError ? 'error' : 'empty'
    emptyEl.textContent = text
    emptyEl.hidden = false
  }

  async function refresh() {
    metaEl.textContent = '读取中…'
    var result = await callTool('demo_list', {})
    if (!result.ok) {
      metaEl.textContent = '读取失败'
      show((result.error && result.error.message) || '读取演示记录失败', true)
      return
    }
    var payload = result.payload || {}
    var items = Array.isArray(payload.items) ? payload.items : []
    metaEl.textContent = items.length + ' 条'
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild)
    if (!items.length) {
      show('演示记录是空的。')
      return
    }
    emptyEl.hidden = true
    items.forEach(function (item) {
      var li = document.createElement('li')
      li.textContent = String(item)
      listEl.appendChild(li)
    })
  }

  post(READY, { id: 'boot' })
  refresh()
})()
