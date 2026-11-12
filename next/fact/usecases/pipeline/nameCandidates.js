/**
 * 名字候选挖掘：从全文里找「像人名」的高频串，作为 who 的白名单种子。
 *
 * 为什么需要：模型会把句子片段当 who（「正好沈逸」「连忙帮余」「头疼地揉」），
 * 而这些片段在原文里当然"有证据"——因为它们是原文的一部分。所以「原文出现」不能当判据。
 *
 * 可用的信号是**分布形态**：
 *   · 真名：在全书里高频、且后面常跟说话/动作动词（余欢 795 次 / 后接动词 39 次）；
 *   · 句子片段：低频、形态上含虚词或动词（「连忙帮余」含「连忙」）。
 *
 * 本模块只做确定性统计，不调模型。
 */

/** 名字里几乎不会出现的字：虚词、代词、高频动词/副词。 */
const FORBIDDEN = /[的了着过是在把被让我你他她它们想要去来说道问看走坐站笑叹知能会可别没不就都也又而但和与同对这那哪什怎为因为所以如果虽然已经连忙赶紧赶快立刻立即马上顿时终于果然竟然仿佛似乎好像鬼使神差正好其实只是还是一边嘴里恢复借口类似频频小声]/u

/**
 * 串尾禁字：名字不会以动词/副词/代词结尾。
 * 这条专治「林逸直接」「余欢发完」「沈逸林只」——全串都在原文出现多次，靠 mention 计数拦不住。
 */
const BAD_TAIL = /[直接续然后着了过来去说道问看走坐站笑叹知能会可别没不就都也又而但与同对这那哪什怎为因所欲将把被让给和在了得地化么些每各本若干无非未甭勿莫]$/u

/** 常见姓氏（含复姓）——名字的首字若命中，可信度显著提高。 */
const SURNAMES = new Set([
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨',
  '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜',
  '戚', '谢', '邹', '喻', '柏', '水', '窦', '章', '云', '苏', '潘', '葛', '奚', '范', '彭', '郎',
  '鲁', '韦', '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳', '酆', '鲍', '史', '唐',
  '费', '廉', '岑', '薛', '雷', '贺', '倪', '汤', '滕', '殷', '罗', '毕', '郝', '邬', '安', '常',
  '乐', '于', '时', '傅', '皮', '卞', '齐', '康', '伍', '余', '元', '卜', '顾', '孟', '平', '黄',
  '和', '穆', '萧', '尹', '姚', '邵', '湛', '汪', '祁', '毛', '禹', '狄', '米', '贝', '明', '臧',
  '计', '伏', '成', '戴', '谈', '宋', '茅', '庞', '熊', '纪', '舒', '屈', '项', '祝', '董', '梁',
  '杜', '阮', '蓝', '闵', '席', '季', '麻', '强', '贾', '路', '娄', '危', '江', '童', '颜', '郭',
  '梅', '盛', '林', '刁', '钟', '徐', '邱', '骆', '高', '夏', '蔡', '田', '樊', '胡', '凌', '霍',
  '虞', '万', '支', '柯', '咎', '管', '卢', '莫', '经', '房', '裘', '缪', '干', '解', '应', '宗',
  '丁', '宣', '贲', '邓', '郁', '单', '杭', '洪', '包', '诸', '左', '石', '崔', '吉', '钮', '龚',
  '程', '嵇', '邢', '滑', '裴', '陆', '荣', '翁', '荀', '羊', '甄', '曲', '家', '封', '芮', '羿',
  '储', '靳', '汲', '邴', '糜', '松', '井', '段', '富', '巫', '乌', '焦', '巴', '弓', '牧', '隗',
  '山', '谷', '车', '侯', '宓', '蓬', '全', '郗', '班', '仰', '秋', '仲', '伊', '宫', '宁', '仇',
  '栾', '暴', '甘', '钭', '厉', '戎', '祖', '武', '符', '刘', '景', '詹', '束', '龙', '叶', '幸',
  '司', '韶', '郜', '黎', '蓟', '薄', '印', '宿', '白', '怀', '蒲', '邰', '从', '鄂', '索', '咸',
  '籍', '赖', '卓', '蔺', '屠', '蒙', '池', '乔', '阴', '郁', '胥', '能', '苍', '双', '闻', '莘',
  '党', '翟', '谭', '贡', '劳', '逄', '姬', '申', '扶', '堵', '冉', '宰', '郦', '雍', '却', '璩',
  '桑', '桂', '濮', '牛', '寿', '通', '边', '扈', '燕', '冀', '郏', '浦', '尚', '农', '温', '别',
  '庄', '晏', '柴', '瞿', '阎', '充', '慕', '连', '茹', '习', '宦', '艾', '鱼', '容', '向', '古',
  '易', '慎', '戈', '廖', '庾', '终', '暨', '居', '衡', '步', '都', '耿', '满', '弘', '匡', '国',
  '文', '寇', '广', '禄', '阙', '东', '欧', '殳', '沃', '利', '蔚', '越', '夔', '隆', '师', '巩',
  '厍', '聂', '晁', '勾', '敖', '融', '冷', '訾', '辛', '阚', '那', '简', '饶', '空', '曾', '毋',
  '沙', '乜', '养', '鞠', '须', '丰', '巢', '关', '蒯', '相', '查', '后', '荆', '红', '游', '竺',
  '权', '逯', '盖', '益', '桓', '公', '欧阳', '太史', '端木', '上官', '司马', '东方', '独孤', '南宫',
  '万俟', '闻人', '夏侯', '诸葛', '尉迟', '公羊', '赫连', '澹台', '皇甫', '宗政', '濮阳', '公冶',
  '太叔', '申屠', '公孙', '慕容', '仲孙', '钟离', '长孙', '宇文', '司徒', '鲜于', '司空', '闾丘',
  '子车', '亓官', '司寇', '巫马', '公西', '颛孙', '壤驷', '公良', '漆雕', '乐正', '宰父', '谷梁',
  '拓跋', '夹谷', '轩辕', '令狐', '段干', '百里', '呼延', '东郭', '南门', '羊舌', '微生', '梁丘',
  '左丘', '东门', '西门', '南荣', '第五'
])

