/* 世界书数据面板 SPA v4（作者 2026-11-13 裁定：接入 OpenDesign 接口，用高级图表）。
 * 运行环境：单文件 HTML 内嵌，全局依赖 DETAIL（build-wiki.mjs 注入，含 ds.palette）。
 * 图表全部为内嵌 SVG（dashboard skill 约定：inline SVG only, no JS libraries）：
 *   平滑面积图＋移动均线 / 环形图 / 雷达图 / 人物×章热力图 / 堆叠条 / 横条榜 / 力导向关系图。
 * 设计 token 来自 OpenDesign `dashboard` 设计系统；原始列表一律降级 <details> 钻取层。
 */

/* ===== 状态与工具 ===== */
var CUR = { view: 'overview', name: null };
var UNIT = DETAIL.pseudoChapters ? '节' : '章';
var CH_BY_NO = {};
DETAIL.chapters.forEach(function (c) { CH_BY_NO[c.no] = c; });
var CHARS = {};
DETAIL.characters.forEach(function (c, i) { CHARS[c.name] = c; CHARS[c.name].__idx = i; });
var TERMS = {};
DETAIL.terms.forEach(function (t) { TERMS[t.name] = t; });

/* DS 调色板（build-wiki 注入 DETAIL.ds.palette，缺了用 token 同值兜底） */
var PAL = (DETAIL.ds && DETAIL.ds.palette) || {};
function mixWhite(hex, k) {
  var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  var mix = function (c) { return Math.round(c + (255 - c) * k); };
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
}
var C_ACCENT = PAL.accent || '#0ea5e9';
var C_SUCCESS = PAL.success || '#10b981';
var C_WARN = PAL.warn || '#f59e0b';
var C_DANGER = PAL.danger || '#ef4444';
var C_FG = PAL.fg || '#111827';
var C_MUTED = PAL.muted || '#64748b';
var C_BORDER = PAL.border || '#d8e2ee';
var C_TRACK = PAL.borderSoft || '#edf3f8';
var C_DIM = mixWhite(C_ACCENT, 0.45), C_DIM2 = mixWhite(C_ACCENT, 0.68);
var CATE = [C_ACCENT, C_SUCCESS, C_WARN, C_DANGER, C_DIM, mixWhite(C_SUCCESS, 0.45), mixWhite(C_WARN, 0.45), mixWhite(C_DANGER, 0.45), C_MUTED];
function hexRgb(hex) {
  var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '14,165,233';
  var n = parseInt(m[1], 16);
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}
var ACCENT_RGB = hexRgb(C_ACCENT);

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 核心情绪八种 → 色（语义优先：甜=绿 痛=红 爽=琥珀 疑=主蓝，其余取系列色） */
var EMOTION_COLOR = {
  '甜': C_SUCCESS, '痛': C_DANGER, '爽': C_WARN, '悔': C_DIM,
  '疑': C_ACCENT, '燃': mixWhite(C_WARN, 0.25), '压迫': C_MUTED, '释然': C_DIM2
};
function emotionChip(emotion) {
  if (!emotion || !EMOTION_COLOR[emotion]) return '';
  return '<span class="chip" style="background:color-mix(in srgb,' + EMOTION_COLOR[emotion] + ' 14%,transparent);color:' + EMOTION_COLOR[emotion] + ';border-color:transparent">情绪 ' + escHtml(emotion) + '</span>';
}
function functionChip(fn) {
  if (!fn) return '';
  return '<span class="chip" style="background:color-mix(in srgb,' + C_ACCENT + ' 12%,transparent);color:' + C_ACCENT + ';border-color:transparent">功能 ' + escHtml(fn) + '</span>';
}
function charLink(n) {
  return CHARS[n] ? '<a data-go="char" data-name="' + escHtml(n) + '">' + escHtml(n) + '</a>' : '<span>' + escHtml(n) + '</span>';
}
function go(view, name) {
  CUR = { view: view, name: name || null };
  renderMain();
  if (window.innerWidth <= 900) toggleSide(false);
  window.scrollTo(0, 0);
}

/* ===== SVG 图表组件（dashboard skill：inline SVG only） ===== */

/** Catmull-Rom → 三次贝塞尔平滑路径 */
function smoothPath(pts) {
  if (pts.length < 3) return 'M' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' L');
  var d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
  }
  return d;
}

/** 滑动平均（窗口 7 或 3），返回与输入对齐的数组（边缘用可得窗口） */
function movingAvg(values, win) {
  var out = [], half = Math.floor(win / 2);
  for (var i = 0; i < values.length; i++) {
    var s = 0, c = 0;
    for (var j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) { s += values[j]; c++; }
    out.push(s / c);
  }
  return out;
}

/**
 * 平滑面积图（节奏曲线）：渐变面积＋滑动均线＋峰值标注＋悬停竖线读数＋点击跳章。
 * opts: {height, color, onClickIdx(i), hoverElId, unitLabel}
 */
function svgAreaChart(host, values, opts) {
  opts = opts || {};
  var W = Math.max(280, host.clientWidth - 32), H = opts.height || 190;
  var pad = { l: 34, r: 16, t: 18, b: 26 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var n = values.length;
  if (!n) return;
  var max = Math.max.apply(null, values.concat([1]));
  var step = iw / n;
  var pts = values.map(function (v, i) { return ({ x: pad.l + i * step + step / 2, y: pad.t + ih - Math.max(2, v / max * ih) }); });
  var line = smoothPath(pts);
  var area = line + ' L' + (pad.l + iw).toFixed(1) + ',' + (pad.t + ih) + ' L' + pts[0].x.toFixed(1) + ',' + (pad.t + ih) + ' Z';
  var gid = 'ga' + Math.round(Math.random() * 1e6);
  // 网格 + y 对标
  var grid = '';
  for (var g = 1; g <= 2; g++) {
    var gy = pad.t + ih - (ih * g / 2);
    grid += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '" stroke="' + C_TRACK + '"/>'
      + '<text x="' + (pad.l - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="10" fill="' + C_MUTED + '">' + Math.round(max * g / 2) + '</text>';
  }
  // x 稀疏标注
  var every = Math.ceil(n / 14), xlabel = '';
  for (var j = 0; j < n; j++) {
    if (j % every === 0 || (j === n - 1 && n % every === 1)) {
      xlabel += '<text x="' + pts[j].x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="' + C_MUTED + '">' + DETAIL.chapters[j].no + '</text>';
    }
  }
  // 移动均线
  var ma = movingAvg(values, n >= 12 ? 7 : 3);
  var maPts = ma.map(function (v, i) { return (pts[i].x.toFixed(1)) + ',' + (pad.t + ih - Math.max(2, v / max * ih)).toFixed(1); }).join(' ');
  // 峰值标注
  var pk = 0;
  for (var pi = 1; pi < n; pi++) if (values[pi] > values[pk]) pk = pi;
  var peakAnchorEnd = pts[pk].x > W * 0.6;
  var peak = '<circle cx="' + pts[pk].x.toFixed(1) + '" cy="' + pts[pk].y.toFixed(1) + '" r="4" fill="' + (opts.color || C_ACCENT) + '" stroke="#fff" stroke-width="1.5"/>'
    + '<text x="' + (pts[pk].x + (peakAnchorEnd ? -8 : 8)).toFixed(1) + '" y="' + Math.max(12, pts[pk].y - 9).toFixed(1) + '" text-anchor="' + (peakAnchorEnd ? 'end' : 'start') + '" font-size="10" fill="' + C_FG + '" font-weight="600">' + values[pk] + ' · 第' + DETAIL.chapters[pk].no + UNIT + '</text>';
  var svg = '<svg id="' + (opts.svgId || 'areaChart') + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible">'
    + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="' + (opts.color || C_ACCENT) + '" stop-opacity="0.30"/>'
    + '<stop offset="1" stop-color="' + (opts.color || C_ACCENT) + '" stop-opacity="0.02"/></linearGradient></defs>'
    + grid
    + '<path d="' + area + '" fill="url(#' + gid + ')"/>'
    + '<path d="' + line + '" fill="none" stroke="' + (opts.color || C_ACCENT) + '" stroke-width="2"/>'
    + '<polyline points="' + maPts + '" fill="none" stroke="' + C_MUTED + '" stroke-width="1.4" stroke-dasharray="4 3" opacity="0.8"/>'
    + peak + xlabel
    + '<line id="focusLine" x1="0" y1="' + pad.t + '" x2="0" y2="' + (pad.t + ih) + '" stroke="' + C_MUTED + '" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>'
    + '<rect x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>'
    + '</svg>';
  host.insertAdjacentHTML('beforeend', svg);
  var el = document.getElementById(opts.svgId || 'areaChart');
  el.onmousemove = function (ev) {
    var r = el.getBoundingClientRect();
    var idx = Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - r.left - pad.l) / step)));
    var fx = pts[idx].x;
    var fl = el.querySelector('#focusLine');
    if (fl) { fl.setAttribute('x1', fx); fl.setAttribute('x2', fx); fl.setAttribute('opacity', '0.6'); }
    if (opts.hoverEl) {
      opts.hoverEl.textContent = '第' + DETAIL.chapters[idx].no + UNIT + ' · ' + values[idx] + (opts.unitLabel || '');
      opts.hoverEl.style.opacity = '1';
    }
  };
  el.onmouseleave = function () {
    var fl = el.querySelector('#focusLine');
    if (fl) fl.setAttribute('opacity', '0');
    if (opts.hoverEl) opts.hoverEl.style.opacity = '0.35';
  };
  if (opts.onClickIdx) {
    el.onclick = function (ev) {
      var r = el.getBoundingClientRect();
      var idx = Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - r.left - pad.l) / step)));
      opts.onClickIdx(idx);
    };
  }
}

