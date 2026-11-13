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

/** 人物×章 出场热力图（SVG 矩形阵列，委托悬停读数） */
function svgHeat(host, rowNames, values) {
  var W = Math.max(320, host.clientWidth - 32);
  var rows = rowNames.length, cols = values[0] ? values[0].length : 0;
  if (!rows || !cols) return;
  var H = rows * 22 + 46;
  var padL = 72, padT = 8;
  var cw = (W - padL - 10) / cols, chh = 22;
  var max = 1;
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) max = Math.max(max, values[r][c]);
  var cells = '', labels = '';
  for (var r2 = 0; r2 < rows; r2++) {
    labels += '<text x="' + (padL - 8) + '" y="' + (padT + r2 * chh + chh / 2 + 4) + '" text-anchor="end" font-size="11" fill="' + C_FG + '">' + escHtml(rowNames[r2]) + '</text>';
    for (var c2 = 0; c2 < cols; c2++) {
      var t = values[r2][c2] / max;
      var fill = t > 0 ? 'rgba(' + ACCENT_RGB + ',' + (0.10 + 0.82 * t).toFixed(3) + ')' : C_TRACK;
      cells += '<rect data-r="' + r2 + '" data-c="' + c2 + '" x="' + (padL + c2 * cw + 1).toFixed(1) + '" y="' + (padT + r2 * chh + 1).toFixed(1) + '" width="' + Math.max(1, cw - 2).toFixed(1) + '" height="' + (chh - 2) + '" rx="2" fill="' + fill + '"/>';
    }
  }
  var colLabels = '';
  var every = Math.ceil(cols / Math.max(4, Math.floor((W - padL) / 34)));
  for (var c3 = 0; c3 < cols; c3++) {
    if (c3 % every === 0 || c3 === cols - 1) {
      colLabels += '<text x="' + (padL + c3 * cw + cw / 2).toFixed(1) + '" y="' + (H - 22) + '" text-anchor="middle" font-size="10" fill="' + C_MUTED + '">' + DETAIL.chapters[c3].no + '</text>';
    }
  }
  var svg = '<svg id="heatSvg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible">'
    + cells + labels + colLabels + '</svg>';
  host.insertAdjacentHTML('beforeend', svg);
  var el = document.getElementById('heatSvg');
  el.onmousemove = function (ev) {
    var t2 = ev.target;
    if (!t2 || t2.dataset.r === undefined) return;
    var r3 = +t2.dataset.r, c4 = +t2.dataset.c;
    var hv = document.getElementById('mxHover');
    if (hv) {
      hv.textContent = rowNames[r3] + ' × 第' + DETAIL.chapters[c4].no + UNIT + ' · ' + values[r3][c4] + ' 段';
      hv.style.opacity = '1';
    }
  };
  el.onmouseleave = function () {
    var hv = document.getElementById('mxHover');
    if (hv) hv.style.opacity = '0.35';
  };
}

