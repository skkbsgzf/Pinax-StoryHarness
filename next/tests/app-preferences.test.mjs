import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAppPreferences, normalizePrefs, PREFS_DEFAULTS } from '../runtime/appPreferences.mjs'

/**
 * 应用级偏好存储（批次8①＋D1 历史间隔）。三条合同：
 *   1) 字段只认 modelPlaneEndpoint / uiZoom / historyIntervalMinutes，值域在校验层挡住（写坏文件＝外壳起不来的事不能发生）；
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
  assert.deepEqual(reread.value, { modelPlaneEndpoint: 'http://127.0.0.1:8461', uiZoom: 0.9, historyIntervalMinutes: 5 })
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
