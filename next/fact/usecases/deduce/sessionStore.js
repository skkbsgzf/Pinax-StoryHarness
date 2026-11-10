/** 推演会话存储（M1-b）：事件溯源形态——不可变事件流（sessionId+seq 唯一）＋checkpoint（purpose＋stateHash）＋读档即分支。
 * ADR 5.2：拿形态（事件表/sequence 语义/checkpoint purpose/分支读档语义），持久实现留 Host（memory 适配器为测试/参照）。
 * 域规则层：本模块只做校验与编排，存储经注入的 store（默认 memorySessionStore）。 */
import { sha1Hex } from '../../domain/stableId.js'

export const SESSION_EVENT_TYPES = Object.freeze([
  'opening', 'round-begin', 'candidates', 'choice', 'settle', 'dice-trace',
  'director-veto', 'director-reroll', 'director-inject',
  'knowledge-delta', 'state-delta', 'hypothesis', 'checkpoint', 'session-end', 'custom'
])

export const CHECKPOINT_PURPOSES = Object.freeze([
  'opening', 'midpoint', 'prebranch', 'final', 'custom'
])

function str(v) { return String(v ?? '') }

/** 域校验：事件类型必须在枚举内（收敛形状，防事件类型发散——SF 200 种的教训）。 */
export function validateSessionEvent(event) {
  const type = str(event?.type)
  if (!SESSION_EVENT_TYPES.includes(type)) {
    return { ok: false, code: 'EVENT_TYPE_UNKNOWN', detail: type }
  }
  if (!Number.isSafeInteger(event?.seq) || event.seq < 1) {
    return { ok: false, code: 'SEQ_INVALID', detail: event?.seq }
  }
  return { ok: true }
}

export function stateHash(state) {
  return sha1Hex(JSON.stringify(state ?? null))
}

/** 创建会话存储 API（store＝注入的存储适配器；默认内存实现）。 */
export function createSessionStore({ store } = {}) {
  const mem = store ?? createMemorySessionStore()
  return {
    store: mem,
    /** 开局建会话：sessionId 签发（无父＝本源；有 lineage＝读档即分支）。 */
    create({ sessionId, pov, worldHash, lineage } = {}) {
      return mem.createSession({
        sessionId: str(sessionId) || sha1Hex(`session|${pov}|${worldHash}|${Date.now?.() ?? 0}|${Math.random()}`).slice(0, 16),
        pov: str(pov), worldHash: str(worldHash),
        lineage: lineage ?? null
      })
    },
    /** 追加事件：seq 单调唯一；类型必须在枚举内。 */
    appendEvent(sessionId, seq, event) {
      const check = validateSessionEvent({ ...event, seq })
      if (!check.ok) return { ok: false, code: check.code, detail: check.detail }
      return mem.appendEvent(str(sessionId), seq, { ...event, seq })
    },
    /** 读事件流（跨 lineage 解析：父会话 ≤atSeq 的事件视作本会话前缀）。 */
    listEvents(sessionId, { toSeq } = {}) {
      return mem.listEvents(str(sessionId), { toSeq })
    },
    /** checkpoint：purpose 必须在枚举；stateHash 校验（防篡改/半截状态）。 */
    checkpoint(sessionId, seq, purpose, state) {
      if (!CHECKPOINT_PURPOSES.includes(purpose)) {
        return { ok: false, code: 'PURPOSE_UNKNOWN', detail: purpose }
      }
      const hash = stateHash(state)
      return mem.appendEvent(str(sessionId), seq, {
        type: 'checkpoint', purpose, state, stateHash: hash
      })
    },
    /** 校验 checkpoint：重算 stateHash 比对。 */
    verifyCheckpoint(event) {
      if (event?.type !== 'checkpoint') return { ok: false, code: 'NOT_CHECKPOINT' }
      return stateHash(event.state) === event.stateHash
        ? { ok: true } : { ok: false, code: 'STATE_HASH_MISMATCH' }
    },
    /** 读档即分支：父会话 atSeq 处开子会话（可换 POV——多视角重演的地基）。 */
    branch(parentSessionId, atSeq, { newPov } = {}) {
      return mem.branchSession(str(parentSessionId), atSeq, { newPov: str(newPov ?? '') })
    },
    lineage(sessionId) {
      return mem.lineageOf(str(sessionId))
    },
    stateHash
  }
}