/* ===== 拆解报告（六槽位交付物） ===== */
function vSlots() {
  var S = D.slots;
  var h = '<h1>拆解报告</h1><div class="meta">对齐 author 拆书总协议（kb/deconstruct/protocol）六槽位 · 三态置信显式标注 · 引用≤40 字</div>';
  if (!S) return h + '<p class="sub">本书尚未跑六槽位增补（wiki-enrich@3）。</p>';
  // plot-design：阶段＋转折
  if (S.plotDesign) {
    h += '<h2>plot-design · 结构骨架</h2><div class="slotcard">';
    (S.plotDesign.stages || []).forEach(function (st) {
      h += '<div class="outline-ch"><h3>' + escHtml(st.phase) + (st.chapters && st.chapters.length ? '<span class="arc-range">第 ' + st.chapters[0] + '~' + st.chapters[st.chapters.length - 1] + ' ' + UNIT + '</span>' : '') + '</h3><div>' + escHtml(st.job || '') + '</div></div>';
    });
    if (S.plotDesign.turningPoints?.length) {
      h += '<h2 style="font-size:15px">转折点</h2><ul>' + S.plotDesign.turningPoints.map(function (tp) {
        return '<li><span class="tag">第' + tp.chapter + UNIT + '</span> ' + escHtml(tp.event) + '</li>';
      }).join('') + '</ul>';
    }
    h += '</div>';
  }
  // 文风九维
  if (S.style) {
    h += '<h2>文风画像（文学层·九维） <small>产物=可直接执行的写手规则</small></h2><div class="slotcard">';
    var dims = [['density', '情绪笔墨密度'], ['sentence', '句式与段落节奏'], ['pov', '视角与信息控制'], ['dialogue', '对话写法'], ['action', '动作写法'], ['character', '人物写法'], ['environment', '环境写法'], ['transition', '转场与时间'], ['ending', '章节收束']];
    h += '<table class="kv">';
    dims.forEach(function (d) {
      if (S.style[d[0]]) h += '<tr><td>' + d[1] + '</td><td>' + escHtml(S.style[d[0]]) + '</td></tr>';
    });
    h += '</table>';
    if (S.style.rules?.length) h += '<p style="margin:12px 0 0"><b>执行规则</b></p><ul>' + S.style.rules.map(function (r) { return '<li>' + escHtml(r) + '</li>'; }).join('') + '</ul>';
    h += '</div>';
  }
  // 高光片段（槽位 excerpt）
  var ex = D.excerpts || [];
  if (ex.length) {
    h += '<h2>excerpt · 高光片段（' + ex.length + '） <small>概括＋极短引用</small></h2>';
    ex.forEach(function (e) {
      h += '<div class="event"><span class="ch">第' + e.chapter + UNIT + '</span> <b>' + escHtml(e.beat) + '</b><div class="quote" style="margin-top:6px">“' + escHtml(e.quote) + '”</div></div>';
    });
  }
  // 状态台账（continuity：谁知道什么 / 关键物与关系终局）
  var L = D.ledger;
  if (L && (L.knowledgeLedger?.length || L.stateLedger?.length)) {
    h += '<h2>状态台账 <small>一致性与 OOC 判定的底表</small></h2><div class="slotcard">';
    if (L.knowledgeLedger?.length) {
      h += '<p style="margin:0 0 6px"><b>知情台账</b></p><table class="kv">';
      L.knowledgeLedger.forEach(function (item) {
        h += '<tr><td>' + escHtml(item.character) + '</td><td>知道 ' + escHtml(item.knows) + (item.chapter ? '<span class="arc-range">约第 ' + item.chapter + UNIT + '</span>' : '') + '</td></tr>';
      });
      h += '</table>';
    }
    if (L.stateLedger?.length) {
      h += '<p style="margin:12px 0 6px"><b>状态台账</b></p><table class="kv">';
      L.stateLedger.forEach(function (item) {
        h += '<tr><td>' + escHtml(item.object) + '</td><td>' + escHtml(item.state) + (item.chapter ? '<span class="arc-range">第 ' + item.chapter + UNIT + ' 确认</span>' : '') + '</td></tr>';
      });
      h += '</table>';
    }
    h += '</div>';
  }
  h += '<div id="dsFooter">槽位置信：gimmick ' + escHtml(S.gimmick?.confidence || '—') + ' / plot-design ' + escHtml(S.plotDesign?.structure?.confidence || '—') + ' / intro ' + escHtml(S.intro?.confidence || '—') + '</div>';
  return h;
}

