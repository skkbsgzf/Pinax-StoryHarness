import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAppPreferences, mergeRecentProject, normalizePrefs, PREFS_DEFAULTS, RECENT_PROJECTS_LIMIT } from '../runtime/appPreferences.mjs'

/**
 * 应用级偏好存储（批次8①＋D1 历史间隔＋工单B 写作偏好）。三条合同：
 *   1) 字段只认 modelPlaneEndpoint / uiZoom / historyIntervalMinutes / writingFontSize / writingLineHeight /
 *      writingParagraphSpacing / writingTextIndent / writingTypewriter / writingFocusMode / serviceNoticesAckedAt，
 *      值域在校验层挡住（写坏文件＝外壳起不来的事不能发生）；
 *   2) 文件损坏/缺失按默认值继续，不崩；
 *   3) 写入是原子的（复用 fs/atomicWrite），落盘内容可被下一次 read 读回。
 */

test('默认值：文件不存在时读出全部默认，不建文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  const prefs = createAppPreferences({ file })
  const result = await prefs.read()
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, PREFS_DEFAULTS)
  await assert.rejects(() => readFile(file), 'read() 不该凭空建文件')
  await rm(dir, { recursive: true, force: true })
})

test('写入往返：合法端点与缩放落盘并可读回；尾部斜杠归一', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'nested', 'next-preferences.json')
  const prefs = createAppPreferences({ file })
  const written = await prefs.write({ modelPlaneEndpoint: 'http://127.0.0.1:8461/', uiZoom: 0.9 })
  assert.equal(written.ok, true)
  assert.equal(written.value.modelPlaneEndpoint, 'http://127.0.0.1:8461')
  assert.equal(written.value.uiZoom, 0.9)
  const reread = await createAppPreferences({ file }).read()
  assert.deepEqual(reread.value, {
    modelPlaneEndpoint: 'http://127.0.0.1:8461',
    uiZoom: 0.9,
    historyIntervalMinutes: 5,
    // 工单B：写作偏好未写时按默认值补全（17／1.9）。
    writingFontSize: 17,
    writingLineHeight: 1.9,
    // 批次46B：排版偏好与行为开关同样按默认补全（0.8em／2em／关／关）。
    writingParagraphSpacing: 0.8,
    writingTextIndent: 2,
    writingTypewriter: false,
    writingFocusMode: false,
    // 批次49：「服务与通知」确认水位（应用级；没确认过＝null）。
    serviceNoticesAckedAt: null,
    // 最近打开的项目（作者 2026-11-10 点单）：没记过＝空清单。
    recentProjects: []
  })
  const onDisk = JSON.parse(await readFile(file, 'utf-8'))
  assert.equal(onDisk.modelPlaneEndpoint, 'http://127.0.0.1:8461')
  await rm(dir, { recursive: true, force: true })
})

test('值域拒绝：坏端点、越界缩放都被打回且不落盘', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  const prefs = createAppPreferences({ file })
  for (const patch of [{ modelPlaneEndpoint: 'ftp://x' }, { modelPlaneEndpoint: 42 }, { uiZoom: 0.1 }, { uiZoom: 5 }, { uiZoom: '大' }]) {
    const result = await prefs.write(patch)
    assert.equal(result.ok, false, `应拒绝 ${JSON.stringify(patch)}`)
    assert.match(String(result.error?.message), /必须|之间/)
  }
  const result = await prefs.read()
  assert.deepEqual(result.value, PREFS_DEFAULTS, '被拒绝的写入不得污染已存偏好')
  await rm(dir, { recursive: true, force: true })
})

test('损坏文件按默认值继续：外壳不因偏好坏而起不来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  await writeFile(file, '{ 这不是 JSON', 'utf-8')
  const result = await createAppPreferences({ file }).read()
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, PREFS_DEFAULTS)
  await rm(dir, { recursive: true, force: true })
})

