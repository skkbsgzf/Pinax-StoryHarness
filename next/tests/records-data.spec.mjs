import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { useBoardData } from '../shell/useBoardData.mjs'
import IndexWindow from '../shell/IndexWindow.vue'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 批次40（M4／M5）记录型载体的数据层：不挂组件，直接驱动 useBoardData。
 * 面板只经 runtimeToolCall 这一条通道读写，所以这里用与真工具同形状的假桥
 * （{ok, value:{owner, payload}}）钉住：树怎么载、草稿怎么走、保存／删除带不带修订号、
 * 事件刷新会不会冲掉正在编辑的草稿。
 */

function fakeBridge() {
  const docs = {
    material: {
      revision: 1,
      records: [{
        id: 'material-1',
        title: '雨夜参考图',
        type: 'reference-image',
        status: 'inbox',
        order: 0,
        body: '巷口一盏灯。',
        tags: ['雨夜'],
        refs: ['资料/参考/雨夜.png'],
        meta: { width: 1200 },
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:00:00.000Z'
      }]
    },
    comic: { revision: 0, records: [] },
    video: { revision: 0, records: [] },
    experience: { revision: 0, records: [] },
    online: { revision: 0, records: [] }
  }
  const calls = []
  let nextId = 2

  async function request(channel, payload = {}) {
    if (channel !== IPC_CHANNELS.runtimeToolCall) return { ok: false, error: { message: `未接通道：${channel}` } }
    calls.push({ tool: payload.tool, args: payload.args ?? {} })
    const matched = /^pinax_(material|comic|video|experience|online)_(list|read|save|remove)$/u.exec(String(payload.tool ?? ''))
    if (!matched) return { ok: true, value: { owner: 'kernel', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '未知工具' } } }
    const [, key, verb] = matched
    const doc = docs[key]
    const args = payload.args ?? {}
    const fail = (code, message) => ({ ok: true, value: { owner: `pinax.carrier.${key}`, payload: { ok: false, code, message } } })
    const pass = (extra) => ({ ok: true, value: { owner: `pinax.carrier.${key}`, payload: { ok: true, file: `${key}/${key}.json`, revision: doc.revision, ...extra } } })

    if (verb === 'list') {
      return pass({
        total: doc.records.length,
        records: doc.records.map((record) => ({
          id: record.id, title: record.title, type: record.type, status: record.status,
          order: record.order, updatedAt: record.updatedAt, excerpt: record.body.slice(0, 200)
        })),
        truncated: false
      })
    }
    if (verb === 'read') {
      const record = doc.records.find((item) => item.id === args.id)
      return record ? pass({ record }) : fail('PINAX_INVALID_INPUT', '没有这条记录')
    }
    if (args.expectedRevision !== doc.revision) return fail('PINAX_STALE_REVISION', `「${key}/${key}.json」已被改动（第 ${doc.revision} 版）`)
    if (verb === 'save') {
      if (args.id !== undefined) {
        const index = doc.records.findIndex((item) => item.id === args.id)
        if (index < 0) return fail('PINAX_INVALID_INPUT', '没有这条记录')
        const old = doc.records[index]
        const record = {
          ...old,
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.type !== undefined ? { type: args.type } : {}),
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.body !== undefined ? { body: args.body } : {}),
          ...(args.tags !== undefined ? { tags: args.tags } : {}),
          ...(args.refs !== undefined ? { refs: args.refs } : {}),
          ...(args.meta !== undefined ? { meta: args.meta } : {}),
          updatedAt: '2026-10-30T01:00:00.000Z'
        }
        doc.records[index] = record
        doc.revision += 1
        return pass({ created: false, record })
      }
      const record = {
        id: `${key}-${nextId++}`,
        title: args.title,
        type: args.type ?? '',
        status: args.status ?? '',
        order: doc.records.length,
        body: args.body ?? '',
        tags: args.tags ?? [],
        refs: args.refs ?? [],
        meta: args.meta ?? {},
        createdAt: '2026-10-30T01:00:00.000Z',
        updatedAt: '2026-10-30T01:00:00.000Z'
      }
      doc.records.push(record)
      doc.revision += 1
      return pass({ created: true, record })
    }
    // remove
    const index = doc.records.findIndex((item) => item.id === args.id)
    if (index < 0) return fail('PINAX_INVALID_INPUT', '没有这条记录')
    const [removed] = doc.records.splice(index, 1)
    doc.revision += 1
    return pass({ removed })
  }

  return { request, calls, docs }
}

