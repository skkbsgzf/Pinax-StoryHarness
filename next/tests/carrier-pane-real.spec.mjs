import { afterAll, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AppNext from '../shell/AppNext.vue'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'

/**
 * 真链路面板测试（M2 批次 1 的收口证据）。
 * carrier-pane.spec.mjs 用假工具信封核界面行为，这里一层都不 mock：
 *   渲染层 → IPC 分发器 → 运行时聚合面 → 载体工具 → 内核文件服务 → 磁盘。
 *
 * 内核走 createRequire 而不是 import：jsdom 环境里被 vite 转换的模块拿到的是
 * import.meta.url = http://localhost:3000/…，server/mcp/knowledgeIndex.js 顶层那句
 * fileURLToPath(new URL('../../', import.meta.url)) 会当场抛 ERR_INVALID_URL_SCHEME
 * （node 环境的 carrier-*.test.mjs 不会，因为只有 jsdom 走 web 解析链）。
 * 按绝对路径 require 这份内核＝整张图走 Node 原生 ESM，import.meta.url 回到 file:，
 * 路径常量恢复语义；跨边的只有通道名与错误码这些字符串常量，两边取值一致。
 *
 * 靶子目录在 os.tmpdir() 下，且 PINAX_APP_DATA／PINAX_MIRROR_ROOT 在加载内核之前就指好：
 * 真注册表、作者原稿、本机 3001/5173 服务一概不碰。
 */

const here = dirname(fileURLToPath(import.meta.url))
delete process.env.PINAX_PUBLIC_ORIGINS
const isolatedRoot = await mkdtemp(join(tmpdir(), 'pinax-next-realpane-'))
process.env.PINAX_APP_DATA = join(isolatedRoot, 'appdata')
process.env.PINAX_MIRROR_ROOT = join(isolatedRoot, 'mirror')
const { createNextSession, NOVEL_CARRIER_ID, SETTING_CARRIER_ID } = createRequire(import.meta.url)(resolve(here, '..', 'index.mjs'))
// 世界书载体的 id 从 carriers 清单直接取：next/index.mjs 的再导出名单不在本批改动面内。
import { WORLDBOOK_CARRIER_ID } from '../carriers/index.mjs'

const workspaces = []

/** 真链路要等磁盘：一个 flushPromises 只推平一层微任务，这里给到宏任务粒度。 */
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await flushPromises()
    await new Promise((resolveTick) => setTimeout(resolveTick, 0))
  }
}

function realBridge(session) {
  const dispatcher = createIpcDispatcher({ session })
  return { request: (channel, payload) => dispatcher.dispatch(channel, payload ?? {}) }
}

/**
 * settle() 的固定轮数在机器忙时不够（真磁盘 IO 的轮次不是常数，同一份用例在满载下会红、空载下会绿——
 * 那是假绿的一种，门禁不该靠运气）。等到断言条件真成立为止，超时才让用例失败。
 */
async function waitFor(predicate, { timeoutMs = 5000, note = '' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await settle(2)
    // 选择器还没挂上时 @vue/test-utils 的 .element/.text() 会直接抛，条件未成立和抛错在轮询里是同一回事。
    let ready = false
    try {
      ready = Boolean(predicate())
    } catch {
      ready = false
    }
    if (ready) return
    if (Date.now() > deadline) throw new Error(`等不到界面进入目标状态${note ? `：${note}` : ''}（${timeoutMs}ms 超时）`)
  }
}

async function makeProject(label) {
  const workspace = await mkdtemp(join(isolatedRoot, `p-${label}-`))
  workspaces.push(workspace)
  const root = join(workspace, '真链路靶子')
  const session = await createNextSession({ root, autoOpen: false })
  const created = await session.create({ name: '真链路靶子', primaryCarrier: NOVEL_CARRIER_ID, extraEnabled: [WORLDBOOK_CARRIER_ID, SETTING_CARRIER_ID] })
  expect(created.ok, JSON.stringify(created.error ?? {})).toBe(true)
  // 素材从文件系统侧落盘：这些是项目种子文件，不是面板写入（面板侧走载体的 save 工具）。
  await writeFile(join(root, '正文', '第001章-入场.md'), '雨从檐口滴下来，巷子里没人。', 'utf-8')
  await writeFile(join(root, '世界书', '人物·柯秒.md'), '---\nschemaVersion: 1\nid: kb-1\nname: 人物·柯秒\ntype: character\nkeys:\n  - 柯秒\n---\n\n冷穿越剧版主角，醒来在雪夜。', 'utf-8')
  await writeFile(join(root, '约束', '文风.md'), '短句为主，一拍一段。', 'utf-8')
  const opened = await session.open(root)
  expect(opened.ok, JSON.stringify(opened.error ?? {})).toBe(true)
  return { workspace, root, session }
}