const isCjk = (ch) => /[\u4e00-\u9fa5]/u.test(ch)

/**
 * 统计全文的 2–4 字候选串及其形态证据。
 * @returns {Map<string, {mentions:number, withCue:number, surname:boolean}>}
 */
export function collectNameCandidates(text) {
  const source = String(text ?? '')
  const stats = new Map()
  // 只统计「行首 / 标点后 / 引号前」的位置，降低把句中片段当候选的概率
  const boundaries = /[^。！？；\n“”「」『』（）()…—]{0,40}/gu
  // 英文名（含中英混排的小说）：独立词、首字母大写、长度 2–20。
  for (const match of source.matchAll(/\b[A-Z][A-Za-z]{1,19}\b/gu)) {
    const word = match[0]
    const record = stats.get(word) ?? { mentions: 0, withCue: 0, surname: false }
    record.mentions += 1
    const after = source.slice(match.index + word.length, match.index + word.length + 4)
    if (/^(说|道|问|答|喊|叫|笑|叹|皱眉|抬头|低头|点头|摇头|转身|看向|望着|开口)/u.test(after)) record.withCue += 1
    stats.set(word, record)
  }
  for (const chunk of source.match(boundaries) ?? []) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    for (let length = 4; length >= 2; length -= 1) {
      for (let start = 0; start + length <= trimmed.length; start += 1) {
        const candidate = trimmed.slice(start, start + length)
        if (![...candidate].every(isCjk)) continue
        if (FORBIDDEN.test(candidate)) continue
        const after = trimmed.slice(start + length, start + length + 3)
        const record = stats.get(candidate) ?? { mentions: 0, withCue: 0, surname: false }
        record.mentions += 1
        if (/^(说|道|问|答|喊|叫|笑|叹|皱眉|抬头|低头|点头|摇头|转身|看向|望着|开口)/u.test(after)) record.withCue += 1
        record.surname = [...candidate].some((ch, index) => index <= 1 && SURNAMES.has(ch))
        stats.set(candidate, record)
      }
    }
  }
  return stats
}