/** 柱状密度图（伏笔密度）：圆角柱＋网格＋悬停读数 */
function svgBars(host, values, opts) {
  opts = opts || {};
  var W = Math.max(280, host.clientWidth - 32), H = opts.height || 150;
  var pad = { l: 34, r: 16, t: 14, b: 24 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var n = values.length;
  if (!n) return;
  var max = Math.max.apply(null, values.concat([1]));
  var step = iw / n, bw = Math.max(3, Math.min(42, step * 0.55));
  var grid = '';
  for (var g = 1; g <= 2; g++) {
    var gy = pad.t + ih - (ih * g / 2);
    grid += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '" stroke="' + C_TRACK + '"/>'
      + '<text x="' + (pad.l - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="10" fill="' + C_MUTED + '">' + Math.round(max * g / 2) + '</text>';
  }
  var bars = '', xlabel = '';
  var every = Math.ceil(n / 14);
  for (var i = 0; i < n; i++) {
    var bh = Math.max(2, values[i] / max * ih);
    var x = pad.l + i * step + (step - bw) / 2, y = pad.t + ih - bh;
    bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2" fill="' + (opts.color || C_ACCENT) + '" fill-opacity="0.85"/>';
    if (i % every === 0 || (i === n - 1 && n % every === 1)) {
      xlabel += '<text x="' + (pad.l + i * step + step / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="' + C_MUTED + '">' + DETAIL.chapters[i].no + '</text>';
    }
  }
  var svg = '<svg id="' + (opts.svgId || 'barChart') + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible">'
    + grid + bars + xlabel
    + '<rect x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>';
  host.insertAdjacentHTML('beforeend', svg);
  var el = document.getElementById(opts.svgId || 'barChart');
  el.onmousemove = function (ev) {
    var r = el.getBoundingClientRect();
    var idx = Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - r.left - pad.l) / step)));
    if (opts.hoverEl) {
      opts.hoverEl.textContent = '第' + DETAIL.chapters[idx].no + UNIT + ' · ' + values[idx] + (opts.unitLabel || '');
      opts.hoverEl.style.opacity = '1';
    }
  };
  el.onmouseleave = function () { if (opts.hoverEl) opts.hoverEl.style.opacity = '0.35'; };
  if (opts.onClickIdx) {
    el.onclick = function (ev) {
      var r = el.getBoundingClientRect();
      var idx = Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - r.left - pad.l) / step)));
      opts.onClickIdx(idx);
    };
  }
}

/** 环形图（屏份份额）：stroke-dasharray 段环＋中心总量＋<title> 悬停 */
function svgDonut(items, centerLabel) {
  var size = 176, r = 62, cx = size / 2, cy = size / 2, sw = 22;
  var circ = 2 * Math.PI * r;
  var total = items.reduce(function (s, it) { return s + it.value; }, 0) || 1;
  var segs = '', off = 0;
  items.forEach(function (it, i) {
    var frac = it.value / total;
    var len = Math.max(0.6, frac * circ);
    segs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + it.color + '" stroke-width="' + sw + '"'
      + ' stroke-dasharray="' + (len - 1.5).toFixed(1) + ' ' + (circ - len + 1.5).toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '"'
      + ' transform="rotate(-90 ' + cx + ' ' + cy + ')" stroke-linecap="butt"><title>' + escHtml(it.label) + ' · ' + (frac * 100).toFixed(1) + '%</title></circle>';
    off += len;
  });
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="flex:none">'
    + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + C_TRACK + '" stroke-width="' + sw + '"/>'
    + segs
    + '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="22" font-weight="700" fill="' + C_FG + '">' + total + '</text>'
    + '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="11" fill="' + C_MUTED + '">' + escHtml(centerLabel) + '</text>'
    + '</svg>';
}

/** 五维雷达图（人物页）：网格环＋数据多边形＋维度标签 */
function svgRadar(dims) {
  var size = 240, cx = size / 2, cy = size / 2 + 4, R = 82;
  var n = dims.length;
  var angle = function (i) { return -Math.PI / 2 + i * 2 * Math.PI / n; };
  var pt = function (i, k) { var a = angle(i); return { x: cx + Math.cos(a) * R * k, y: cy + Math.sin(a) * R * k }; };
  var rings = '';
  for (var g = 1; g <= 4; g++) {
    var ring = [];
    for (var i = 0; i < n; i++) { var p = pt(i, g / 4); ring.push(p.x.toFixed(1) + ',' + p.y.toFixed(1)); }
    rings += '<polygon points="' + ring.join(' ') + '" fill="none" stroke="' + C_TRACK + '"/>';
  }
  var axes = '', labels = '';
  for (var i2 = 0; i2 < n; i2++) {
    var p2 = pt(i2, 1);
    axes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p2.x.toFixed(1) + '" y2="' + p2.y.toFixed(1) + '" stroke="' + C_TRACK + '"/>';
    var lx = cx + Math.cos(angle(i2)) * (R + 16), ly = cy + Math.sin(angle(i2)) * (R + 14);
    labels += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" font-size="11" fill="' + C_MUTED + '">' + escHtml(dims[i2].label) + '</text>';
  }
  var dataPts = [];
  for (var i3 = 0; i3 < n; i3++) {
    var k = dims[i3].max > 0 ? Math.max(0.03, dims[i3].value / dims[i3].max) : 0.03;
    var p3 = pt(i3, k);
    dataPts.push(p3.x.toFixed(1) + ',' + p3.y.toFixed(1));
  }
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="display:block;margin:0 auto;overflow:visible">'
    + rings + axes
    + '<polygon points="' + dataPts.join(' ') + '" fill="' + C_ACCENT + '" fill-opacity="0.18" stroke="' + C_ACCENT + '" stroke-width="2"/>'
    + dims.map(function (d, i4) { var k = d.max > 0 ? Math.max(0.03, d.value / d.max) : 0.03; var p4 = pt(i4, k); return '<circle cx="' + p4.x.toFixed(1) + '" cy="' + p4.y.toFixed(1) + '" r="3" fill="' + C_ACCENT + '"/>'; }).join('')
    + labels + '</svg>';
}