afterAll(async () => {
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 })))
  await rm(isolatedRoot, { recursive: true, force: true, maxRetries: 3 })
})

describe('载体面板接真会话', () => {
  // 这一组每条都要真建项目、真读真磁盘（三个临时工程各起一次会话），整机负载高时会超过
  // vitest 默认的 5s 单测时限——那是机器忙，不是行为坏了，所以单测时限放到 30s，
  // 行为断言一条不减。空载时整组 0.9s 跑完。
  it('中栏从磁盘读出章节并载入正文；改一笔落盘，第二次的修订号为 2', async () => {
    const { root, session } = await makeProject('editor')
    const wrapper = mount(AppNext, { props: { bridge: realBridge(session) } })
    // 批次43：正文面默认是阅读态（md 渲染过的一篇文），要动它先按「编辑」。
    await waitFor(() => wrapper.find('[data-pane-id="novel.editor"]').exists() && wrapper.find('[data-test="chapter-rendered"]').exists(), { note: '正文面没从磁盘载入章节' })

    expect(wrapper.find('[data-pane-id="novel.editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="chapter-rendered"]').text()).toBe('雨从檐口滴下来，巷子里没人。')
    // 批次43：路径不再摆在文档面上（它在索引窗那一行的 title 上）。
    expect(wrapper.find('.nx-index-window .nx-tree-item').attributes('title')).toContain('第001章-入场.md')

    await wrapper.find('[data-test="chapter-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.editor-area').element.value).toBe('雨从檐口滴下来，巷子里没人。')
    await wrapper.find('.editor-area').setValue('雨从檐口滴下来，巷子里没人。柯秒在巷口站住。')
    // 工单H1：常驻保存按钮已移除，编辑器聚焦时按 Ctrl+S 保存；结果落在保存 chip 上。
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await waitFor(() => wrapper.find('.nx-save-chip').exists() && wrapper.find('.nx-save-chip').text().includes('已保存 · 第 2 版'), { note: '保存后 chip 没回到「第 2 版」' })

    expect(await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8')).toContain('柯秒在巷口站住')
    expect(wrapper.find('.nx-save-chip').text()).toContain('已保存 · 第 2 版')
    // 打开章节不再铺「已载入 N 字 · 第 N 版」的常驻 notice。
    expect(wrapper.find('.pane-notice').exists()).toBe(false)
    wrapper.unmount()
    await session.close()
  }, 30_000)

  it('世界书与设定各占一栏：世界书栏读出真条目，设定栏只列约束；内核那份也进不了别人的目录', async () => {
    const { root, session } = await makeProject('setting')
    const bridge = realBridge(session)
    const wrapper = mount(AppNext, { props: { bridge } })
    await waitFor(() => wrapper.find('.nx-ribbon-item[aria-label="世界书"]').exists(), { note: '图标竖条没有世界书板块入口' })

    // 协议 v1.1-A：世界书独立一栏。靶子目录里只有一条条目。
    // 批次44：条目行在核心区的看板区（上图表列、下详情），窄栏退成类别导航树。
    const board = wrapper.find('.nx-ribbon-item[aria-label="世界书"]')
    expect(board.exists(), '图标竖条应有世界书板块的入口').toBe(true)
    await board.trigger('click')
    await waitFor(() => wrapper.find('[data-pane-id="worldbook.entries"]').exists() && wrapper.findAll('[data-test="entries-board"] .nx-tree-item').length === 1 && wrapper.find('.entry-text').exists(), { note: '世界书面板没从磁盘读出条目' })

    expect(wrapper.find('[data-pane-id="worldbook.entries"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="entries-board"] .nx-tree-item')).toHaveLength(1)
    expect(wrapper.find('[data-test="entries-board"]').text()).toContain('人物·柯秒')
    expect(wrapper.find('.entry-text').text()).toContain('醒来在雪夜')

    // 设定栏（约束）：世界书条目不在这一栏，只有 约束/文风.md 一行；中栏是约束编辑面（点开才进）。
    const settingBoard = wrapper.find('.nx-ribbon-item[aria-label="设定"]')
    expect(settingBoard.exists(), '图标竖条应有设定板块的入口').toBe(true)
    await settingBoard.trigger('click')
    await waitFor(() => wrapper.find('[data-pane-id="setting.rules"]').exists() && wrapper.find('.nx-index-window').text().includes('文风'), { note: '设定栏没从磁盘读出约束' })
    expect(wrapper.findAll('.nx-index-window .nx-tree-item')).toHaveLength(1)
    expect(wrapper.find('.nx-index-window').text()).not.toContain('人物·柯秒')
    expect(wrapper.find('.entry-text').exists()).toBe(false)

    // 界面上没有任何写入通道：面板存在前后，世界书目录的文件清单一个字都没变。
    expect((await readdir(join(root, '世界书'))).join()).toBe('人物·柯秒.md')

    // 批次 1 时这里只能证到「内核那份按注册表找不到这个项目所以拒」。
    // 批次 2 起写族闸在聚合面上，两条更硬的证据：给 projectId 直接拒（Next 项目不在服务端注册表里），
    // 给了当前项目根也拒——「世界书/」的主人是只读板块，内核写不进去，磁盘一个字没变。
    const byId = await bridge.request(IPC_CHANNELS.runtimeToolCall, { tool: 'pinax_worldbook_write', args: { projectId: 'nope', name: '面板偷写', content: 'x' } })
    expect(byId.value.owner, 'pinax_worldbook_write 还没被任何载体认领，兜底的仍是内核那份').toBe('kernel')
    expect(byId.value.ok).toBe(false)
    expect(byId.value.payload.code).toBe('PINAX_INVALID_INPUT')
    expect(byId.value.payload.message).toContain('不接受 projectId')

    const byRoot = await bridge.request(IPC_CHANNELS.runtimeToolCall, { tool: 'pinax_worldbook_write', args: { projectPath: root, name: '面板偷写', content: 'x' } })
    expect(byRoot.value.ok).toBe(false)
    expect(byRoot.value.payload.code).toBe('PINAX_SCOPE_NOT_GRANTED')
    expect(byRoot.value.payload.message).toContain('世界书/ 的主人')

    const chapterWrite = await bridge.request(IPC_CHANNELS.runtimeToolCall, { tool: 'pinax_chapter_write', args: { projectPath: root, title: '第002章', text: '绕过修订号的一笔' } })
    expect(chapterWrite.value.ok).toBe(false)
    expect(chapterWrite.value.payload.code).toBe('PINAX_SCOPE_NOT_GRANTED')
    expect(chapterWrite.value.payload.message, '正文的主人是小说板块，写正文只能走它带修订号的 pinax_chapter_save').toContain('pinax_chapter_save')

    expect((await readdir(join(root, '世界书'))).join()).toBe('人物·柯秒.md')
    expect((await readdir(join(root, '正文'))).join()).toBe('第001章-入场.md')
    wrapper.unmount()
    await session.close()
  }, 30_000)

  it('运行时的问句在真链路上仍如实报缺：没注入 runner 的这条轨道不编回答', async () => {
    const { session } = await makeProject('ask')
    const bridge = realBridge(session)
    const answer = await bridge.request(IPC_CHANNELS.runtimeAsk, { question: '开场能不能再狠一点？' })
    expect(answer.ok).toBe(false)
    expect(answer.error.code).toBe('PINAX_DEPENDENCY_UNMET')
    expect(answer.error.message).toContain('未接模型运行器')
    await session.close()
  }, 30_000)
})