/* ===== 侧边导航 ===== */
function renderSide() {
  var nav = [
    ['overview', '📊 概览'],
    ['slots', '📋 拆解报告'],
    ['outline', '📖 章节大纲'],
    ['matrix', '🧊 人物矩阵'],
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
  var top = -1, topV = 0;
  for (var r = 0; r < DETAIL.matrix.length; r++) {
    if (DETAIL.matrix[r][chIdx] > topV) { topV = DETAIL.matrix[r][chIdx]; top = r; }
  }
  if (top >= 0 && topV > 0) h += '<span class="chip">峰值 <b>' + escHtml(DETAIL.characters[top].name) + '</b> ' + topV + ' 段</span>';
  if (ch.newChars.length) h += '<span class="chip green">新登场 ' + escHtml(ch.newChars.slice(0, 3).join('、')) + '</span>';
  if (ch.foreshadow.length) h += '<span class="chip red">伏笔 +' + ch.foreshadow.length + '</span>';
  h += '<span class="chip">' + ch.events + ' 事件 / ' + ch.segments + ' 段</span>';
  return h + '</div>';
}

/* ===== KPI 卡片行（前半 vs 后半 delta，确定性） ===== */
function kpiCards() {
  var n = DETAIL.chapters.length;
  var evs = DETAIL.chapters.map(function (c) { return c.events; });
  var half = Math.floor(n / 2);
  var sum = function (arr, a, b) { var s = 0; for (var i = a; i < b; i++) s += arr[i]; return s; };
  var evTotal = sum(evs, 0, n);
  var ev1 = sum(evs, 0, half), ev2 = sum(evs, half, n);
  var evDelta = ev1 > 0 ? Math.round((ev2 - ev1) / ev1 * 100) : 0;
  var hooks = DETAIL.chapters.map(function (c) { return c.foreshadow.length; });
  var hookTotal = sum(hooks, 0, n);
  var h1v = sum(hooks, 0, half), h2v = sum(hooks, half, n);
  var hookDelta = h1v > 0 ? Math.round((h2v - h1v) / h1v * 100) : 0;
  // 后半新登场人物数
  var lateNew = 0;
  DETAIL.chapters.slice(half).forEach(function (c) { lateNew += c.newChars.length; });
  var chip = function (d, suffix) {
    if (d > 0) return '<span class="k-delta up">▲ ' + d + '%' + (suffix || '') + '</span>';
    if (d < 0) return '<span class="k-delta down">▼ ' + (-d) + '%' + (suffix || '') + '</span>';
    return '<span class="k-delta flat">前后半持平</span>';
  };
  var trace = DETAIL.quality.traceableRate;
  // 迷你折线（sparkline）：把序列压成 72×22 的 SVG 路径
  var spark = function (values, color) {
    if (!values.length) return '';
    var w = 72, hh = 22, max = Math.max.apply(null, values.concat([1])), min = Math.min.apply(null, values);
    var span = max - min || 1;
    var pts = values.map(function (v, i) {
      var x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
      return x.toFixed(1) + ',' + (hh - ((v - min) / span) * (hh - 3) - 1.5).toFixed(1);
    });
    return '<svg class="spark" width="' + w + '" height="' + hh + '" viewBox="0 0 ' + w + ' ' + hh + '">'
      + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<circle cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '" r="2" fill="' + color + '"/></svg>';
  };
  var appSeries = DETAIL.matrix.length ? DETAIL.matrix[0] : evs; // 主角在场曲线
  var hookSeries = hooks;
  return '<div class="kpis">'
    + '<div class="kpi"><div class="k-label">事件总量</div><div class="k-value">' + evTotal.toLocaleString() + '</div>' + chip(evDelta, ' · 后半 vs 前半') + spark(evs, 'var(--accent)') + '</div>'
    + '<div class="kpi"><div class="k-label">人物</div><div class="k-value">' + DETAIL.characters.length + '</div><span class="k-delta flat">后半新登场 ' + lateNew + ' 人</span>' + spark(appSeries, 'var(--warn)') + '</div>'
    + '<div class="kpi"><div class="k-label">伏笔</div><div class="k-value">' + hookTotal + '</div>' + chip(hookDelta, ' · 后半 vs 前半') + spark(hookSeries, 'var(--danger)') + '</div>'
    + '<div class="kpi"><div class="k-label">事件可溯源</div><div class="k-value">' + (trace != null ? (trace * 100).toFixed(1) + '%' : '—') + '</div><span class="k-delta flat">逐字对回原文</span></div>'
    + '</div>';
}

/* ===== 概览（数据面板） ===== */
function vOverview() {
  // 封面主视觉（编辑设计：书名衬线大字＋logline＋标签云＋暗色渐变）
  var g = (D.slots && D.slots.gimmick) || null;
  var h = '<section class="hero">';
  h += '<div class="h-eyebrow">世界书 · World Book' + (D.enrich.perspective ? ' · ' + escHtml(D.enrich.perspective.perspective) + ' 人称' : '') + '</div>';
  h += '<h1>' + escHtml(D.book.title) + '</h1>';
  h += '<div class="h-meta"><span><b>' + escHtml(D.book.author) + '</b></span><span><b>' + (D.book.words || 0).toLocaleString() + '</b> 字</span>'
    + '<span><b>' + D.chapters.length + '</b> ' + UNIT + '</span>'
    + '<span><b>' + D.characters.length + '</b> 人物</span>'
    + '<span><b>' + DETAIL.charGraph.edges.length + '</b> 关系边</span>'
    + '<span><b>' + (D.quality.traceableRate != null ? (D.quality.traceableRate * 100).toFixed(1) + '%' : '—') + '</b> 可溯源</span></div>';
  if (g && g.logline) h += '<div class="h-logline">' + escHtml(g.logline) + '</div>';
  else if (D.enrich.storySummary) h += '<div class="h-logline">' + escHtml(D.enrich.storySummary.slice(0, 110)) + '…</div>';
  if (g && g.elements && g.elements.length) h += '<div class="h-tags">' + g.elements.slice(0, 8).map(function (e) { return '<span>' + escHtml(e) + '</span>'; }).join('') + '</div>';
  h += '</section>';
  h += kpiCards();
  if (D.enrich.storySummary) h += '<h2>剧情梗概</h2><div class="summary">' + escHtml(D.enrich.storySummary) + '</div>';

  // 六槽位卡（kb/deconstruct/protocol：gimmick / plot-design / intro）
  var S = D.slots;
  if (S && S.gimmick) {
    h += '<h2>槽位 · gimmick（梗） <small>一句话卖点与情绪承诺</small></h2><div class="slotcard">';
    h += '<div class="logline">「' + escHtml(S.gimmick.logline) + '」</div>';
    if (S.gimmick.elements?.length) h += '<div style="margin:8px 0 0">' + S.gimmick.elements.map(function (e) { return '<span class="tag">' + escHtml(e) + '</span>'; }).join('') + '</div>';
    h += '<table class="kv"><tr><td>共情点</td><td>' + escHtml(S.gimmick.empathy || '—') + '</td></tr>'
      + '<tr><td>爽点内核</td><td>' + escHtml(S.gimmick.coolPoint || '—') + '</td></tr>'
      + '<tr><td>情绪承诺</td><td>' + escHtml(S.gimmick.emotionPromise || '—') + '</td></tr>'
      + '<tr><td>置信</td><td>' + escHtml(S.gimmick.confidence || '—') + '</td></tr></table></div>';
  }
  if (S && S.plotDesign) {
    h += '<h2>槽位 · plot-design（结构选型） <small>六母型 ＋ 章号证据</small></h2><div class="slotcard">';
    h += '<div class="logline" style="font-size:17px">' + escHtml(S.plotDesign.structure.picked) + '</div>';
    h += '<table class="kv"><tr><td>判定依据</td><td>' + escHtml(S.plotDesign.structure.evidence || '—') + '</td></tr>'
      + '<tr><td>主线</td><td>' + escHtml(S.plotDesign.mainline || '—') + '</td></tr>'
      + (S.plotDesign.subplot ? '<tr><td>支线</td><td>' + escHtml(S.plotDesign.subplot) + '</td></tr>' : '')
      + '<tr><td>置信</td><td>' + escHtml(S.plotDesign.structure.confidence || '—') + '</td></tr></table>';
    h += '<p class="sub">完整阶段/转折见 <a data-go="slots">拆解报告 →</a></p></div>';
  }
  if (S && S.intro) {
    h += '<h2>槽位 · intro（开局钩子）</h2><div class="slotcard">';
    h += '<table class="kv"><tr><td>切入</td><td>' + escHtml(S.intro.entry || '—') + '</td></tr>'
      + '<tr><td>钩子类型</td><td>' + escHtml(S.intro.hookType || '—') + '</td></tr>'
      + '<tr><td>第一拍</td><td>' + escHtml(S.intro.firstBeat || '—') + '</td></tr>'
      + '<tr><td>建立期待</td><td>' + escHtml(S.intro.expectation || '—') + '</td></tr></table></div>';
  }

  // 情绪带：每章核心情绪（细化层产出）
  var emoChapters = D.chapters.filter(function (c) { return c.emotion; });
  if (emoChapters.length) {
    var counts = {};
    emoChapters.forEach(function (c) { counts[c.emotion] = (counts[c.emotion] || 0) + 1; });
    h += '<h2>情绪曲线 <small>每' + UNIT + '核心情绪 · 悬停看章</small></h2><div class="sharebar" style="height:22px">';
    D.chapters.forEach(function (c) {
      var color = EMOTION_COLOR[c.emotion] || C_TRACK;
      h += '<span class="seg" style="width:' + (100 / D.chapters.length) + '%;background:' + color + '" title="第' + c.no + UNIT + ' · ' + escHtml(c.emotion || '—') + ' · ' + escHtml(c.title) + '"></span>';
    });
    h += '</div><div class="legend">';
    Object.keys(counts).forEach(function (emo) {
      h += '<span><span class="dot" style="background:' + (EMOTION_COLOR[emo] || C_MUTED) + '"></span>' + escHtml(emo) + ' × ' + counts[emo] + '</span>';
    });
    h += '</div>';
  }

  h += '<h2>节奏曲线 <small>每' + UNIT + '事件量 · 实线=事件量 · 虚线=滑动平均 · 点击跳单章</small></h2>';
  h += '<div class="chartbox"><div class="hover-read" id="paceHover">悬停查看读数</div></div>';

  // 屏份份额（环形图）
  var sorted = DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; });
  var totalApp = sorted.reduce(function (s, c) { return s + c.appearances; }, 0);
  var donutItems = sorted.slice(0, 8).map(function (c, i) { return ({ label: c.name, value: c.appearances, color: CATE[i] }); });
  if (sorted.length > 8) donutItems.push({ label: '其余 ' + (sorted.length - 8) + ' 人', value: totalApp - donutItems.reduce(function (s, it) { return s + it.value; }, 0), color: C_MUTED });
  h += '<h2>屏份份额 <small>出场段数占比</small></h2><div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap">';
  h += svgDonut(donutItems, '出场段');
  h += '<div class="legend" style="margin:0">';
  donutItems.forEach(function (it) {
    var pct = totalApp ? (it.value / totalApp * 100).toFixed(1) : '0';
    h += '<span><span class="dot" style="background:' + it.color + '"></span><a data-go="char" data-name="' + escHtml(it.label) + '">' + escHtml(it.label) + '</a> ' + pct + '%</span>';
  });
  h += '</div></div>';

  var hookCounts = DETAIL.chapters.map(function (c) { return c.foreshadow.length; });
  if (hookCounts.some(function (x) { return x > 0; })) {
    h += '<h2>伏笔密度 <small>每' + UNIT + '埋设条数</small></h2>';
    h += '<div class="chartbox"><div class="hover-read" id="hookHover">悬停查看读数</div></div>';
  }

  if (D.enrich.arc && D.enrich.arc.length) {
    h += '<h2>故事结构</h2>';
    D.enrich.arc.forEach(function (p) {
      h += '<div class="outline-ch"><h3>' + escHtml(p.phase) + (p.chapters && p.chapters.length ? '<span class="arc-range">第 ' + p.chapters[0] + '~' + p.chapters[p.chapters.length - 1] + ' ' + UNIT + '</span>' : '') + '</h3><div>' + escHtml(p.text) + '</div></div>';
    });
  }

  h += '<h2>人物榜 <small>按出场段数</small></h2>';
  var maxApp = sorted.length ? sorted[0].appearances : 1;
  h += hbarRows(sorted.slice(0, 10).map(function (c) {
    return { label: c.name, link: true, value: c.appearances, max: maxApp, sub: c.identity ? '· ' + c.identity : '' };
  }));
  if (sorted.length > 10) h += '<p class="sub">其余 ' + (sorted.length - 10) + ' 人见侧栏。</p>';

  h += '<h2>章纲速览 <small>前 ' + Math.min(8, D.chapters.length) + ' ' + UNIT + ' · 全量见章节大纲</small></h2>';
  D.chapters.slice(0, 8).forEach(function (c) {
    h += '<div class="outline-ch"><h3><a data-go="chapter" data-no="' + c.no + '">' + escHtml(c.title) + '</a></h3>';
    if (c.summary) h += '<div class="summary">' + escHtml(c.summary) + '</div>';
    h += sectionChips(c.no);
    h += '<div>' + c.chars.slice(0, 8).map(function (n) { return charLink(n); }).join(' ') + '</div></div>';
  });
  if (D.chapters.length > 8) h += '<p><a data-go="outline">查看全部 ' + D.chapters.length + ' ' + UNIT + '大纲 →</a></p>';
  h += '<div id="dsFooter">Design System: ' + escHtml((DETAIL.ds && DETAIL.ds.title) || 'Dashboard') + ' · ' + escHtml((DETAIL.ds && DETAIL.ds.source) || 'embedded') + ' · 图表 inline SVG（OpenDesign dashboard skill 约定）</div>';
  return h;
}