describe('记录型载体数据层（批次40）', () => {
  it('载树→点开→编辑→保存：修订号与未传字段原样保留，标签／引用按界面口径拆行', async () => {
    const bridge = fakeBridge()
    const data = useBoardData(bridge)

    await data.loadRecords('material', { syncCurrent: false })
    expect(data.recordSets.material.loaded).toBe(true)
    expect(data.recordSets.material.revision).toBe(1)
    expect(data.recordSets.material.records.map((item) => item.title)).toEqual(['雨夜参考图'])
    expect(data.loadedTrees['records:material']).toBe(true)

    await data.openRecord('material', data.recordSets.material.records[0])
    expect(data.record.carrier).toBe('material')
    expect(data.record.revision).toBe(1)
    expect(data.recordDraft.tags).toBe('雨夜')
    expect(data.recordDraft.refs).toBe('资料/参考/雨夜.png')

    data.editRecord()
    expect(data.editingRecord).toBe(true)
    data.setRecordField('status', 'accepted')
    data.setRecordField('tags', '雨夜，巷口')
    data.setRecordField('refs', '资料/参考/雨夜.png\n资料/参考/巷口.png')
    await data.saveRecord()
    expect(data.editingRecord).toBe(false)
    expect(data.record.revision).toBe(2)
    expect(data.record.meta).toEqual({ width: 1200 })
    expect(data.record.tags).toEqual(['雨夜', '巷口'])
    expect(data.record.refs).toEqual(['资料/参考/雨夜.png', '资料/参考/巷口.png'])
    expect(data.saveFeedback.status).toBe('saved')
    const saveCall = bridge.calls.filter((call) => call.tool === 'pinax_material_save').at(-1)
    expect(saveCall.args.expectedRevision).toBe(1)
    expect(saveCall.args.meta).toEqual({ width: 1200 })
  })

  it('新建→删除：新建按载体默认类型／状态起步，删除后当前态清空、树重列', async () => {
    const bridge = fakeBridge()
    const data = useBoardData(bridge)
    await data.loadRecords('material', { syncCurrent: false })

    await data.createRecord('material', '第二张参考图')
    expect(data.record.title).toBe('第二张参考图')
    expect(data.record.type).toBe('inspiration')
    expect(data.record.status).toBe('inbox')
    expect(data.record.revision).toBe(2)
    expect(data.recordSets.material.records).toHaveLength(2)

    await data.removeRecord()
    expect(data.record).toBeNull()
    expect(data.editingRecord).toBe(false)
    expect(data.recordSets.material.records).toHaveLength(1)
    expect(bridge.docs.material.revision).toBe(3)
  })

  it('并发冲突：盘上换了版，保存失败如实报 STALE 且留在编辑态，不静默合并', async () => {
    const bridge = fakeBridge()
    const data = useBoardData(bridge)
    await data.loadRecords('material', { syncCurrent: false })
    await data.openRecord('material', data.recordSets.material.records[0])
    data.editRecord()
    data.setRecordField('body', '作者改的一笔')
    bridge.docs.material.revision += 1

    await data.saveRecord()
    expect(data.editingRecord).toBe(true)
    expect(data.saveFeedback.status).toBe('error')
    expect(data.saveFeedback.code).toBe('PINAX_STALE_REVISION')
    expect(data.recordDraft.body).toBe('作者改的一笔')
  })

  it('项目事件：正在编辑这一栏时只重建树，草稿一个字不动；没载入过的记录树不开', async () => {
    const bridge = fakeBridge()
    const data = useBoardData(bridge)
    await data.loadRecords('material', { syncCurrent: false })
    await data.openRecord('material', data.recordSets.material.records[0])
    data.editRecord()
    data.setRecordField('body', '手上的草稿')
    bridge.docs.material.records[0].title = '外面改的标题'
    bridge.docs.material.revision += 1

    const targets = await data.refreshFromProjectEvent('entries-changed')
    expect(targets).toContain('records:material')
    expect(data.recordDraft.body).toBe('手上的草稿')
    expect(data.recordSets.material.revision).toBe(2, '树重列到新版修订号，但当前草稿没被重读')

    const untouched = useBoardData(fakeBridge())
    await untouched.refreshFromProjectEvent('entries-changed')
    expect(untouched.recordSets.comic.loaded).toBe(false, '没取过数的记录树，事件不替它打开')
  })
})