/* ===== 侧边导航 ===== */
function renderSide() {
  var nav = [
    ['overview', '📊 概览'],
    ['slots', '📋 拆解报告'],
    ['outline', '📖 章节大纲'],
    ['timeline', '⏱ 时间线'],
    ['graph', '🔗 关系图谱'],
    ['foreshadow', '🎣 伏笔']
  ];
  var h = '<div class="nav"><h3>面板</h3>';
  nav.forEach(function (item) {
    h += '<a data-go="' + item[0] + '" class="' + (CUR.view === item[0] ? 'on' : '') + '">' + item[1] + '</a>';
  });
  h += '</div>';
  h += '<h3>人物 (' + DETAIL.characters.length + ')</h3><div class="nav">';
  DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; }).forEach(function (c) {
    h += '<a data-go="char" data-name="' + escHtml(c.name) + '" class="' + (CUR.view === 'char' && CUR.name === c.name ? 'on' : '') + '">' + escHtml(c.name) + '</a>';
  });
  h += '</div>';
  if (DETAIL.terms.length) {
    h += '<h3>设定 / 物品 (' + DETAIL.terms.length + ')</h3><div class="nav">';
    DETAIL.terms.slice(0, 40).forEach(function (t) {
      h += '<a data-go="term" data-name="' + escHtml(t.name) + '" class="' + (CUR.view === 'term' && CUR.name === t.name ? 'on' : '') + '">' + escHtml(t.name) + '</a>';
    });
    h += '</div>';
  }
  document.getElementById('sideNav').innerHTML = h;
}

/* ===== 章解读 chips（确定性归纳＋细化层标注） ===== */
function sectionChips(no) {
  var chIdx = -1;
  for (var i = 0; i < DETAIL.chapters.length; i++) { if (DETAIL.chapters[i].no === no) { chIdx = i; break; } }
  if (chIdx < 0) return '';
  var h = '<div class="chips">';
  var ch = DETAIL.chapters[chIdx];
  if (ch.function) h += functionChip(ch.function);
  h += emotionChip(ch.emotion);
  if (ch.beats) h += '<span class="chip">剧情点 ' + ch.beats + '</span>';
  // 本章主角（在场段数最多者，从 timeline 现算——不再依赖整本矩阵）
  var presence = {};
  (DETAIL.timeline.find(function (t) { return t.no === ch.no; }) || { events: [] }).events.forEach(function (event) {
    if (event.who) presence[event.who] = (presence[event.who] || 0) + 1;
  });
  var topEntry = Object.entries(presence).sort(function (a, b) { return b[1] - a[1]; })[0];
  if (topEntry) h += '<span class="chip">主角 <b>' + escHtml(topEntry[0]) + '</b> ' + topEntry[1] + ' 条</span>';
  if (ch.newChars.length) h += '<span class="chip green">新登场 ' + escHtml(ch.newChars.slice(0, 3).join('、')) + '</span>';
  if (ch.foreshadow.length) h += '<span class="chip red">伏笔 +' + ch.foreshadow.length + '</span>';
  return h + '</div>';
}

/* ===== KPI 卡片行（前半 vs 后半 delta，确定性） ===== */
/* ===== 视图体系重设计（作者 2026-11-14） =====
 * 原则：一视图回答一个问题，只给关键节点，不做低信息量报表。
 *   概览   → 这本书讲什么？（内核 + 五维骨架，不要报表）
 *   人物   → 这个人物的弧光是什么？（三节点：首次/退出/高光 + 动机弧光）
 *   章节   → 这一章发生了什么？（功能/情绪/剧情点/梗概/伏笔/高光）
 *   伏笔   → 埋了什么、收了没有？
 *   图谱   → 关系与因果结构长什么样？
 * 已删除：人物×章出场热力图（只告诉你人物在哪章出现）、出场节奏曲线、屏份份额环形图。
 */

/** 故事骨架五维卡（概览用）：每个维度一个「判断」，不是一个数字。 */
function skeletonCards() {
  var S = D.slots;
  var plots = DETAIL.chapters;
  var totalBeats = plots.reduce(function (sum, c) { return sum + (c.beats || 0); }, 0);
  var emotions = {};
  plots.forEach(function (c) { if (c.emotion) emotions[c.emotion] = (emotions[c.emotion] || 0) + 1; });
  var dominant = Object.entries(emotions).sort(function (a, b) { return b[1] - a[1]; })[0];
  var hookCount = plots.reduce(function (sum, c) { return sum + c.foreshadow.length; }, 0);
  var mainChar = DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; })[0];
  var items = [
    {
      label: '内核',
      value: (S && S.gimmick && S.gimmick.emotionPromise ? String(S.gimmick.emotionPromise).split(/[，。；—]/)[0].slice(0, 14) : (dominant ? dominant[0] + ' 为主' : '—')),
      note: S && S.plotDesign && S.plotDesign.structure ? '结构：' + S.plotDesign.structure.picked : '',
      link: 'slots'
    },
    {
      label: '主角',
      value: mainChar ? mainChar.name : '—',
      note: mainChar && mainChar.arc && mainChar.arc.end ? '弧光：' + (mainChar.arc.start || '').slice(0, 12) + ' → ' + String(mainChar.arc.end).slice(0, 12) : '',
      link: mainChar ? 'char:' + mainChar.name : 'characters'
    },
    {
      label: '节奏',
      value: plots.length + ' ' + UNIT + ' / ' + totalBeats + ' 剧情点',
      note: dominant ? '主导情绪 ' + dominant[0] + '（' + dominant[1] + ' ' + UNIT + '）' : '',
      link: 'timeline'
    },
    {
      label: '悬念',
      value: hookCount + ' 条伏笔',
      note: hookCount ? '分布 ' + plots.filter(function (c) { return c.foreshadow.length; }).length + ' ' + UNIT : '—',
      link: 'foreshadow'
    },
    {
      label: '世界',
      value: (DETAIL.terms.length || 0) + ' 条设定',
      note: DETAIL.terms.filter(function (t) { return t.kind === '场景'; }).length + ' 场景 / ' + DETAIL.terms.filter(function (t) { return t.kind === '道具'; }).length + ' 道具',
      link: 'graph'
    }
  ];
  return '<div class="skeleton">' + items.map(function (item) {
    return '<div class="sk-card">'
      + '<div class="sk-label">' + escHtml(item.label) + '</div>'
      + '<div class="sk-value">' + escHtml(item.value) + '</div>'
      + (item.note ? '<div class="sk-note">' + escHtml(item.note) + '</div>' : '')
      + '</div>';
  }).join('') + '</div>';
}