function drawOverviewCharts() {
  var paceHost = document.querySelector('#view .chartbox');
  if (paceHost) {
    svgAreaChart(paceHost, DETAIL.chapters.map(function (c) { return c.events; }), {
      height: 200, svgId: 'paceSvg', hoverEl: document.getElementById('paceHover'), unitLabel: ' 事件',
      onClickIdx: function (i) { go('chapter', DETAIL.chapters[i].no); }
    });
  }
  var hookBox = document.getElementById('hookHover');
  if (hookBox && hookBox.parentElement) {
    svgBars(hookBox.parentElement, DETAIL.chapters.map(function (c) { return c.foreshadow.length; }), {
      height: 150, color: C_DANGER, svgId: 'hookSvg', hoverEl: hookBox, unitLabel: ' 条伏笔',
      onClickIdx: function (i) { go('foreshadow'); }
    });
  }
}

/* ===== 人物页 ===== */
function vChar(name) {
  var c = CHARS[name];
  if (!c) return '<p>人物不存在</p>';
  var h = '<h1>' + escHtml(c.name) + '</h1>';
  h += '<div class="meta"><span>' + c.appearances + ' 段出场</span>' + (c.chapters.length ? '<span>第 ' + c.chapters[0] + (c.chapters[c.chapters.length - 1] !== c.chapters[0] ? '~' + c.chapters[c.chapters.length - 1] : '') + ' ' + UNIT + '</span>' : '') + (c.castTier ? '<span>剧作档：' + escHtml(c.castTier) + '</span>' : '') + '</div>';
  if (c.aliases.length) h += '<div>' + c.aliases.map(function (a) { return '<span class="tag">别名：' + escHtml(a) + '</span>'; }).join('') + '</div>';
  if (c.identity) h += '<h2>身份</h2><p>' + escHtml(c.identity) + '</p>';
  if (c.goal) h += '<div class="summary" style="margin:10px 0"><b>动机：</b>' + escHtml(c.goal) + '</div>';
  // 人物卡（kb/deconstruct/protocol 槽位 character）：模式/弧光/关键选择/镜像
  if (c.archetype) h += '<p><span class="chip" style="background:color-mix(in srgb,' + C_WARN + ' 14%,transparent);color:' + C_WARN + ';border-color:transparent">人设模式 ' + escHtml(c.archetype) + '</span></p>';
  if (c.summary) h += '<h2>人物小传</h2><div class="summary">' + escHtml(c.summary) + '</div>';
  if (c.arc && (c.arc.start || c.arc.end)) {
    h += '<h2>人物弧光 <small>起点 → 终点</small></h2><div class="slotcard">';
    h += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:14px">'
      + '<span>' + escHtml(c.arc.start || '—') + '</span>'
      + '<span style="color:' + C_ACCENT + ';font-weight:700">→</span>'
      + '<span>' + escHtml(c.arc.end || '—') + '</span>'
      + (c.arc.turnChapter ? '<span class="tag">转变于第 ' + c.arc.turnChapter + UNIT + '</span>' : '') + '</div>';
    if (c.arc.evidence) h += '<p class="sub" style="margin:8px 0 0">依据：' + escHtml(c.arc.evidence) + '</p>';
    h += '</div>';
  }
  if (c.keyChoices.length) {
    h += '<h2>关键选择 <small>带章号证据</small></h2><ul>' + c.keyChoices.map(function (k) {
      return '<li><span class="tag">第' + k.chapter + UNIT + '</span> ' + escHtml(k.choice) + '</li>';
    }).join('') + '</ul>';
  }
  if (c.mirror) h += '<h2>镜像关系</h2><p>' + escHtml(c.mirror) + '</p>';
  if (c.personality.length) h += '<h2>性格</h2><div>' + c.personality.map(function (w) { return '<span class="tag warm">' + escHtml(w) + '</span>'; }).join('') + '</div>';

  // 出场节奏（个人面积图）
  h += '<h2>出场节奏 <small>逐' + UNIT + '在场段数 · 点击跳单章</small></h2>';
  h += '<div class="chartbox"><div class="hover-read" id="charHover">悬停查看读数</div></div>';

  // 人物画像：五维雷达（相对全书最大值）＋渠道构成环形
  var ch2 = DETAIL.channels[c.__idx] || ({ say: 0, do: 0, other: 0 });
  var chTotal = ch2.say + ch2.do + ch2.other;
  h += '<h2>人物画像 <small>五维相对全书峰值 · 渠道构成</small></h2>';
  h += '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">';
  h += '<div id="radarBox" style="flex:none"></div>';
  if (chTotal > 0) {
    h += '<div style="flex:1;min-width:220px">';
    h += svgDonut([
      { label: '台词', value: ch2.say, color: C_SUCCESS },
      { label: '行为', value: ch2.do, color: C_WARN },
      { label: '其他', value: ch2.other, color: C_MUTED }
    ], '次行为');
    var mx = Math.max(ch2.say, ch2.do, ch2.other, 1);
    h += '<div class="hbars" style="margin-top:10px">';
    h += hbarRows([
      { label: '台词', value: ch2.say, max: mx, color: C_SUCCESS },
      { label: '行为', value: ch2.do, max: mx, color: C_WARN },
      { label: '其他', value: ch2.other, max: mx, color: C_MUTED }
    ]);
    h += '</div></div>';
  }
  h += '</div>';

  // 关系
  if (c.edges.length) h += '<h2>关系</h2><ul>' + c.edges.map(function (e) {
    return '<li>' + (e.dir === 'out' ? '→' : '←') + ' ' + charLink(e.other) + ' <span class="tag">' + escHtml(e.type) + '</span>' + (e.how ? ' <span class="sub">' + escHtml(e.how) + '</span>' : '') + '</li>';
  }).join('') + '</ul>';

  // 同场人物
  if (c.cooccur.length) {
    h += '<h2>同场人物 <small>共现段数</small></h2>';
    var coMax = c.cooccur[0][1] || 1;
    h += hbarRows(c.cooccur.slice(0, 8).map(function (p) {
      return { label: p[0], link: true, value: p[1], max: coMax };
    }));
  }

  if (c.speechTotal > 0) {
    h += '<details class="drill"><summary>台词 · 共 ' + c.speechTotal + ' 条（点开看原文摘录）</summary>'
      + c.speech.map(function (s) { return '<div class="quote">“' + escHtml(s) + '”</div>'; }).join('') + '</details>';
  }
  if (c.behavior.length) {
    h += '<details class="drill"><summary>行为记录 · 摘 ' + c.behavior.length + ' 条（点开看原文）</summary>'
      + '<ul>' + c.behavior.map(function (s) { return '<li>' + escHtml(s) + '</li>'; }).join('') + '</ul></details>';
  }
  return h;
}