describe('记录型载体的索引窗（批次40）', () => {
  it('素材板挂上就列自己的记录树，点行打开当前记录，新建行按记录走', async () => {
    const bridge = fakeBridge()
    const data = useBoardData(bridge)
    const wrapper = mount(IndexWindow, {
      props: {
        board: { id: 'material.board', treePaneId: 'material.board', title: '素材', dataDirs: ['素材'] },
        data
      }
    })
    await flushPromises()
    expect(wrapper.find('.workspace-nav-section').text()).toBe('素材')
    const rows = wrapper.findAll('.nx-tree-item')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('雨夜参考图')
    expect(rows[0].attributes('title')).toContain('reference-image')

    await rows[0].trigger('click')
    await flushPromises()
    expect(data.record.id).toBe('material-1')
    expect(wrapper.findAll('.nx-tree-item.is-active')).toHaveLength(1)

    await wrapper.find('[data-test="index-new-toggle"]').trigger('click')
    const input = wrapper.find('[data-test="index-new-input"]')
    expect(input.exists()).toBe(true)
    await input.setValue('第二张参考图')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.findAll('.nx-tree-item')).toHaveLength(2)
    expect(data.record.title).toBe('第二张参考图')
    wrapper.unmount()
  })
})

describe('记录型载体的中栏（批次40）', () => {
  it('阅读态显示正文／标签／引用／meta 计数；编辑保存后修订号推进；删除要二次确认', async () => {
    const bridge = fakeBridge()
    const data = useBoardData(bridge)
    await data.loadRecords('material', { syncCurrent: false })
    await data.openRecord('material', data.recordSets.material.records[0])
    const wrapper = mount(CarrierPaneHost, {
      props: { pane: { id: 'material.editor', view: 'pinax.view.editor' }, data }
    })
    await flushPromises()
    expect(wrapper.find('.doc-title').text()).toBe('雨夜参考图')
    expect(wrapper.find('[aria-label="记录正文"]').text()).toContain('巷口一盏灯')
    expect(wrapper.text()).toContain('标签：雨夜')
    expect(wrapper.text()).toContain('引用：资料/参考/雨夜.png')
    expect(wrapper.text()).toContain('1 项载体私有字段')
    // 批次43：记录面的底部那行只留类型与状态——路径与版本号是开发者信息，不摆给作者看。
    expect(wrapper.find('.doc-meta-hint').text()).toBe('reference-image · inbox')
    expect(wrapper.find('.doc-meta-hint').text()).not.toContain('素材/素材.json')
    expect(wrapper.find('.doc-meta-hint').text()).not.toContain('第 1 版')

    await wrapper.find('.records-edit').trigger('click')
    await wrapper.find('[aria-label="记录标题"]').setValue('雨夜参考图（改）')
    await wrapper.find('[aria-label="记录状态"]').setValue('accepted')
    await wrapper.find('[aria-label="记录正文编辑器"]').setValue('巷口一盏灯，雨线斜着落。')
    await wrapper.find('.records-save').trigger('click')
    await flushPromises()
    expect(data.record.title).toBe('雨夜参考图（改）')
    expect(data.record.status).toBe('accepted')
    expect(data.record.revision).toBe(2)
    // 批次43：版本号不再摆在底部那行（它在保存 chip 与索引窗行的 title 里）。
    expect(wrapper.find('.doc-meta-hint').text()).not.toContain('第 2 版')

    await wrapper.find('.records-remove').trigger('click')
    expect(wrapper.find('.records-remove').text()).toBe('确认删除')
    await wrapper.find('.records-remove').trigger('click')
    await flushPromises()
    expect(data.record).toBeNull()
    expect(wrapper.text()).toContain('从左边索引窗里选一条素材')
    wrapper.unmount()
  })
})
