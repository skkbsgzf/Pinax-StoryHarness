import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAppPreferences, normalizePrefs, PREFS_DEFAULTS } from '../runtime/appPreferences.mjs'

/**
 * 应用级偏好存储（批次8①＋D1 历史间隔＋工单B 写作偏好）。三条合同：
 *   1) 字段只认 modelPlaneEndpoint / uiZoom / historyIntervalMinutes / writingFontSize / writingLineHeight，
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
    writingLineHeight: 1.9
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