function drawCharCharts(name) {
  var c = CHARS[name];
  var host = document.querySelector('#view .chartbox');
  if (!c || !host) return;
  var row = DETAIL.matrix[c.__idx];
  svgAreaChart(host, row, {
    height: 170, color: C_WARN, svgId: 'charSvg', hoverEl: document.getElementById('charHover'), unitLabel: ' 段在场',
    onClickIdx: function (i) { go('chapter', DETAIL.chapters[i].no); }
  });
  // 五维雷达：台词/行为/覆盖章/关系/同场对象，各自对全书峰值归一
  var radarBox = document.getElementById('radarBox');
  if (radarBox) {
    var maxOf = function (pick) {
      var m = 1;
      DETAIL.characters.forEach(function (p) { m = Math.max(m, pick(p)); });
      return m;
    };
    var sayMax = maxOf(function (p) { return (DETAIL.channels[p.__idx] || {}).say || 0; });
    var doMax = maxOf(function (p) { return (DETAIL.channels[p.__idx] || {}).do || 0; });
    var covMax = maxOf(function (p) { return p.chapters.length; });
    var edgeMax = maxOf(function (p) { return p.edges.length; });
    var coMax2 = maxOf(function (p) { return p.cooccur.length; });
    radarBox.insertAdjacentHTML('beforeend', svgRadar([
      { label: '台词', value: (DETAIL.channels[c.__idx] || {}).say || 0, max: sayMax },
      { label: '行为', value: (DETAIL.channels[c.__idx] || {}).do || 0, max: doMax },
      { label: '覆盖章', value: c.chapters.length, max: covMax },
      { label: '关系', value: c.edges.length, max: edgeMax },
      { label: '同场', value: c.cooccur.length, max: coMax2 }
    ]));
  }
}