/**
 * 判定一个 who 是否是「全书范围内像人名」的串。
 * 判据（全部确定性）：
 *   1) 形态：无虚词/动词/副词（FORBIDDEN）；
 *   2) 长度 2–5；
 *   3) 全书出现 ≥2 次，**或**首字是常见姓氏且出现 ≥1 次；
 *   4) 含说话/动作共现（withCue ≥1）**或**首字是姓氏。
 * @returns {{ok:boolean, reason:string}}
 */
export function isLikelyPersonName(name, candidateStats) {
  const value = String(name ?? '').trim()
  if (!value) return { ok: false, reason: 'empty', name: value }
  if (value.length < 2 || value.length > 5) return { ok: false, reason: 'length', name: value }
  if (FORBIDDEN.test(value)) {
    // 名尾粘连（「林逸直接」）：先试截断——若前缀是强候选名，认前缀。
    const trimmed = trimToStrongPrefix(value, candidateStats)
    if (trimmed) return { ok: true, reason: 'trimmed', name: trimmed }
    return { ok: false, reason: 'stop-char', name: value }
  }
  // 串尾禁字：同样先试截断前缀（「林逸直接」→「林逸」）。
  if (BAD_TAIL.test(value)) {
    const trimmed = trimToStrongPrefix(value, candidateStats)
    if (trimmed) return { ok: true, reason: 'trimmed', name: trimmed }
    return { ok: false, reason: 'bad-tail', name: value }
  }
  const record = candidateStats?.get(value)
  if (!record) return { ok: false, reason: 'not-in-text', name: value }
  if (record.mentions < 2 && !record.surname) return { ok: false, reason: 'rare', name: value }
  if (record.withCue < 1 && !record.surname) return { ok: false, reason: 'no-cue', name: value }
  // 前缀压制：「林逸拍」自己可能也出现几次（原文「林逸拍桌」重复），但「林逸」出现 78 次。
  // 有显著更强的短前缀时认前缀——这是最后一道，放在所有形态检查之后。
  const dominant = strongestPrefix(value, candidateStats)
  if (dominant) return { ok: true, reason: 'dominant-prefix', name: dominant }
  return { ok: true, reason: record.surname ? 'surname' : 'cue', name: value }
}

/**
 * 名尾粘连修正：「林逸直接」「沈逸林只」这类是「名字＋动词/副词首字」。
 * 只有当截断后的前缀**在全书统计里出现 ≥5 次**时才认（避免把「欧阳」截成「欧」）。
 * @returns {string|null} 修正后的名字；不必修正返回 null
 */
export function trimToStrongPrefix(value, candidateStats) {
  if (!candidateStats) return null
  for (let cut = value.length - 1; cut >= 2; cut -= 1) {
    const prefix = value.slice(0, cut)
    if (FORBIDDEN.test(prefix)) continue
    const record = candidateStats.get(prefix)
    // 阈值 3 次：真名在全书通常远高于此；粘连尾巴（动词/副词）成串后反而低频。
    // 优先返回**更长**的前缀（先试 value.length-1），所以顺序上更长的 prefix 先命中。
    if (record && record.mentions >= 3) return prefix
  }
  return null
}

/**
 * 最强前缀：存在一个更短的前缀，其出现次数 ≥ 当前串的 5 倍且 ≥10 次，则返回它。
 * 这是「林逸拍」与「林逸」的分界线——真名不会被它的子串压过。
 * @returns {string|null}
 */
export function strongestPrefix(value, candidateStats) {
  if (!candidateStats) return null
  const own = candidateStats.get(value)
  if (!own) return null
  for (let cut = value.length - 1; cut >= 2; cut -= 1) {
    const prefix = value.slice(0, cut)
    const record = candidateStats.get(prefix)
    if (!record) continue
    if (record.mentions >= 10 && record.mentions >= own.mentions * 5) return prefix
  }
  return null
}

export const NAME_CANDIDATE_FORBIDDEN = FORBIDDEN