/** 情绪曲线（B1）：横轴进度，纵轴强度（用剧情点数代理），颜色=情绪类型。只标峰值，不画全部点。 */
function emotionCurve() {
  var chapters = DETAIL.chapters.filter(function (c) { return c.emotion; });
  if (chapters.length < 2) return '';
  var maxBeats = Math.max.apply(null, chapters.map(function (c) { return c.beats || 1; }).concat([1]));
  var W = 760, H = 132, pad = { l: 10, r: 10, t: 14, b: 22 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var step = iw / Math.max(1, chapters.length - 1);
  var pts = chapters.map(function (c, i) {
    return {
      x: pad.l + i * step,
      y: pad.t + ih - ((c.beats || 1) / maxBeats) * ih,
      color: EMOTION_COLOR[c.emotion] || C_MUTED,
      chapter: c.no, emotion: c.emotion, beats: c.beats, title: c.title
    };
  });
  // 折线（淡淡一条，只是连接）
  var line = pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;width:100%;overflow:visible">';
  svg += '<polyline points="' + line + '" fill="none" stroke="' + C_TRACK + '" stroke-width="1.5"/>';
  // 只标「峰」：强度 ≥ 该点前后邻域最大
  pts.forEach(function (p, i) {
    var isPeak = true;
    for (var k = Math.max(0, i - 2); k <= Math.min(pts.length - 1, i + 2); k++) {
      if (pts[k].beats > p.beats) { isPeak = false; break; }
    }
    var r = isPeak ? 5.5 : 3;
    svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r + '" fill="' + p.color + '" fill-opacity="' + (isPeak ? 0.95 : 0.5) + '" stroke="#fff" stroke-width="1.2">'
      + '<title>第' + p.chapter + UNIT + '「' + escHtml(p.title) + '」· ' + p.emotion + ' · 剧情点 ' + p.beats + '</title></circle>';
  });
  // 只给峰值加标签（最多 4 个）
  pts.forEach(function (p, i) {
    var isPeak = true;
    for (var k = Math.max(0, i - 2); k <= Math.min(pts.length - 1, i + 2); k++) {
      if (pts[k].beats > p.beats) { isPeak = false; break; }
    }
    if (!isPeak) return;
    svg += '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - 10).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="600" fill="' + p.color + '" stroke="#fff" stroke-width="3" paint-order="stroke">' + escHtml(p.emotion) + '</text>';
  });
  svg += '</svg>';
  return '<div class="chartbox" style="padding:14px 18px 6px">'
    + '<div class="curve-head"><b>情绪曲线</b><span>' + chapters.length + ' ' + UNIT + '有情绪标注 · 纵轴=剧情强度 · 只标峰值</span></div>'
    + svg + '</div>';
}

/* ===== 概览：这本书讲什么（答案式，不堆报表） ===== */
function vOverview() {
  var g = (D.slots && D.slots.gimmick) || null;
  var h = '<section class="hero">';
  h += '<div class="h-eyebrow">世界书 · World Book' + (D.enrich.perspective ? ' · ' + escHtml(D.enrich.perspective.perspective) + ' 人称' : '') + '</div>';
  h += '<h1>' + escHtml(D.book.title) + '</h1>';
  h += '<div class="h-meta"><span><b>' + escHtml(D.book.author) + '</b></span><span><b>' + (D.book.words || 0).toLocaleString() + '</b> 字</span>'
    + '<span><b>' + D.chapters.length + '</b> ' + UNIT + '</span><span><b>' + D.characters.length + '</b> 人物</span>'
    + '<span><b>' + (D.quality.traceableRate != null ? (D.quality.traceableRate * 100).toFixed(1) + '%' : '—') + '</b> 可溯源</span></div>';
  if (g && g.logline) h += '<div class="h-logline">' + escHtml(g.logline) + '</div>';
  if (g && g.elements && g.elements.length) h += '<div class="h-tags">' + g.elements.slice(0, 8).map(function (e) { return '<span>' + escHtml(e) + '</span>'; }).join('') + '</div>';
  h += '</section>';

  // ① 骨架五维（一屏看完这本书的构图）
  h += '<h2>故事骨架 <small>五个维度各一句判断</small></h2>';
  h += skeletonCards();

  // ② 剧情梗概（全书一句话展开）
  if (D.enrich.storySummary) h += '<h2>全书梗概</h2><div class="summary">' + escHtml(D.enrich.storySummary) + '</div>';

  // ③ 情绪曲线（B1 的横轴×纵轴，只标峰值）
  var curve = emotionCurve();
  if (curve) { h += '<h2>情绪走向 <small>进度 × 强度 × 情绪类型</small></h2>'; h += curve; }

  // ④ 故事结构四阶段（plot-design stages）
  var pd = D.slots && D.slots.plotDesign;
  if (pd && pd.stages && pd.stages.length) {
    h += '<h2>结构阶段 <small>' + escHtml(pd.structure ? pd.structure.picked : '') + '</small></h2>';
    h += '<div class="stages">';
    pd.stages.forEach(function (stage, index) {
      var range = stage.chapters && stage.chapters.length ? '第 ' + stage.chapters[0] + '~' + stage.chapters[stage.chapters.length - 1] + ' ' + UNIT : '';
      h += '<div class="stage"><span class="stage-no">' + (index + 1) + '</span>'
        + '<div class="stage-body"><b>' + escHtml(stage.phase) + '</b>'
        + (range ? '<em>' + range + '</em>' : '')
        + '<div>' + escHtml(stage.job || '') + '</div></div></div>';
    });
    h += '</div>';
    if (pd.turningPoints && pd.turningPoints.length) {
      h += '<div class="turns"><b>转折点</b><ul>' + pd.turningPoints.map(function (tp) {
        return '<li><span class="tag">第' + tp.chapter + UNIT + '</span> ' + escHtml(tp.event) + '</li>';
      }).join('') + '</ul></div>';
    }
  }

  // ⑤ 人物速览：只给三节点（首次/退出/高光），不给逐章分布
  h += '<h2>人物骨架 <small>首次出场 · 退出 · 高光</small></h2>';
  h += characterBoneTable(DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; }).slice(0, 8));

  h += '<div id="dsFooter">Design System: ' + escHtml((DETAIL.ds && DETAIL.ds.title) || 'Dashboard') + ' · ' + escHtml((DETAIL.ds && DETAIL.ds.source) || 'embedded') + ' · 图表 inline SVG</div>';
  return h;
}

/** 人物骨架表：三节点（首次/退出/高光）——取代出场热力图。 */
function characterBoneTable(characters) {
  var h = '<div class="bone-table">';
  h += '<div class="bone-row bone-head"><span>人物</span><span>身份</span><span>首次</span><span>退出</span><span>高光</span><span>弧光</span></div>';
  characters.forEach(function (c) {
    var arcText = '—';
    if (c.arc && c.arc.end) {
      var startText = String(c.arc.start || '').split(/[，。；]/)[0].slice(0, 12);
      var endText = String(c.arc.end || '').split(/[，。；]/)[0].slice(0, 12);
      arcText = (startText || '—') + ' → ' + (endText || '—');
    }
    h += '<div class="bone-row">'
      + '<span class="bone-name"><a data-go="char" data-name="' + escHtml(c.name) + '">' + escHtml(c.name) + '</a></span>'
      + '<span class="bone-id">' + escHtml((c.identity || '').slice(0, 18) || '—') + '</span>'
      + '<span>' + (c.firstChapter != null ? '第' + c.firstChapter + UNIT : '—') + '</span>'
      + '<span>' + (c.exitChapter != null ? '第' + c.exitChapter + UNIT : '<em class="muted">贯穿</em>') + '</span>'
      + '<span>' + (c.highlightChapter != null ? '<a data-go="chapter" data-no="' + c.highlightChapter + '">第' + c.highlightChapter + UNIT + '</a>' : '—') + '</span>'
      + '<span class="bone-arc">' + escHtml(arcText) + '</span>'
      + '</div>';
  });
  h += '</div>';
  return h;
}