/* ===== 横条榜 ===== */
function hbarRows(rows) {
  var h = '';
  rows.forEach(function (row) {
    var pct = row.max > 0 ? Math.round(row.value / row.max * 100) : 0;
    h += '<div class="hbar"><span class="hb-label">' + (row.link ? charLink(row.label) : escHtml(row.label)) + '</span>'
      + '<span class="hb-track"><span class="hb-fill" style="width:' + pct + '%;background:' + (row.color || C_ACCENT) + '"></span></span>'
      + '<span class="hb-val">' + row.value + (row.sub ? '<em>' + escHtml(row.sub) + '</em>' : '') + '</span></div>';
  });
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
  var h = '<h1>' + escHtml(c.title) + '</h1>';
  h += '<div class="meta"><span>' + c.segments + ' 段</span><span>' + c.events + ' 事件</span></div>';
  if (c.summary) h += '<div class="summary">' + escHtml(c.summary) + '</div>';
  h += sectionChips(no);
  if (c.foreshadow.length) h += '<h2>本章伏笔</h2><ul>' + c.foreshadow.map(function (f) { return '<li>' + escHtml(f) + '</li>'; }).join('') + '</ul>';
  h += '<details class="drill" open><summary>原始事件流 · ' + c.events + ' 条（钻取层）</summary>';
  DETAIL.timeline.filter(function (t) { return t.no === Number(no); }).forEach(function (t) {
    t.events.forEach(function (e) {
      h += '<div class="event"><span class="who">' + escHtml(e.who || '—') + '</span> <span class="ch">[' + escHtml(e.channel) + ']</span><div>' + escHtml(e.text) + '</div></div>';
    });
  });
  return h + '</details>';
}

