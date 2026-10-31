/**
 * 素材自带面板的页面脚本（协议 v3 `entry` 面的第一份真样板）。
 *
 * 这个页面跑在宿主的沙箱 iframe 里（sandbox="allow-scripts"，没有 allow-same-origin），
 * 所以它拿不到宿主的 DOM、存储与 Node——想跟宿主说话只有 postMessage 一条路。
 * 桥的合同在 next/shell/pluginBridge.mjs：面板发 ready／callTool，宿主回 toolResult／error。
 *
 * 这里只做两件事：报一声「我起来了」，再用一把**只读**工具把素材记录读出来摆成一张清单。
 * 写盘的工具宿主不会给（主进程那一侧按 annotations.readOnlyHint 拒），面板也就不用惦记撤销。
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
    try {
      parent.postMessage(message, '*')
    } catch (error) {
      showError('这条消息发不出去：' + String(error && error.message ? error.message : error))
    }
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
  var formEl = document.getElementById('filter')
  var queryEl = document.getElementById('query')

  function clearList() {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild)
  }

  function showError(text) {
    emptyEl.className = 'error'
    emptyEl.textContent = text
    emptyEl.hidden = false
  }

  function showEmpty(text) {
    emptyEl.className = 'empty'
    emptyEl.textContent = text
    emptyEl.hidden = false
  }

  function render(records) {
    clearList()
    if (!records.length) {
      showEmpty('素材/素材.json 里还没有记录（或没有命中这次检索）。')
      return
    }
    emptyEl.hidden = true
    records.forEach(function (record) {
      var item = document.createElement('li')
      var row = document.createElement('div')
      row.className = 'row'
      var title = document.createElement('span')
      title.className = 'title'
      title.textContent = record.title || record.id || '(无标题)'
      row.appendChild(title)
      if (record.type) {
        var typeTag = document.createElement('span')
        typeTag.className = 'tag'
        typeTag.textContent = record.type
        row.appendChild(typeTag)
      }
      if (record.status) {
        var statusTag = document.createElement('span')
        statusTag.className = 'tag'
        statusTag.textContent = record.status
        row.appendChild(statusTag)
      }
      item.appendChild(row)
      if (record.excerpt) {
        var excerpt = document.createElement('div')
        excerpt.className = 'excerpt'
        excerpt.textContent = record.excerpt
        item.appendChild(excerpt)
      }
      listEl.appendChild(item)
    })
  }

  async function refresh() {
    metaEl.textContent = '读取中…'
    var args = {}
    var query = (queryEl.value || '').trim()
    if (query) args.query = query
    var result = await callTool('pinax_material_list', args)
    if (!result.ok) {
      metaEl.textContent = '读取失败'
      showError((result.error && result.error.message) || '读取素材记录失败')
      return
    }
    var payload = result.payload || {}
    metaEl.textContent = payload.total + ' 条 · ' + (payload.file || '素材/素材.json')
      + (payload.truncated ? '（只显示前一批）' : '')
    render(Array.isArray(payload.records) ? payload.records : [])
  }

  formEl.addEventListener('submit', function (event) {
    event.preventDefault()
    refresh()
  })

  // 先报ready（宿主回一句 toolResult 作为「收到了」），再取数。
  post(READY, { id: 'boot' })
  refresh()
})()