/* ===== 人物页：这个人的弧光是什么（三节点 + 动机弧光，不给逐章曲线） ===== */
function vChar(name) {
  var c = CHARS[name];
  if (!c) return '<p>人物不存在</p>';
  var h = '<h1>' + escHtml(c.name) + '</h1>';
  h += '<div class="meta">' + (c.identity ? '<span>' + escHtml(c.identity) + '</span>' : '')
    + (c.archetype ? '<span>' + escHtml(c.archetype) + '</span>' : '')
    + (c.castTier ? '<span>剧作档 ' + escHtml(c.castTier) + '</span>' : '') + '</div>';
  if (c.aliases.length) h += '<div>' + c.aliases.map(function (a) { return '<span class="tag">别名 ' + escHtml(a) + '</span>'; }).join('') + '</div>';

  // ① 三节点时间轴（首次→高光→退出，一条线看完这个人的故事跨度）
  h += '<h2>出场跨度 <small>首次 · 高光 · 退出</small></h2>';
  h += '<div class="lifeline">'
    + '<div class="lf-node"><b>首次出场</b><span>' + (c.firstChapter != null ? '第 ' + c.firstChapter + ' ' + UNIT : '—') + '</span></div>'
    + '<div class="lf-bar"></div>'
    + '<div class="lf-node highlight"><b>高光</b><span>' + (c.highlightChapter != null ? '第 ' + c.highlightChapter + ' ' + UNIT : '—') + '</span></div>'
    + '<div class="lf-bar"></div>'
    + '<div class="lf-node"><b>' + (c.exitChapter != null ? '退出' : '贯穿至结局') + '</b><span>' + (c.exitChapter != null ? '第 ' + c.exitChapter + ' ' + UNIT : '—') + '</span></div>'
    + '</div>';
  if (c.highlightQuote) h += '<div class="quote hl-quote">“' + escHtml(c.highlightQuote) + '”</div>';

  // ② 弧光：起点→终点（一句判断，不是数据）
  if (c.arc && (c.arc.start || c.arc.end)) {
    h += '<h2>弧光 <small>需求层级的迁移</small></h2><div class="arc-block">';
    h += '<div class="arc-line"><span>' + escHtml(c.arc.start || '—') + '</span><i>→</i><span>' + escHtml(c.arc.end || '—') + '</span></div>';
    if (c.arc.turnChapter) h += '<div class="arc-turn">转变于第 ' + c.arc.turnChapter + ' ' + UNIT + '</div>';
    if (c.arc.evidence) h += '<div class="arc-evidence">' + escHtml(c.arc.evidence) + '</div>';
    h += '</div>';
  }

  // ③ 动机
  if (c.goal) h += '<h2>动机</h2><div class="summary">' + escHtml(c.goal) + '</div>';

  // ④ 关键选择（带章号，这是「他为什么这么做」的锚点）
  if (c.keyChoices.length) {
    h += '<h2>关键选择 <small>每个选择都能点回原文</small></h2><ul class="choices">';
    c.keyChoices.forEach(function (choice) {
      h += '<li><a data-go="chapter" data-no="' + choice.chapter + '">第' + choice.chapter + UNIT + '</a> ' + escHtml(choice.choice) + '</li>';
    });
    h += '</ul>';
  }

  // ⑤ 关系与镜像（人物之间的关系不是列表，是这张图的边——这里只放最关键的）
  if (c.mirror) h += '<h2>镜像人物</h2><p>' + escHtml(c.mirror) + '</p>';
  if (c.edges.length) {
    h += '<h2>关系 <small>' + c.edges.length + ' 条</small></h2><ul>';
    c.edges.slice(0, 8).forEach(function (edge) {
      h += '<li>' + (edge.dir === 'out' ? '→' : '←') + ' ' + charLink(edge.other) + ' <span class="tag">' + escHtml(edge.type) + '</span>' + (edge.how ? ' <span class="sub">' + escHtml(edge.how) + '</span>' : '') + '</li>';
    });
    h += '</ul>';
  }
  return h;
}

/* ===== 章节大纲 ===== */
function vOutline() {
  var h = '<h1>章节大纲</h1><div class="meta">' + D.chapters.length + ' ' + UNIT + ' · 梗概与小标题由模型窄窗归纳，出场人物与伏笔来自 fact 条目</div>';
  D.chapters.forEach(function (c) {
    h += '<div class="outline-ch"><h3><a data-go="chapter" data-no="' + c.no + '">' + escHtml(c.title) + '</a></h3>';
    if (c.summary) h += '<div class="summary">' + escHtml(c.summary) + '</div>';
    h += sectionChips(c.no);
    h += '<div>' + c.chars.slice(0, 10).map(function (n) { return charLink(n); }).join(' ') + '</div>';
    h += '</div>';
  });
  return h;
}