/* ===== 时间线 ===== */
function vTimeline() {
  var h = '<h1>时间线</h1><div class="meta">' + D.chapters.length + ' ' + UNIT + '，事件按章序归并——曲线上点击任意点直达该章</div>';
  h += '<div class="chartbox"><div class="hover-read" id="tlHover">悬停查看读数</div></div>';
  DETAIL.timeline.forEach(function (t) {
    h += '<details class="drill" id="tl-' + t.no + '"><summary>第 ' + t.no + ' ' + UNIT + ' · ' + escHtml(t.title) + ' · ' + t.events.length + ' 事件</summary>';
    t.events.forEach(function (e) {
      h += '<div class="event"><span class="who">' + escHtml(e.who || '—') + '</span> <span class="ch">[' + escHtml(e.channel) + ']</span><div>' + escHtml(e.text) + '</div></div>';
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
function vMatrix() {
  var h = '<h1>人物矩阵</h1><div class="meta">人物 × ' + UNIT + ' 的出场段数热力图——颜色越亮在场越强；悬停读数</div>';
  h += '<div class="chartbox" style="padding:16px"><div class="hover-read" id="mxHover">悬停查看读数</div></div>';
  h += '<h2>读图指南</h2><ul class="sub" style="color:var(--muted)">'
    + '<li>整行全亮＝全程在场（主线人物）；亮块集中＝阶段人物；零星亮点＝过客。</li>'
    + '<li>列方向看剧情密度：亮列＝群像' + UNIT + '，暗列＝独角戏。</li>'
    + '</ul>';
  return h;
}

function drawMatrix() {
  var host = document.getElementById('mxHover');
  if (!host) return;
  var order = DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; }).slice(0, 24);
  svgHeat(host.parentElement, order.map(function (c) { return c.name; }), order.map(function (c) { return DETAIL.matrix[c.__idx]; }));
}

/* ===== 伏笔 ===== */
function vForeshadow() {
  var all = [];
  DETAIL.chapters.forEach(function (c) {
    c.foreshadow.forEach(function (f) { all.push({ no: c.no, text: f }); });
  });
  var h = '<h1>伏笔（' + all.length + '）</h1>';
  if (!all.length) return h + '<p class="sub">本书增补窄窗未归纳出伏笔（或原文确实没有明显伏笔）。</p>';
  h += '<div class="chartbox"><div class="hover-read" id="fsHover">悬停查看读数</div></div>';
  h += '<ul>';
  all.forEach(function (f) { h += '<li><span class="tag">第' + f.no + UNIT + '</span> ' + escHtml(f.text) + '</li>'; });
  return h + '</ul>';
}

function drawForeshadowCharts() {
  var host = document.querySelector('#view .chartbox');
  if (!host) return;
  svgBars(host, DETAIL.chapters.map(function (c) { return c.foreshadow.length; }), {
    height: 150, color: C_DANGER, svgId: 'fsSvg', hoverEl: document.getElementById('fsHover'), unitLabel: ' 条伏笔'
  });
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
  else if (CUR.view === 'matrix') v.innerHTML = vMatrix();
  else if (CUR.view === 'timeline') v.innerHTML = vTimeline();
  else if (CUR.view === 'foreshadow') v.innerHTML = vForeshadow();
  else if (CUR.view === 'graph') v.innerHTML = vGraph();
  else if (CUR.view === 'char') v.innerHTML = vChar(CUR.name);
  else if (CUR.view === 'term') v.innerHTML = vTerm(CUR.name);
  else if (CUR.view === 'chapter') v.innerHTML = vChapter(Number(CUR.name));
  renderSide();
  // 图表在 innerHTML 落地后注入（SVG 要量实际容器宽）
  if (CUR.view === 'overview') drawOverviewCharts();
  else if (CUR.view === 'timeline') drawTimelineCharts();
  else if (CUR.view === 'matrix') drawMatrix();
  else if (CUR.view === 'foreshadow') drawForeshadowCharts();
  else if (CUR.view === 'char') drawCharCharts(CUR.name);
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