/** 内存参照实现（测试/对照；持久层留 Host）。 */
export function createMemorySessionStore() {
  const sessions = new Map() // sessionId -> {pov, worldHash, lineage:{parent,atSeq}|null, events:[{seq,event}], nextSeq}
  return {
    createSession({ sessionId, pov, worldHash, lineage }) {
      if (sessions.has(sessionId)) return { ok: false, code: 'SESSION_EXISTS', sessionId }
      const parent = lineage ? sessions.get(lineage.parent) : null
      if (lineage && !parent) return { ok: false, code: 'PARENT_NOT_FOUND', detail: lineage.parent }
      sessions.set(sessionId, { pov, worldHash, lineage: lineage ?? null, events: [], nextSeq: 1 })
      return { ok: true, sessionId }
    },
    appendEvent(sessionId, seq, event) {
      const s = sessions.get(sessionId)
      if (!s) return { ok: false, code: 'SESSION_NOT_FOUND' }
      if (s.events.some((row) => row.seq === seq)) return { ok: false, code: 'SEQ_DUPLICATE', detail: seq }
      s.events.push({ seq, event: { ...event, seq } })
      s.events.sort((a, b) => a.seq - b.seq)
      s.nextSeq = Math.max(s.nextSeq, seq + 1)
      return { ok: true, seq }
    },
    /** 解析 lineage 链（含多级）：返回 [ {sessionId, fromSeq, events≤atSeq}, …, 本会话全量 ]。 */
    resolveChain(sessionId) {
      const chain = []
      let cur = sessions.get(sessionId)
      let cursorId = sessionId
      let guard = 0
      while (cur && guard < 16) {
        chain.unshift({ sessionId: cursorId, events: cur.events })
        if (!cur.lineage) break
        cursorId = cur.lineage.parent
        cur = sessions.get(cursorId)
        guard += 1
      }
      if (chain.length === 0 || sessions.get(cursorId) === undefined) return null
      return chain
    },
    listEvents(sessionId, { toSeq } = {}) {
      const chain = this.resolveChain(sessionId)
      if (!chain) return { ok: false, code: 'SESSION_NOT_FOUND' }
      const s = sessions.get(sessionId)
      if (!s) return { ok: false, code: 'SESSION_NOT_FOUND' }
      // 逐级收集（父先）：lineage.atSeq 裁的是「父段」（子会话从父的第 atSeq 拍分出）；
      // 本段事件只受调用方 toSeq 裁剪。严禁把 cap 用在本段（那会把分支后事件全滤没）。
      const rows = []
      const collect = (id, cap) => {
        const node = sessions.get(id)
        if (!node) return
        if (node.lineage) collect(node.lineage.parent, node.lineage.atSeq)
        rows.push(...node.events.filter((row) => row.seq <= (cap ?? Infinity)))
      }
      collect(sessionId, toSeq ?? Infinity)
      rows.sort((a, b) => a.seq - b.seq)
      return { ok: true, events: rows.map((row) => row.event) }
    },
    branchSession(parentSessionId, atSeq, { newPov }) {
      const parent = sessions.get(parentSessionId)
      if (!parent) return { ok: false, code: 'PARENT_NOT_FOUND' }
      const bounded = parent.events.filter((row) => row.seq <= atSeq)
      if (bounded.length === 0) return { ok: false, code: 'AT_SEQ_EMPTY', detail: atSeq }
      const childId = `${parentSessionId}.b${atSeq}.${Math.floor(Math.random() * 1e6)}`
      const pov = newPov || parent.pov
      sessions.set(childId, {
        pov, worldHash: parent.worldHash,
        lineage: { parent: parentSessionId, atSeq },
        events: [], nextSeq: 1
      })
      return { ok: true, sessionId: childId, inheritedEvents: bounded.length, pov }
    },
    lineageOf(sessionId) {
      return sessions.get(sessionId)?.lineage ?? null
    },
    stats() {
      let events = 0
      for (const s of sessions.values()) events += s.events.length
      return { sessions: sessions.size, events }
    }
  }
}