/* ===== 单章页 ===== */
function vChapter(no) {
  var c = CH_BY_NO[no];
  if (!c) return '<p>章节不存在</p>';
  var chIdx = -1;
  for (var i = 0; i < DETAIL.chapters.length; i++) { if (DETAIL.chapters[i].no === Number(no)) { chIdx = i; break; } }

  var h = '<h1>' + escHtml(c.title) + '</h1>';
  h += '<div class="meta"><span>' + c.segments + ' 段</span><span>' + c.events + ' 事件</span>';
  if (c.function) h += '<span>功能 ' + escHtml(c.function) + '</span>';
  if (c.emotion) h += '<span>情绪 ' + escHtml(c.emotion) + '</span>';
  if (c.beats) h += '<span>剧情点 ' + c.beats + '</span>';
  h += '</div>';
  if (c.summary) h += '<div class="summary">' + escHtml(c.summary) + '</div>';

  // ① 在场人物（一行点名即可——逐人出场次数条形是低信息量报表）
  var presence = {};
  (DETAIL.timeline.find(function (t) { return t.no === Number(no); }) || { events: [] }).events.forEach(function (event) {
    if (event.who) presence[event.who] = (presence[event.who] || 0) + 1;
  });
  var present = Object.entries(presence).sort(function (a, b) { return b[1] - a[1]; });
  if (present.length) {
    h += '<h2>在场人物</h2><div class="chips">' + present.map(function (entry) {
      return CHARS[entry[0]]
        ? '<a class="chip chip-link" data-go="char" data-name="' + escHtml(entry[0]) + '">' + escHtml(entry[0]) + '</a>'
        : '<span class="chip">' + escHtml(entry[0]) + '</span>';
    }).join('') + '</div>';
  }

  // ② 本章场景与道具（世界要素按章号过滤）
  var scenes = [], items = [];
  (DETAIL.terms || []).forEach(function (t) {
    if ((t.chapters || []).indexOf(Number(no)) < 0) return;
    if (/场景/.test(t.kind || '')) scenes.push(t);
    else if (/道具/.test(t.kind || '')) items.push(t);
  });
  if (scenes.length || items.length) {
    h += '<h2>场景与道具 <small>' + scenes.length + ' 场景 / ' + items.length + ' 道具</small></h2><div class="grid">';
    scenes.forEach(function (s) {
      h += '<div class="card"><h4>🏛 ' + escHtml(s.name) + '</h4><div class="sub">' + escHtml((s.desc || '').slice(0, 70)) + '</div></div>';
    });
    items.forEach(function (it) {
      h += '<div class="card"><h4>🗝 ' + escHtml(it.name) + '</h4><div class="sub">' + escHtml((it.desc || '').slice(0, 70)) + '</div></div>';
    });
    h += '</div>';
  }

  // ③ 伏笔 + 高光（双栏）
  var highs = (D.excerpts || []).filter(function (e) { return e.chapter === Number(no); });
  if (c.foreshadow.length || highs.length) {
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:30px">';
    if (c.foreshadow.length) {
      h += '<div><h2>本章伏笔 <small>' + c.foreshadow.length + ' 条</small></h2><ul>';
      c.foreshadow.forEach(function (f) { h += '<li>' + escHtml(f) + '</li>'; });
      h += '</ul></div>';
    }
    if (highs.length) {
      h += '<div><h2>高光片段 <small>' + highs.length + ' 处</small></h2>';
      highs.forEach(function (e) {
        h += '<div class="event"><b>' + escHtml(e.beat) + '</b>' + (e.quote ? '<div class="quote" style="margin-top:6px">“' + escHtml(e.quote) + '”</div>' : '') + '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
  }

  // ④ 事件流：按通道分组（比平铺几十条更易读，原文逐字保留）
  var groups = { say: [], do: [], think: [], feel: [], perceive: [], state: [], event: [] };
  DETAIL.timeline.filter(function (t) { return t.no === Number(no); }).forEach(function (t) {
    t.events.forEach(function (e) {
      (groups[e.channel] || groups.state).push(e);
    });
  });
  var meta = {
    say: ['💬 台词', 'rgba(16,185,129,.10)', '#10b981'],
    do: ['🏃 动作', 'rgba(245,158,11,.10)', '#b45309'],
    think: ['💭 心理', 'rgba(122,162,255,.10)', '#0c5cab'],
    feel: ['💗 感受', 'rgba(239,68,68,.09)', '#dc2626'],
    perceive: ['👁 感知', 'rgba(139,92,246,.10)', '#7c3aed'],
    state: ['📄 状态/描写', 'rgba(100,116,139,.10)', '#64748b'],
    event: ['⚙ 事件', 'rgba(100,116,139,.10)', '#64748b']
  };
  h += '<h2>事件流 <small>' + c.events + ' 条 · 按通道分组（原文逐字）</small></h2>';
  ['say', 'do', 'think', 'feel', 'perceive', 'state', 'event'].forEach(function (key) {
    var list = groups[key];
    if (!list.length) return;
    var m = meta[key];
    h += '<details class="drill"><summary><span style="background:' + m[1] + ';color:' + m[2] + ';padding:2px 10px;border-radius:999px;font-weight:600">' + m[0] + ' ' + list.length + '</span></summary>';
    list.forEach(function (e) {
      h += '<div class="event"><span class="who" style="' + (e.who ? '' : 'opacity:.45;font-weight:400') + '">' + escHtml(e.who || '旁白') + '</span><div>' + escHtml(e.text) + '</div></div>';
    });
    h += '</details>';
  });
  return h;
}

/* ===== 时间线 ===== */
function vTimeline() {
  var h = '<h1>时间线</h1><div class="meta">' + D.chapters.length + ' ' + UNIT + '，事件按章序归并——曲线上点击任意点直达该章</div>';
  h += '<div class="chartbox"><div class="hover-read" id="tlHover">悬停查看读数</div></div>';
  DETAIL.timeline.forEach(function (t) {
    h += '<details class="drill" id="tl-' + t.no + '"><summary>第 ' + t.no + ' ' + UNIT + ' · ' + escHtml(t.title) + ' · ' + t.events.length + ' 事件</summary>';
    t.events.forEach(function (e) {
      h += '<div class="event"><span class="who" style="' + (e.who ? '' : 'opacity:.45;font-weight:400') + '">' + escHtml(e.who || '旁白') + '</span> <span class="ch">[' + escHtml(e.channel) + ']</span><div>' + escHtml(e.text) + '</div></div>';
    });
    h += '</details>';
  });
  return h;
}

function drawTimelineCharts() {
  var host = document.querySelector('#view .chartbox');
  if (!host) return;
  svgAreaChart(host, DETAIL.chapters.map(function (c) { return c.events; }), {
    height: 200, svgId: 'tlSvg', hoverEl: document.getElementById('tlHover'), unitLabel: ' 事件',
    onClickIdx: function (i) {
      var no = DETAIL.chapters[i].no;
      var el = document.getElementById('tl-' + no);
      if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  });
}

/* ===== 人物矩阵 ===== */
/* ===== 伏笔 ===== */
function vForeshadow() {
  // 伏笔视图（作者 2026-11-14）：不问「每章几条」，只问「埋了什么、收了没有」。
  var all = [];
  DETAIL.chapters.forEach(function (c) {
    c.foreshadow.forEach(function (f) { all.push({ no: c.no, text: f }); });
  });
  var h = '<h1>伏笔</h1><div class="meta">共 ' + all.length + ' 条 · 按埋设顺序</div>';
  if (!all.length) return h + '<p class="sub">本书增补窄窗未归纳出伏笔（或原文确实没有明显伏笔）。</p>';
  h += '<div class="hooklist">';
  all.forEach(function (f) {
    var chapter = CH_BY_NO[f.no];
    h += '<div class="hook">'
      + '<div class="hook-when"><a data-go="chapter" data-no="' + f.no + '">第' + f.no + UNIT + '</a>'
      + (chapter && chapter.title ? '<em>' + escHtml(chapter.title) + '</em>' : '') + '</div>'
      + '<div class="hook-text">' + escHtml(f.text) + '</div>'
      + '</div>';
  });
  h += '</div>';
  return h;
}

/* ===== 设定 / 物品 ===== */
function vTerm(name) {
  var t = TERMS[name];
  if (!t) return '<p>词条不存在</p>';
  var h = '<h1>' + escHtml(t.name) + '</h1>';
  h += '<div class="meta"><span>' + escHtml(t.kind || '设定') + '</span><span>权重 ' + t.mentions + ' ' + UNIT + '</span></div>';
  if (t.desc) h += '<div class="summary">' + escHtml(t.desc) + '</div>';
  if (t.chapters.length) h += '<h2>出现章节</h2><p>' + t.chapters.map(function (n) { return '<a data-go="chapter" data-no="' + n + '">第' + n + UNIT + '</a>'; }).join('、') + '</p>';
  if (t.edges.length) h += '<h2>关联</h2><ul>' + t.edges.map(function (e) {
    return '<li>' + charLink(e.person) + ' <span class="tag">' + escHtml(e.type) + '</span>' + (e.how ? ' <span class="sub">' + escHtml(e.how) + '</span>' : '') + '</li>';
  }).join('') + '</ul>';
  return h;
}

/* ===== 关系图谱（手写力导向，对齐原版） ===== */
/* ===== 知识图谱（四类一等公民：人物/事件/场景/道具） ===== */
var KIND_COLOR = { person: C_ACCENT, event: C_SUCCESS, scene: '#8b5cf6', item: C_WARN, term: C_MUTED };
var KIND_LABEL = { person: '人物', event: '事件', scene: '场景', item: '道具', term: '设定' };
var KIND_ORDER = ['person', 'event', 'scene', 'item', 'term'];
function catColor(kind) { return KIND_COLOR[kind] || C_MUTED; }

/**
 * 力导向布局（重写版，作者 2026-11-14 反馈「前端有问题」）：
 *   · 分层初始位置：人物靠内环、事件中环、场景/道具外环——避免孤立点散成堆；
 *   · 斥力按度数缩放：枢纽节点（如主角、高频场景）不再被推到边缘；
 *   · 边弹簧按类型调刚度：结构性边（在场/发生于/使用）短，同场边长；
 *   · 标签智能避让：按节点度数排序，度数高的优先占位，重叠则换到下方/左侧；
 *   · 孤立节点不画（无边的场景/道具在列表视图看，图上只画有连接的）。
 */
function forceLayout(svg, nodes, edges, opt) {
  opt = opt || {};
  var W = svg.clientWidth || 900, H = svg.clientHeight || 520;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!nodes.length) {
    var empty = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    empty.setAttribute('x', W / 2); empty.setAttribute('y', H / 2); empty.setAttribute('text-anchor', 'middle');
    empty.setAttribute('fill', C_MUTED); empty.setAttribute('font-size', '13'); empty.textContent = '（暂无可绘制的节点）';
    svg.appendChild(empty); return;
  }
  var NS = 'http://www.w3.org/2000/svg';
  var map = {};
  nodes.forEach(function (n) { map[n.id] = n; });
  edges = edges.filter(function (e) { return map[e.a] && map[e.b]; });

  // 度数统计（决定斥力与标签优先级）
  var degree = {};
  edges.forEach(function (e) { degree[e.a] = (degree[e.a] || 0) + 1; degree[e.b] = (degree[e.b] || 0) + 1; });
  var focus = opt.focus;

  // 分层初始位置：人物内环 → 事件中环 → 场景/道具外环
  var rings = { person: 0.34, event: 0.62, scene: 0.92, item: 0.92, term: 0.92 };
  var groups = {};
  nodes.forEach(function (n) { (groups[n.kind] = groups[n.kind] || []).push(n); });
  var focusRatio = focus ? 0.45 : 1;
  Object.keys(groups).forEach(function (kind) {
    var ring = (rings[kind] || 0.8) * Math.min(W, H) * 0.46 * focusRatio;
    groups[kind].forEach(function (n, i) {
      var angle = (i / groups[kind].length) * Math.PI * 2 + (kind === 'event' ? 0.3 : kind === 'scene' ? 0.7 : 0);
      n.x = W / 2 + Math.cos(angle) * ring + (Math.random() - 0.5) * 24;
      n.y = H / 2 + Math.sin(angle) * ring * 0.82 + (Math.random() - 0.5) * 24;
      n.vx = 0; n.vy = 0;
    });
  });

  var iters = nodes.length > 120 ? 260 : 320;
  var stiffness = { '在场': 0.055, '发生于': 0.075, '使用': 0.075, '同场': 0.008 };
  for (var it = 0; it < iters; it++) {
    var cooling = 1 - it / iters * 0.7;
    // 斥力：度数越高斥力越弱（枢纽留在中心）；节点越多整体加强
    var repulseBase = (nodes.length > 150 ? 2600 : 1900) * cooling;
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        var d = Math.sqrt(d2);
        var da = 1 + (degree[a.id] || 0) * 0.35, db = 1 + (degree[b.id] || 0) * 0.35;
        var f = repulseBase / (d2 * Math.max(1, Math.min(da, db) * 0.55));
        a.vx += dx / d * f; a.vy += dy / d * f;
        b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
    }
    // 弹簧：结构性边短（事件↔人/场景/道具），同场边长
    edges.forEach(function (e) {
      var a2 = map[e.a], b2 = map[e.b];
      if (!a2 || !b2) return;
      var k = stiffness[e.type] ?? 0.02;
      var rest = e.type === '同场' ? 150 : 84;
      var dx = b2.x - a2.x, dy = b2.y - a2.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var f2 = (d - rest) * k * cooling;
      a2.vx += dx / d * f2; a2.vy += dy / d * f2;
      b2.vx -= dx / d * f2; b2.vy -= dy / d * f2;
    });
    // 向心力（防止整体漂移散开）
    nodes.forEach(function (n) {
      n.vx += (W / 2 - n.x) * 0.0016;
      n.vy += (H / 2 - n.y) * 0.0016;
      n.vx *= 0.62; n.vy *= 0.62;
      n.x += n.vx; n.y += n.vy;
    });
  }
  // 中心区最小间距（作者 2026-11-14「标签叠在一起」）：布局后做一轮硬分离，
  // 只对半径大或度数高的节点生效——把枢纽拉开，事件小点允许靠近。
  for (var pass = 0; pass < 24; pass++) {
    var moved = false;
    for (var m = 0; m < nodes.length; m++) {
      var na = nodes[m];
      if ((degree[na.id] || 0) < 3 && na.kind !== 'person') continue;
      for (var q = m + 1; q < nodes.length; q++) {
        var nb = nodes[q];
        if ((degree[nb.id] || 0) < 3 && nb.kind !== 'person') continue;
        var minGap = (na.r || 7) + (nb.r || 7) + 22;
        var ddx = nb.x - na.x, ddy = nb.y - na.y;
        var dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.1;
        if (dist >= minGap) continue;
        var push = (minGap - dist) / 2;
        var ux = ddx / dist, uy = ddy / dist;
        na.x -= ux * push; na.y -= uy * push;
        nb.x += ux * push; nb.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  var pad = 26;
  nodes.forEach(function (n) {
    n.x = Math.max(pad + 30, Math.min(W - pad - 30, n.x));
    n.y = Math.max(pad + 12, Math.min(H - pad - 12, n.y));
  });

  // 边：按类型区分配色/虚实/粗细
  edges.forEach(function (e) {
    var a2 = map[e.a], b2 = map[e.b];
    if (!a2 || !b2) return;
    var line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', a2.x); line.setAttribute('y1', a2.y);
    line.setAttribute('x2', b2.x); line.setAttribute('y2', b2.y);
    var structural = e.type === '在场' || e.type === '发生于' || e.type === '使用';
    line.setAttribute('stroke', structural ? '#c7d2e8' : e.type === '同场' ? '#dbe4f0' : '#9fb0cc');
    line.setAttribute('stroke-width', structural ? String(0.8 + Math.min(2.4, (e.weight || 1) * 0.35)) : '1');
    if (e.type === '同场') line.setAttribute('stroke-dasharray', '3 3');
    var tip = document.createElementNS(NS, 'title');
    tip.textContent = (e.type || '关联') + (e.weight ? ' · ' + e.weight : '');
    line.appendChild(tip);
    svg.appendChild(line);
  });

  // 节点渐变定义（四类）
  var defs = document.createElementNS(NS, 'defs');
  KIND_ORDER.forEach(function (kind) {
    if (!KIND_COLOR[kind]) return;
    var grad = document.createElementNS(NS, 'radialGradient');
    grad.setAttribute('id', 'ng-' + kind);
    grad.setAttribute('cx', '34%'); grad.setAttribute('cy', '30%'); grad.setAttribute('r', '72%');
    var base = KIND_COLOR[kind];
    var s1 = document.createElementNS(NS, 'stop');
    s1.setAttribute('offset', '0'); s1.setAttribute('stop-color', mixWhite(base, 0.45));
    var s2 = document.createElementNS(NS, 'stop');
    s2.setAttribute('offset', '1'); s2.setAttribute('stop-color', base);
    grad.appendChild(s1); grad.appendChild(s2);
    defs.appendChild(grad);
  });
  svg.appendChild(defs);

  // 标签避让：度数高者优先占位，检测重叠后换位置
  var placed = [];
  var labelOrder = nodes.slice().sort(function (x, y) { return (degree[y.id] || 0) - (degree[x.id] || 0); });
  var labelPos = {};
  labelOrder.forEach(function (n) {
    var text = n.id;
    var estW = text.length * 7.2;
    // 候选位置优先「径向朝外」（相对画布中心的法线方向）——中心密集区标签才不会压在一起
    var vx = n.x - W / 2, vy = n.y - H / 2;
    var vlen = Math.sqrt(vx * vx + vy * vy) || 1;
    var off = (n.r || 7) + 9;
    var rdx = vx / vlen * off, rdy = vy / vlen * off;
    var radialAnchor = Math.abs(vx) < vlen * 0.35 ? 'middle' : (vx > 0 ? 'start' : 'end');
    var candidates = [
      { dx: rdx, dy: rdy + 4, anchor: radialAnchor },
      { dx: 0, dy: -(n.r || 7) - 8, anchor: 'middle' },
      { dx: 0, dy: (n.r || 7) + 15, anchor: 'middle' },
      { dx: (n.r || 7) + 8, dy: 4, anchor: 'start' },
      { dx: -(n.r || 7) - 8, dy: 4, anchor: 'end' }
    ];
    var best = candidates[0];
    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c];
      var cx = n.x + cand.dx, cy = n.y + cand.dy;
      var x1 = cand.anchor === 'middle' ? cx - estW / 2 : cand.anchor === 'start' ? cx : cx - estW;
      var box = { x1: x1, x2: x1 + estW, y1: cy - 8, y2: cy + 3 };
      var hit = placed.some(function (p) { return !(box.x2 < p.x1 || box.x1 > p.x2 || box.y2 < p.y1 || box.y1 > p.y2); });
      if (!hit) { best = cand; placed.push(box); break; }
      if (c === candidates.length - 1) placed.push(box); // 都撞就接受最后一个
    }
    labelPos[n.id] = { dx: best.dx, dy: best.dy, anchor: best.anchor };
  });

  // 节点
  nodes.forEach(function (n) {
    var g = document.createElementNS(NS, 'g');
    var halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('cx', n.x); halo.setAttribute('cy', n.y); halo.setAttribute('r', (n.r || 7) + 5);
    halo.setAttribute('fill', catColor(n.kind)); halo.setAttribute('fill-opacity', '0.10');
    g.appendChild(halo);
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', n.r || 7);
    c.setAttribute('fill', 'url(#ng-' + n.kind + ')');
    c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1.6');
    if (n.kind === 'event') c.setAttribute('stroke-dasharray', '2.5 1.5');
    if (focus === n.id) { c.setAttribute('stroke', '#0b1220'); c.setAttribute('stroke-width', '2.6'); }
    g.appendChild(c);
    var label = document.createElementNS(NS, 'text');
    var pos = labelPos[n.id] || { dx: 0, dy: -(n.r || 7) - 8, anchor: 'middle' };
    label.setAttribute('x', n.x + pos.dx); label.setAttribute('y', n.y + pos.dy);
    label.setAttribute('text-anchor', pos.anchor);
    label.setAttribute('font-size', n.kind === 'event' ? '10' : '11');
    label.setAttribute('font-weight', n.kind === 'person' ? '600' : '500');
    label.setAttribute('fill', n.kind === 'event' ? '#0f766e' : C_FG);
    label.setAttribute('paint-order', 'stroke');
    label.setAttribute('stroke', '#fff'); label.setAttribute('stroke-width', '3');
    label.setAttribute('stroke-linejoin', 'round');
    // 事件节点太密（脱轨 38 个）：默认只显示圆点，hover 时显形——否则标签挤成一团遮住中心人物。
    var denseEvents = nodes.filter(function (x) { return x.kind === 'event'; }).length > 12;
    if (n.kind === 'event' && denseEvents && focus !== n.id) label.setAttribute('opacity', '0');
    label.textContent = n.kind === 'event' && n.label ? n.label : n.id;
    g.appendChild(label);
    var tip = document.createElementNS(NS, 'title');
    tip.textContent = (KIND_LABEL[n.kind] || '') + ' · ' + n.id + (degree[n.id] ? `（${degree[n.id]} 条关联）` : '');
    g.appendChild(tip);
    g.style.cursor = 'pointer';
    g.addEventListener('mouseenter', function () { halo.setAttribute('fill-opacity', '0.26'); c.setAttribute('r', (n.r || 7) + 1.8); label.setAttribute('opacity', '1'); });
    g.addEventListener('mouseleave', function () { halo.setAttribute('fill-opacity', '0.10'); c.setAttribute('r', n.r || 7); if (n.kind === 'event' && denseEvents && focus !== n.id) label.setAttribute('opacity', '0'); });
    g.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (focus === n.id) {
        if (n.kind === 'person') go('char', n.id);
        else if (n.kind === 'event' && n.no) go('chapter', n.no);
        else go('term', n.id);
      } else drawRelationGraph(n.id);
    });
    svg.appendChild(g);
  });
}

function vGraph() {
  var nodes = DETAIL.charGraph.nodes;
  var edges = DETAIL.charGraph.edges;
  var counts = {};
  nodes.forEach(function (n) { counts[n.kind] = (counts[n.kind] || 0) + 1; });
  var h = '<h1>知识图谱</h1><div class="meta">四类一等公民：'
    + KIND_ORDER.filter(function (k) { return counts[k]; }).map(function (k) { return KIND_LABEL[k] + ' ' + counts[k]; }).join(' · ')
    + ' · 边 ' + edges.length + ' 条（实线=关系/结构，虚线=同场共现）· 点节点聚焦邻域，再点进详情</div>';
  h += '<svg id="relSvg" class="relation"></svg><div id="relLegend" class="legend"></div>';
  return h;
}

function drawRelationGraph(focus) {
  var svg = document.getElementById('relSvg');
  if (!svg) return;
  svg.onclick = function (ev) { if (ev.target === svg && focus) drawRelationGraph(null); };
  var nodes = DETAIL.charGraph.nodes;
  var edges = DETAIL.charGraph.edges;
  var meta = document.querySelector('#view .meta');
  var fullMeta = meta ? meta.innerHTML : '';
  if (focus) {
    var nb = new Set([focus]);
    edges.forEach(function (e) { if (e.a === focus) nb.add(e.b); if (e.b === focus) nb.add(e.a); });
    nodes = nodes.filter(function (n) { return nb.has(n.id); });
    edges = edges.filter(function (e) { return nb.has(e.a) && nb.has(e.b); });
    if (meta) meta.innerHTML = '聚焦「' + escHtml(focus) + '」的邻域（' + nodes.length + ' 节点 / ' + edges.length + ' 边）——再点同节点进详情，点空白复位';
  } else {
    var degree = {};
    edges.forEach(function (e) { degree[e.a] = (degree[e.a] || 0) + 1; degree[e.b] = (degree[e.b] || 0) + 1; });
    // 只画有连接的节点（孤立节点在列表里看）；枢纽优先保留，上限 90
    nodes = nodes.filter(function (n) { return degree[n.id]; })
      .sort(function (a, b) { return (degree[b.id] || 0) - (degree[a.id] || 0); })
      .slice(0, 90);
    var keep = new Set(nodes.map(function (n) { return n.id; }));
    edges = edges.filter(function (e) { return keep.has(e.a) && keep.has(e.b); });
    if (meta) meta.innerHTML = fullMeta;
  }
  var lg = document.getElementById('relLegend');
  if (lg) {
    lg.innerHTML = KIND_ORDER.map(function (k) {
      return '<span><span class="dot" style="background:' + KIND_COLOR[k] + '"></span>' + KIND_LABEL[k] + '</span>';
    }).join('') + '<span style="margin-left:14px;color:' + C_MUTED + '">虚线=同场共现 · 事件节点点开进单章</span>';
  }
  forceLayout(svg, nodes, edges, { focus: focus || null });
}
/* ===== 主渲染分发 ===== */
function renderMain() {
  var v = document.getElementById('view');
  if (CUR.view === 'overview') v.innerHTML = vOverview();
  else if (CUR.view === 'slots') v.innerHTML = vSlots();
  else if (CUR.view === 'outline') v.innerHTML = vOutline();
  else if (CUR.view === 'timeline') v.innerHTML = vTimeline();
  else if (CUR.view === 'foreshadow') v.innerHTML = vForeshadow();
  else if (CUR.view === 'graph') v.innerHTML = vGraph();
  else if (CUR.view === 'char') v.innerHTML = vChar(CUR.name);
  else if (CUR.view === 'term') v.innerHTML = vTerm(CUR.name);
  else if (CUR.view === 'chapter') v.innerHTML = vChapter(Number(CUR.name));
  renderSide();
  // 图表在 innerHTML 落地后注入（SVG 要量实际容器宽）
  if (CUR.view === 'timeline') drawTimelineCharts();
  else if (CUR.view === 'graph') drawRelationGraph(null);
}

/* ===== 侧栏开关（移动端） ===== */
function toggleSide(force) {
  var s = document.getElementById('side'), m = document.getElementById('sideMask');
  var open = (force !== undefined) ? force : !s.classList.contains('open');
  s.classList.toggle('open', open);
  if (m) m.classList.toggle('on', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
document.getElementById('sideToggle').onclick = function () { toggleSide(); };
document.getElementById('sideMask').onclick = function () { toggleSide(false); };

/* ===== 全局点击分发（wiki-links） ===== */
document.addEventListener('click', function (ev) {
  var a = ev.target.closest ? ev.target.closest('[data-go]') : null;
  if (!a) return;
  ev.preventDefault();
  go(a.dataset.go, a.dataset.name || a.dataset.no || null);
});

renderMain();
