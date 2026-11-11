/**
 * 相对时间（库管理器工单 A-3）：今天 / 昨天 / N 天前 / 上周 / 具体日期。
 * 纯函数、可测；无效输入如实返回空串，不编一个「刚刚」。
 * 分档（工单文字钉死）：
 *   同一天 → 今天；相差 1 天 → 昨天；2–6 天 → 「N 天前」；7–13 天 → 上周；≥14 天 → 具体日期。
 * 具体日期：同年「M月D日」，跨年「YYYY年M月D日」。
 */
export function relativeTime(iso, now = new Date()) {
  if (!iso) return ''
  const then = new Date(String(iso))
  if (Number.isNaN(then.getTime())) return ''
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(then).getTime()) / 86400000)
  if (dayDiff < 0) return formatAbsolute(then, now)
  if (dayDiff === 0) return '今天'
  if (dayDiff === 1) return '昨天'
  if (dayDiff <= 6) return `${dayDiff} 天前`
  if (dayDiff <= 13) return '上周'
  return formatAbsolute(then, now)
}

function formatAbsolute(then, now) {
  const sameYear = then.getFullYear() === now.getFullYear()
  const year = sameYear ? '' : `${then.getFullYear()}年`
  return `${year}${then.getMonth() + 1}月${then.getDate()}日`
}