test('normalizePrefs：null/空串端点＝用默认；缩放空值回 null；非对象输入按空补全', () => {
  assert.deepEqual(normalizePrefs({ modelPlaneEndpoint: '', uiZoom: '' }).value, PREFS_DEFAULTS)
  assert.deepEqual(normalizePrefs({ modelPlaneEndpoint: null, uiZoom: null }).value, PREFS_DEFAULTS)
  assert.equal(normalizePrefs({ modelPlaneEndpoint: 'https://plane.example' }).value.modelPlaneEndpoint, 'https://plane.example')
  assert.deepEqual(normalizePrefs('not-an-object').value, PREFS_DEFAULTS, '非对象输入不抛错——损坏偏好按默认值继续')
})

test('历史间隔（D1）：默认 5、0–120 整数合法且可往返；越界/小数/非数字拒绝', async () => {
  assert.equal(PREFS_DEFAULTS.historyIntervalMinutes, 5)
  assert.equal(normalizePrefs({}).value.historyIntervalMinutes, 5)
  assert.equal(normalizePrefs({ historyIntervalMinutes: null }).value.historyIntervalMinutes, 5)
  assert.equal(normalizePrefs({ historyIntervalMinutes: '' }).value.historyIntervalMinutes, 5)
  for (const minutes of [0, 1, 120]) {
    assert.equal(normalizePrefs({ historyIntervalMinutes: minutes }).value.historyIntervalMinutes, minutes, `应接受 ${minutes}`)
  }
  for (const bad of [-1, 121, 1.5, '大', true]) {
    assert.equal(normalizePrefs({ historyIntervalMinutes: bad }).ok, false, `应拒绝 ${JSON.stringify(bad)}`)
  }

  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  try {
    const prefs = createAppPreferences({ file })
    const written = await prefs.write({ historyIntervalMinutes: 0 })
    assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
    assert.equal(written.value.historyIntervalMinutes, 0, '0＝关闭定时快照，必须能存')
    // 只改端点时不得把已存的历史间隔重置回默认（patch 合并语义）。
    const again = await prefs.write({ modelPlaneEndpoint: 'http://127.0.0.1:8461' })
    assert.equal(again.value.historyIntervalMinutes, 0)
    const onDisk = JSON.parse(await readFile(file, 'utf-8'))
    assert.equal(onDisk.historyIntervalMinutes, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('写作偏好（工单B）：字号 14–22 整数、行高 1.6–2.4 步进 0.05，默认 17／1.9，可往返', async () => {
  // 默认值：与 next-shell.css 的 .editor-area var() 回退值同一档（17＝--nx-fs-lg、1.9）。
  assert.equal(PREFS_DEFAULTS.writingFontSize, 17)
  assert.equal(PREFS_DEFAULTS.writingLineHeight, 1.9)
  assert.equal(normalizePrefs({}).value.writingFontSize, 17)
  assert.equal(normalizePrefs({}).value.writingLineHeight, 1.9)
  // null／空串＝回默认（与历史间隔同一口径），不是「不改」。
  assert.equal(normalizePrefs({ writingFontSize: null, writingLineHeight: '' }).value.writingFontSize, 17)
  assert.equal(normalizePrefs({ writingFontSize: null, writingLineHeight: '' }).value.writingLineHeight, 1.9)

  // 字号：14／17／22 合法；13／23／小数／非数字一律拒。
  for (const size of [14, 17, 22, '18']) {
    assert.equal(normalizePrefs({ writingFontSize: size }).value.writingFontSize, Number(size), `应接受字号 ${size}`)
  }
  for (const bad of [13, 23, 16.5, '大', true]) {
    assert.equal(normalizePrefs({ writingFontSize: bad }).ok, false, `应拒绝字号 ${JSON.stringify(bad)}`)
  }

  // 行高：1.6／1.75／1.9／2.4 合法；越界与非 0.05 步进一律拒。
  for (const height of [1.6, 1.75, 1.9, 2.4, '2.05']) {
    assert.equal(normalizePrefs({ writingLineHeight: height }).value.writingLineHeight, Number(height), `应接受行高 ${height}`)
  }
  for (const bad of [1.59, 2.41, 1.91, 1.62, '大', true]) {
    assert.equal(normalizePrefs({ writingLineHeight: bad }).ok, false, `应拒绝行高 ${JSON.stringify(bad)}`)
  }
  // 浮点尾巴按步进取整（1.9000000000000001 与 1.9 是同一档），但存回的是干净两位小数。
  assert.equal(normalizePrefs({ writingLineHeight: 1.9000000000000001 }).value.writingLineHeight, 1.9)

  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  try {
    const prefs = createAppPreferences({ file })
    const written = await prefs.write({ writingFontSize: 20, writingLineHeight: 2.05 })
    assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
    assert.equal(written.value.writingFontSize, 20)
    assert.equal(written.value.writingLineHeight, 2.05)
    // patch 语义：只写写作偏好不得把端点/缩放/历史间隔重置。
    assert.equal(written.value.modelPlaneEndpoint, null)
    assert.equal(written.value.historyIntervalMinutes, 5)
    const reread = await createAppPreferences({ file }).read()
    assert.equal(reread.value.writingFontSize, 20)
    assert.equal(reread.value.writingLineHeight, 2.05)
    const onDisk = JSON.parse(await readFile(file, 'utf-8'))
    assert.equal(onDisk.writingFontSize, 20)
    assert.equal(onDisk.writingLineHeight, 2.05)

    // 越界写入被拒且不污染已存值。
    const rejected = await prefs.write({ writingFontSize: 40 })
    assert.equal(rejected.ok, false)
    assert.match(String(rejected.error?.message), /14–22/)
    assert.equal((await prefs.read()).value.writingFontSize, 20)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('排版偏好（批次46B）：段距 0–2 步进 0.1、缩进 0–2 步进 0.5、两个开关是布尔，可往返', async () => {
  assert.equal(PREFS_DEFAULTS.writingParagraphSpacing, 0.8)
  assert.equal(PREFS_DEFAULTS.writingTextIndent, 2)
  assert.equal(PREFS_DEFAULTS.writingTypewriter, false)
  assert.equal(PREFS_DEFAULTS.writingFocusMode, false)
  // null／空串＝回默认（与字号／行高同一口径）。
  const empty = normalizePrefs({ writingParagraphSpacing: null, writingTextIndent: '', writingTypewriter: null, writingFocusMode: '' })
  assert.equal(empty.ok, true)
  assert.deepEqual(
    { spacing: empty.value.writingParagraphSpacing, indent: empty.value.writingTextIndent, typewriter: empty.value.writingTypewriter, focus: empty.value.writingFocusMode },
    { spacing: 0.8, indent: 2, typewriter: false, focus: false }
  )

  // 段距：0／0.8／1.5／2 合法（步进 0.1）；越界与非步进值一律拒。
  for (const spacing of [0, 0.8, 1.5, 2, '1.2']) {
    assert.equal(normalizePrefs({ writingParagraphSpacing: spacing }).value.writingParagraphSpacing, Number(spacing), `应接受段距 ${spacing}`)
  }
  for (const bad of [-0.1, 2.1, 0.85, '大', true]) {
    assert.equal(normalizePrefs({ writingParagraphSpacing: bad }).ok, false, `应拒绝段距 ${JSON.stringify(bad)}`)
  }
  // 缩进：0／0.5／1.5／2 合法（步进 0.5，0＝不缩进）；越界与非步进值一律拒。
  for (const indent of [0, 0.5, 1.5, 2, '1']) {
    assert.equal(normalizePrefs({ writingTextIndent: indent }).value.writingTextIndent, Number(indent), `应接受缩进 ${indent}`)
  }
  for (const bad of [-0.5, 2.5, 0.3, '大', true]) {
    assert.equal(normalizePrefs({ writingTextIndent: bad }).ok, false, `应拒绝缩进 ${JSON.stringify(bad)}`)
  }
  // 开关只收布尔：字符串和数字都不算（避免 'false' 被当真）。
  for (const field of ['writingTypewriter', 'writingFocusMode']) {
    assert.equal(normalizePrefs({ [field]: true }).value[field], true)
    assert.equal(normalizePrefs({ [field]: false }).value[field], false)
    for (const bad of ['true', 'false', 1, 0]) {
      assert.equal(normalizePrefs({ [field]: bad }).ok, false, `${field} 应拒绝 ${JSON.stringify(bad)}`)
    }
  }

  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  try {
    const prefs = createAppPreferences({ file })
    const written = await prefs.write({
      writingParagraphSpacing: 1.4,
      writingTextIndent: 0,
      writingTypewriter: true,
      writingFocusMode: true
    })
    assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
    assert.equal(written.value.writingParagraphSpacing, 1.4)
    assert.equal(written.value.writingTextIndent, 0)
    assert.equal(written.value.writingTypewriter, true)
    assert.equal(written.value.writingFocusMode, true)
    // patch 语义：没写到的字号／行高仍是默认值。
    assert.equal(written.value.writingFontSize, 17)
    assert.equal(written.value.writingLineHeight, 1.9)

    const reread = await createAppPreferences({ file }).read()
    assert.equal(reread.value.writingParagraphSpacing, 1.4)
    assert.equal(reread.value.writingTextIndent, 0)
    assert.equal(reread.value.writingTypewriter, true)
    assert.equal(reread.value.writingFocusMode, true)
    const onDisk = JSON.parse(await readFile(file, 'utf-8'))
    assert.equal(onDisk.writingParagraphSpacing, 1.4)
    assert.equal(onDisk.writingTextIndent, 0)
    assert.equal(onDisk.writingTypewriter, true)
    assert.equal(onDisk.writingFocusMode, true)

    // 越界写入被拒且不污染已存值。
    const rejected = await prefs.write({ writingParagraphSpacing: 3 })
    assert.equal(rejected.ok, false)
    assert.equal((await prefs.read()).value.writingParagraphSpacing, 1.4)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('最近打开的项目（作者 2026-11-10 点单）：合法清单往返、去重置顶、超限截断', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  const prefs = createAppPreferences({ file })
  try {
    // 记两笔：新的在前；同名目录去重（重新打开＝置顶，不是第二条）。
    const first = await prefs.write({ recentProjects: mergeRecentProject([], { path: 'D:/books/旧稿', name: '旧稿', at: '2026-11-09T10:00:00.000Z' }) })
    assert.equal(first.ok, true)
    const second = await prefs.write({ recentProjects: mergeRecentProject(first.value.recentProjects, { path: 'D:/Projects/大梦', name: '大梦', at: '2026-11-10T09:00:00.000Z' }) })
    assert.equal(second.ok, true)
    const again = await prefs.write({ recentProjects: mergeRecentProject(second.value.recentProjects, { path: 'D:/books/旧稿', name: '旧稿', at: '2026-11-10T10:00:00.000Z' }) })
    assert.equal(again.ok, true)
    assert.deepEqual(again.value.recentProjects.map((entry) => entry.path), ['D:/books/旧稿', 'D:/Projects/大梦'], '重新打开的置顶，不重复')
    assert.equal(again.value.recentProjects[0].at, '2026-11-10T10:00:00.000Z')

    // 落盘可读回（新实例、无缓存）。
    const reread = await createAppPreferences({ file }).read()
    assert.deepEqual(reread.value.recentProjects, again.value.recentProjects)

    // 超限丢尾部；mergeRecentProject 是纯函数，不改传入清单。
    let list = again.value.recentProjects
    const before = JSON.stringify(list)
    for (let index = 0; index < RECENT_PROJECTS_LIMIT + 3; index++) {
      list = mergeRecentProject(list, { path: `D:/books/书${index}`, at: '2026-11-10T00:00:00.000Z' })
    }
    assert.equal(list.length, RECENT_PROJECTS_LIMIT, `清单封顶 ${RECENT_PROJECTS_LIMIT} 条`)
    assert.equal(list[0].path, `D:/books/书${RECENT_PROJECTS_LIMIT + 2}`)
    assert.equal(JSON.stringify(again.value.recentProjects), before, 'mergeRecentProject 不改传入清单')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('recentProjects 值域：非数组拒绝；坏条目丢弃不整体打回；清空是合法写入', () => {
  const bad = normalizePrefs({ recentProjects: 'D:/books' })
  assert.equal(bad.ok, false, '非数组必须整体拒绝（这是类型错误，不是脏数据）')
  assert.match(bad.error, /recentProjects/)

  const messy = normalizePrefs({ recentProjects: [
    '字符串条目',
    { name: '没路径的不要' },
    { path: '  D:/books/大梦  ', name: ' 大梦 ', at: '不是时间' },
    { path: 'D:/books/大梦', name: '重复路径以先出现为准' },
    { path: 'D:/books/空名', name: '   ', at: '2026-11-10T00:00:00.000Z' }
  ] })
  assert.equal(messy.ok, true)
  // 翻案依据（工单 P1-2）：条目新增可选 count/countAt；旧记录两格归一为 null（不是缺键）。
  assert.deepEqual(messy.value.recentProjects, [
    { path: 'D:/books/大梦', name: '大梦', kind: null, at: null, count: null, countAt: null },
    { path: 'D:/books/空名', name: null, kind: null, at: '2026-11-10T00:00:00.000Z', count: null, countAt: null }
  ], '坏条目丢、好条目归一（trim 路径与名、坏时间戳置 null、kind 可选透传）')

  const cleared = normalizePrefs({ recentProjects: [] })
  assert.deepEqual(cleared.value.recentProjects, [], '空数组＝清空，合法')
})

test('篇数（工单 P1-2）：count/countAt 往返；旧记录缺字段归一为 null；坏值不显示错数', async () => {
  const normalized = normalizePrefs({ recentProjects: [
    { path: 'D:/books/大梦', name: '大梦', kind: 'novel', at: '2026-11-10T00:00:00.000Z', count: 12, countAt: '2026-11-11T00:00:00.000Z' },
    { path: 'D:/books/旧稿', count: '十二', countAt: '不是时间' },
    { path: 'D:/books/负一篇', count: -1, countAt: '2026-11-11T00:00:00.000Z' }
  ] })
  assert.equal(normalized.ok, true)
  assert.deepEqual(normalized.value.recentProjects[0], {
    path: 'D:/books/大梦', name: '大梦', kind: 'novel', at: '2026-11-10T00:00:00.000Z', count: 12, countAt: '2026-11-11T00:00:00.000Z'
  }, '合法篇数与统计时刻原样保留')
  assert.equal(normalized.value.recentProjects[1].count, null, '非整数篇数丢弃')
  assert.equal(normalized.value.recentProjects[1].countAt, null)
  assert.equal(normalized.value.recentProjects[2].count, null, '负数篇数丢弃（卡片只显示时间）')

  const merged = mergeRecentProject([], { path: 'D:/books/夜航', kind: 'script', at: '2026-11-11T00:00:00.000Z', count: 9, countAt: '2026-11-11T00:00:00.000Z' })
  assert.equal(merged[0].count, 9)
  assert.equal(merged[0].countAt, '2026-11-11T00:00:00.000Z')

  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-'))
  const file = join(dir, 'next-preferences.json')
  try {
    const prefs = createAppPreferences({ file })
    const written = await prefs.write({ recentProjects: merged })
    assert.equal(written.ok, true)
    const reread = await createAppPreferences({ file }).read()
    assert.equal(reread.value.recentProjects[0].count, 9, '落盘后可读回')
    assert.equal(reread.value.recentProjects[0].countAt, '2026-11-11T00:00:00.000Z')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
