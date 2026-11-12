/* 世界书数据面板 SPA（作者 2026-11-13 裁定：不当数据库呈现，要面板＋矩形曲线＋可视化）。
 * 运行环境：单文件 HTML 内嵌，全局依赖 DETAIL（由 build-wiki.mjs 注入）。
 * 原则：图表与归纳为主，原始列表降级为 <details> 钻取层；全部确定性派生，零外部依赖。
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
var PALETTE = ['#7aa2ff', '#ffb454', '#7ddc9a', '#ff7a8a', '#b48cff', '#4fd2c2', '#f2d549', '#5eead4'];

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

/* ===== 图表工具（零依赖；canvas 按 DPR 缩放保证清晰） ===== */
var C_ACCENT = '#7aa2ff', C_GRID = '#2a2f3d', C_DIM = '#9aa3b5';

function prepCanvas(cv, h) {
  var dpr = window.devicePixelRatio || 1;
  cv.style.width = '100%'; cv.style.display = 'block';
  // 先铺 100% 再量（否则 clientWidth 是 canvas 默认 300）
  var w = Math.max(220, Math.round(cv.getBoundingClientRect().width) || cv.parentElement.clientWidth || 860);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.height = h + 'px';
  var ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, w: w, h: h };
}

/** 矩形柱状曲线（可悬停/点击）。values=[{v, xl}]，opts={height, onClick(i), hoverEl, color} */
function barCurve(cv, values, opts) {
  opts = opts || {};
  var box = prepCanvas(cv, opts.height || 150);
  var ctx = box.ctx, W = box.w, H = box.h;
  var pad = { l: 10, r: 10, t: 12, b: 20 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var n = values.length;
  if (!n) return;
  var max = Math.max.apply(null, values.map(function (v) { return v.v; }).concat([1]));
  var step = iw / n, bw = Math.max(2, Math.min(38, step * 0.62));
  ctx.clearRect(0, 0, W, H);
  // 横网格（3 条）＋右对标值
  ctx.strokeStyle = C_GRID; ctx.lineWidth = 1;
  ctx.fillStyle = C_DIM; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
  for (var g = 0; g <= 2; g++) {
    var gy = pad.t + ih - (ih * g / 2);
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke();
    if (g > 0) ctx.fillText(String(Math.round(max * g / 2)), W - pad.r + 2, gy + 3);
  }
  // 柱
  for (var i = 0; i < n; i++) {
    var x = pad.l + i * step + (step - bw) / 2;
    var bh = Math.max(1, values[i].v / max * ih);
    var y = pad.t + ih - bh;
    var grad = ctx.createLinearGradient(0, y, 0, pad.t + ih);
    var c = opts.color || C_ACCENT;
    grad.addColorStop(0, c); grad.addColorStop(1, c + '33');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, bw, bh);
  }
  // x 轴稀疏标注
  var every = Math.ceil(n / 14);
  ctx.textAlign = 'center';
  for (var j = 0; j < n; j++) {
    // 末柱只在恰好落在标注步点上才画（否则与前一标注重叠）
    if (j % every === 0 || (j === n - 1 && n % every === 1)) {
      ctx.fillStyle = C_DIM;
      ctx.fillText(values[j].xl != null ? String(values[j].xl) : String(j + 1), pad.l + j * step + step / 2, H - 6);
    }
  }
  // 悬停读数 + 点击跳转
  cv.onmousemove = function (ev) {
    var r = cv.getBoundingClientRect();
    var idx = Math.floor((ev.clientX - r.left - pad.l) / step);
    if (opts.hoverEl) {
      if (idx >= 0 && idx < n) {
        opts.hoverEl.textContent = values[idx].hover || ('第' + values[idx].xl + UNIT + ' · ' + values[idx].v);
        opts.hoverEl.style.opacity = '1';
      } else { opts.hoverEl.style.opacity = '0.35'; }
    }
  };
  cv.onmouseleave = function () { if (opts.hoverEl) opts.hoverEl.style.opacity = '0.35'; };
  cv.onclick = function (ev) {
    var r = cv.getBoundingClientRect();
    var idx = Math.floor((ev.clientX - r.left - pad.l) / step);
    if (idx >= 0 && idx < n && opts.onClick) opts.onClick(idx);
  };
}

/** 人物×章 出场热力图。values[行][列]=段数；hoverEl 实时读数 */
function heatCanvas(cv, rowNames, colLabels, values, opts) {
  opts = opts || {};
  var box = prepCanvas(cv, opts.height || 420);
  var ctx = box.ctx, W = box.w, H = box.h;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px sans-serif';
  var labW = 0;
  rowNames.forEach(function (name) { labW = Math.max(labW, ctx.measureText(name).width); });
  labW = Math.min(96, labW + 10);
  var padT = 16, padB = 18;
  var rows = rowNames.length, cols = colLabels.length;
  if (!rows || !cols) return;
  var cw = (W - labW - 8) / cols, chh = (H - padT - padB) / rows;
  var max = 1;
  for (var r = 0; r < rows; r++) for (var c2 = 0; c2 < cols; c2++) max = Math.max(max, values[r][c2]);
  for (var r2 = 0; r2 < rows; r2++) {
    ctx.fillStyle = '#d5dded'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(rowNames[r2], labW - 6, padT + r2 * chh + chh / 2);
    for (var c3 = 0; c3 < cols; c3++) {
      var t = values[r2][c3] / max;
      ctx.fillStyle = t > 0 ? 'rgba(122,162,255,' + (0.14 + 0.74 * t).toFixed(3) + ')' : 'rgba(42,47,61,0.5)';
      ctx.fillRect(labW + c3 * cw + 1, padT + r2 * chh + 1, Math.max(1, cw - 2), Math.max(1, chh - 2));
    }
  }
  // 列标注（稀疏）
  ctx.fillStyle = C_DIM; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  var every = Math.ceil(cols / Math.max(4, Math.floor((W - labW) / 34)));
  for (var c4 = 0; c4 < cols; c4++) {
    if (c4 % every === 0 || c4 === cols - 1) ctx.fillText(String(colLabels[c4]), labW + c4 * cw + cw / 2, H - padB + 4);
  }
  cv.onmousemove = function (ev) {
    if (!opts.hoverEl) return;
    var rect = cv.getBoundingClientRect();
    var c5 = Math.floor((ev.clientX - rect.left - labW) / cw);
    var r5 = Math.floor((ev.clientY - rect.top - padT) / chh);
    if (c5 >= 0 && c5 < cols && r5 >= 0 && r5 < rows) {
      opts.hoverEl.textContent = rowNames[r5] + ' × 第' + colLabels[c5] + UNIT + ' · ' + values[r5][c5] + ' 段';
      opts.hoverEl.style.opacity = '1';
    } else { opts.hoverEl.style.opacity = '0.35'; }
  };
  cv.onmouseleave = function () { if (opts.hoverEl) opts.hoverEl.style.opacity = '0.35'; };
}

/** 横向条（DOM 版，用于榜单）。rows=[{label, value, max, color, sub}] */
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

/* ===== 侧边导航 ===== */
function renderSide() {
  var nav = [
    ['overview', '📊 概览'],
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

/* ===== 章解读 chips（确定性归纳：峰值人物/新登场/伏笔/事件） ===== */
function sectionChips(no) {
  var chIdx = -1;
  for (var i = 0; i < DETAIL.chapters.length; i++) { if (DETAIL.chapters[i].no === no) { chIdx = i; break; } }
  if (chIdx < 0) return '';
  var h = '<div class="chips">';
  // 峰值人物：该章 matrix 列最大者
  var top = -1, topV = 0;
  for (var r = 0; r < DETAIL.matrix.length; r++) {
    if (DETAIL.matrix[r][chIdx] > topV) { topV = DETAIL.matrix[r][chIdx]; top = r; }
  }
  if (top >= 0 && topV > 0) h += '<span class="chip">峰值 <b>' + escHtml(DETAIL.characters[top].name) + '</b> ' + topV + ' 段</span>';
  var ch = DETAIL.chapters[chIdx];
  if (ch.newChars.length) h += '<span class="chip green">新登场 ' + escHtml(ch.newChars.slice(0, 3).join('、')) + '</span>';
  if (ch.foreshadow.length) h += '<span class="chip red">伏笔 +' + ch.foreshadow.length + '</span>';
  h += '<span class="chip">' + ch.events + ' 事件 / ' + ch.segments + ' 段</span>';
  return h + '</div>';
}

/* ===== 概览（数据面板） ===== */
function vOverview() {
  var h = '<h1>' + escHtml(D.book.title) + ' · 世界书</h1>';
  h += '<div class="meta"><span>' + escHtml(D.book.author) + '</span><span>' + D.book.words + ' 字</span><span>' + escHtml(D.book.group) + '</span><span>' + D.chapters.length + ' ' + UNIT + '</span>' + (D.enrich.perspective ? '<span>视角：' + escHtml(D.enrich.perspective.perspective) + '</span>' : '') + '</div>';
  if (D.enrich.storySummary) h += '<h2>剧情梗概</h2><div class="summary">' + escHtml(D.enrich.storySummary) + '</div>';

  // ① 节奏曲线：每章事件量（悬停读数，点击跳章）
  h += '<h2>节奏曲线 <small>每' + UNIT + '事件量 · 点击跳转单章</small></h2>';
  h += '<div class="chartbox"><div class="hover-read" id="paceHover">悬停查看读数</div><canvas id="paceChart"></canvas></div>';

  // ② 屏份份额：人物出场占比
  var totalApp = 0;
  DETAIL.characters.forEach(function (c) { totalApp += c.appearances; });
  h += '<h2>屏份份额 <small>出场段数占比</small></h2><div class="sharebar">';
  var sorted = DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; });
  sorted.forEach(function (c, i) {
    var pct = totalApp ? (c.appearances / totalApp * 100) : 0;
    if (pct <= 0) return;
    h += '<span class="seg" style="width:' + Math.max(0.6, pct) + '%;background:' + PALETTE[i % PALETTE.length] + '" title="' + escHtml(c.name) + ' · ' + pct.toFixed(1) + '%"></span>';
  });
  h += '</div><div class="legend" id="shareLegend">';
  sorted.slice(0, 8).forEach(function (c, i) {
    var pct = totalApp ? (c.appearances / totalApp * 100).toFixed(1) : '0';
    h += '<span><span class="dot" style="background:' + PALETTE[i % PALETTE.length] + '"></span>' + escHtml(c.name) + ' ' + pct + '%</span>';
  });
  if (sorted.length > 8) h += '<span><span class="dot" style="background:#3a4152"></span>其余 ' + (sorted.length - 8) + ' 人</span>';
  h += '</div>';

  // ③ 伏笔密度
  var hookCounts = DETAIL.chapters.map(function (c) { return ({ v: c.foreshadow.length, xl: c.no }); });
  if (hookCounts.some(function (x) { return x.v > 0; })) {
    h += '<h2>伏笔密度 <small>每' + UNIT + '埋设条数</small></h2>';
    h += '<div class="chartbox"><div class="hover-read" id="hookHover">悬停查看读数</div><canvas id="hookChart"></canvas></div>';
  }

  // ④ 故事结构
  if (D.enrich.arc && D.enrich.arc.length) {
    h += '<h2>故事结构</h2>';
    D.enrich.arc.forEach(function (p) {
      h += '<div class="outline-ch"><h3>' + escHtml(p.phase) + (p.chapters && p.chapters.length ? '<span class="arc-range">第 ' + p.chapters[0] + '~' + p.chapters[p.chapters.length - 1] + ' ' + UNIT + '</span>' : '') + '</h3><div>' + escHtml(p.text) + '</div></div>';
    });
  }

  // ⑤ 人物榜（横条）
  h += '<h2>人物榜 <small>按出场段数</small></h2>';
  var maxApp = sorted.length ? sorted[0].appearances : 1;
  h += hbarRows(sorted.slice(0, 10).map(function (c) {
    return { label: c.name, link: true, value: c.appearances, max: maxApp, sub: c.identity ? '· ' + c.identity : '' };
  }));
  if (sorted.length > 10) h += '<p class="sub">其余 ' + (sorted.length - 10) + ' 人见侧栏。</p>';

  // ⑥ 章纲速览（前 8 章，全量在「章节大纲」）
  h += '<h2>章纲速览 <small>前 ' + Math.min(8, D.chapters.length) + ' ' + UNIT + ' · 全量见章节大纲</small></h2>';
  D.chapters.slice(0, 8).forEach(function (c) {
    h += '<div class="outline-ch"><h3><a data-go="chapter" data-no="' + c.no + '">' + escHtml(c.title) + '</a></h3>';
    if (c.summary) h += '<div class="summary">' + escHtml(c.summary) + '</div>';
    h += sectionChips(c.no);
    h += '<div>' + c.chars.slice(0, 8).map(function (n) { return charLink(n); }).join(' ') + '</div></div>';
  });
  if (D.chapters.length > 8) h += '<p><a data-go="outline">查看全部 ' + D.chapters.length + ' ' + UNIT + '大纲 →</a></p>';
  return h;
}

function drawOverviewCharts() {
  var paceCv = document.getElementById('paceChart');
  if (paceCv) {
    barCurve(paceCv, DETAIL.chapters.map(function (c) { return ({ v: c.events, xl: c.no }); }), {
      height: 160, hoverEl: document.getElementById('paceHover'),
      onClick: function (i) { go('chapter', DETAIL.chapters[i].no); }
    });
  }
  var hookCv = document.getElementById('hookChart');
  if (hookCv) {
    barCurve(hookCv, DETAIL.chapters.map(function (c) { return ({ v: c.foreshadow.length, xl: c.no }); }), {
      height: 120, color: '#ff7a8a', hoverEl: document.getElementById('hookHover'),
      onClick: function (i) { go('foreshadow'); }
    });
  }
}

/* ===== 人物页（含个人曲线与渠道构成） ===== */
function vChar(name) {
  var c = CHARS[name];
  if (!c) return '<p>人物不存在</p>';
  var h = '<h1>' + escHtml(c.name) + '</h1>';
  h += '<div class="meta"><span>' + c.appearances + ' 段出场</span>' + (c.chapters.length ? '<span>第 ' + c.chapters[0] + (c.chapters[c.chapters.length - 1] !== c.chapters[0] ? '~' + c.chapters[c.chapters.length - 1] : '') + ' ' + UNIT + '</span>' : '') + (c.castTier ? '<span>剧作档：' + escHtml(c.castTier) + '</span>' : '') + '</div>';
  if (c.aliases.length) h += '<div>' + c.aliases.map(function (a) { return '<span class="tag">别名：' + escHtml(a) + '</span>'; }).join('') + '</div>';
  if (c.identity) h += '<h2>身份</h2><p>' + escHtml(c.identity) + '</p>';
  if (c.summary) h += '<h2>人物小传</h2><div class="summary">' + escHtml(c.summary) + '</div>';
  if (c.personality.length) h += '<h2>性格</h2><div>' + c.personality.map(function (w) { return '<span class="tag warm">' + escHtml(w) + '</span>'; }).join('') + '</div>';

  // 出场节奏（个人曲线）
  h += '<h2>出场节奏 <small>逐' + UNIT + '在场段数</small></h2>';
  h += '<div class="chartbox"><div class="hover-read" id="charHover">悬停查看读数</div><canvas id="charCurve"></canvas></div>';

  // 渠道构成（言行占比）
  var ch2 = DETAIL.channels[c.__idx] || ({ say: 0, do: 0, other: 0 });
  var chTotal = ch2.say + ch2.do + ch2.other;
  if (chTotal > 0) {
    h += '<h2>渠道构成 <small>共 ' + chTotal + ' 次标注行为</small></h2><div class="hbars">';
    var mx = Math.max(ch2.say, ch2.do, ch2.other, 1);
    h += hbarRows([
      { label: '台词', value: ch2.say, max: mx, color: '#7ddc9a' },
      { label: '行为', value: ch2.do, max: mx, color: '#ffb454' },
      { label: '其他', value: ch2.other, max: mx, color: '#9aa3b5' }
    ]);
    h += '</div>';
  }

  // 关系
  if (c.edges.length) h += '<h2>关系</h2><ul>' + c.edges.map(function (e) {
    return '<li>' + (e.dir === 'out' ? '→' : '←') + ' ' + charLink(e.other) + ' <span class="tag">' + escHtml(e.type) + '</span>' + (e.how ? ' <span class="sub">' + escHtml(e.how) + '</span>' : '') + '</li>';
  }).join('') + '</ul>';

  // 同场人物（横条）
  if (c.cooccur.length) {
    h += '<h2>同场人物 <small>共现段数</small></h2>';
    var coMax = c.cooccur[0][1] || 1;
    h += hbarRows(c.cooccur.slice(0, 8).map(function (p) {
      return { label: p[0], link: true, value: p[1], max: coMax };
    }));
  }

  // 台词/行为：归纳计数在前，原文钻取在 <details>
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
  var cv = document.getElementById('charCurve');
  if (!c || !cv) return;
  var row = DETAIL.matrix[c.__idx];
  barCurve(cv, row.map(function (v, i) { return ({ v: v, xl: DETAIL.chapters[i].no, hover: '第' + DETAIL.chapters[i].no + UNIT + ' · ' + v + ' 段在场' }); }), {
    height: 110, color: '#ffb454', hoverEl: document.getElementById('charHover'),
    onClick: function (i) { go('chapter', DETAIL.chapters[i].no); }
  });
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

/* ===== 时间线（图在上、事件流钻取在下） ===== */
function vTimeline() {
  var h = '<h1>时间线</h1><div class="meta">' + D.chapters.length + ' ' + UNIT + '，事件按章序归并——曲线上点击任意柱直达该章</div>';
  h += '<div class="chartbox"><div class="hover-read" id="tlHover">悬停查看读数</div><canvas id="tlChart"></canvas></div>';
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
  var cv = document.getElementById('tlChart');
  if (!cv) return;
  barCurve(cv, DETAIL.chapters.map(function (c) { return ({ v: c.events, xl: c.no }); }), {
    height: 160, hoverEl: document.getElementById('tlHover'),
    onClick: function (i) {
      var no = DETAIL.chapters[i].no;
      var el = document.getElementById('tl-' + no);
      if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  });
}

/* ===== 人物矩阵（热力图） ===== */
function vMatrix() {
  var h = '<h1>人物矩阵</h1><div class="meta">人物 × ' + UNIT + ' 的出场段数热力图——颜色越亮在场越强；悬停读数</div>';
  h += '<div class="chartbox"><div class="hover-read" id="mxHover">悬停查看读数</div><canvas id="mxChart"></canvas></div>';
  h += '<h2>读图指南</h2><ul class="sub">'
    + '<li>整行全亮＝全程在场（主线人物）；亮块集中＝阶段人物；零星亮点＝过客。</li>'
    + '<li>列方向看剧情密度：亮列＝群像' + UNIT + '，暗列＝独角戏。</li>'
    + '</ul>';
  return h;
}

function drawMatrix() {
  var cv = document.getElementById('mxChart');
  if (!cv) return;
  var order = DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; }).slice(0, 24);
  var rowNames = order.map(function (c) { return c.name; });
  var values = order.map(function (c) { return DETAIL.matrix[c.__idx]; });
  var colLabels = DETAIL.chapters.map(function (c) { return c.no; });
  heatCanvas(cv, rowNames, colLabels, values, { height: Math.max(240, rowNames.length * 26 + 40), hoverEl: document.getElementById('mxHover') });
}

/* ===== 伏笔 ===== */
function vForeshadow() {
  var all = [];
  DETAIL.chapters.forEach(function (c) {
    c.foreshadow.forEach(function (f) { all.push({ no: c.no, text: f }); });
  });
  var h = '<h1>伏笔（' + all.length + '）</h1>';
  if (!all.length) return h + '<p class="sub">本书增补窄窗未归纳出伏笔（或原文确实没有明显伏笔）。</p>';
  // 密度曲线 + 清单
  h += '<div class="chartbox"><div class="hover-read" id="hookHover">悬停查看读数</div><canvas id="fsChart"></canvas></div>';
  h += '<ul>';
  all.forEach(function (f) { h += '<li><span class="tag">第' + f.no + UNIT + '</span> ' + escHtml(f.text) + '</li>'; });
  return h + '</ul>';
}

function drawForeshadowCharts() {
  var cv = document.getElementById('fsChart');
  if (!cv) return;
  barCurve(cv, DETAIL.chapters.map(function (c) { return ({ v: c.foreshadow.length, xl: c.no }); }), {
    height: 120, color: '#ff7a8a', hoverEl: document.getElementById('hookHover')
  });
}

/* ===== 设定 / 物品 ===== */
function vTerm(name) {
  var t = TERMS[name];
  if (!t) return '<p>词条不存在</p>';
  var h = '<h1>' + escHtml(t.name) + '</h1>';
  h += '<div class="meta"><span>' + t.mentions + ' 次关系提及</span><span>出现在 ' + t.chapters.length + ' ' + UNIT + '</span></div>';
  if (t.edges.length) h += '<h2>关联</h2><ul>' + t.edges.map(function (e) {
    return '<li>' + charLink(e.person) + ' <span class="tag">' + escHtml(e.type) + '</span>' + (e.how ? ' <span class="sub">' + escHtml(e.how) + '</span>' : '') + '</li>';
  }).join('') + '</ul>';
  var inCh = DETAIL.timeline.filter(function (t2) {
    return t2.events.some(function (e) { return e.text.indexOf(name) >= 0; });
  }).map(function (t2) { return t2.no; });
  if (inCh.length) h += '<h2>出现章节</h2><p>' + inCh.map(function (n) { return '<a data-go="chapter" data-no="' + n + '">第' + n + UNIT + '</a>'; }).join('、') + '</p>';
  return h;
}

/* ===== 关系图谱（手写力导向，对齐原版 forceLayout） ===== */
function catColor(kind) { return kind === 'person' ? '#4f7cff' : '#b45309'; }

function forceLayout(svg, nodes, edges, opt) {
  opt = opt || {};
  var W = svg.clientWidth || 900, H = svg.clientHeight || 460;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!nodes.length) {
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', W / 2); t.setAttribute('y', H / 2); t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#72777d'); t.setAttribute('font-size', '13'); t.textContent = '（暂无可绘制的节点）';
    svg.appendChild(t); return;
  }
  var NS = 'http://www.w3.org/2000/svg';
  var map = {};
  nodes.forEach(function (n) { map[n.id] = n; });
  edges = edges.filter(function (e) { return map[e.a] && map[e.b]; });
  var focus = opt.focus;
  nodes.forEach(function (n, i) {
    var a = (i / nodes.length) * Math.PI * 2;
    n.x = W / 2 + Math.cos(a) * (focus ? 90 : 160) + Math.random() * 40;
    n.y = H / 2 + Math.sin(a) * (focus ? 70 : 130) + Math.random() * 40;
    n.vx = 0; n.vy = 0;
  });
  var iters = nodes.length > 200 ? 80 : 140;
  for (var it = 0; it < iters; it++) {
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        var f = (nodes.length > 150 ? 500 : 900) / d2, d = Math.sqrt(d2);
        a.vx += dx / d * f * 0.008; a.vy += dy / d * f * 0.008;
        b.vx -= dx / d * f * 0.008; b.vy -= dy / d * f * 0.008;
      }
    }
    edges.forEach(function (e) {
      var a2 = map[e.a], b2 = map[e.b];
      if (!a2 || !b2) return;
      var dx = b2.x - a2.x, dy = b2.y - a2.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var f2 = (d - 60) * 0.02;
      a2.vx += dx / d * f2; b2.vx -= dx / d * f2;
      a2.vy += dy / d * f2; b2.vy -= dy / d * f2;
    });
  }
  nodes.forEach(function (n) {
    n.x = Math.max(30, Math.min(W - 30, n.x));
    n.y = Math.max(24, Math.min(H - 24, n.y));
  });
  edges.forEach(function (e) {
    var a2 = map[e.a], b2 = map[e.b];
    if (!a2 || !b2) return;
    var line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', a2.x); line.setAttribute('y1', a2.y);
    line.setAttribute('x2', b2.x); line.setAttribute('y2', b2.y);
    line.setAttribute('stroke', e.type === '同场' ? '#5a6478' : '#b9c2d8');
    line.setAttribute('stroke-width', '1.2');
    var tip = document.createElementNS(NS, 'title');
    tip.textContent = (e.type || '关联') + (e.weight ? ' · ' + e.weight + ' 段同场' : '');
    line.appendChild(tip);
    svg.appendChild(line);
  });
  nodes.forEach(function (n) {
    var g = document.createElementNS(NS, 'g');
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', n.r || 7);
    c.setAttribute('fill', catColor(n.kind)); c.setAttribute('fill-opacity', '0.9');
    if (focus === n.id) { c.setAttribute('stroke', '#b45309'); c.setAttribute('stroke-width', '3'); }
    g.appendChild(c);
    var label = document.createElementNS(NS, 'text');
    label.setAttribute('x', n.x); label.setAttribute('y', n.y - n.r - 5);
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '11');
    label.setAttribute('fill', '#d5dded'); label.textContent = n.id;
    g.appendChild(label);
    if (focus === n.id) g.setAttribute('filter', 'url(#glow)');
    g.style.cursor = 'pointer';
    g.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (focus === n.id) go(n.kind === 'person' ? 'char' : 'term', n.id);
      else drawRelationGraph(n.id);
    });
    svg.appendChild(g);
  });
}

function vGraph() {
  var h = '<h1>关系图谱</h1><div class="meta">点节点聚焦邻域 → 再点同节点进人物页；点空白复位全图。共 ' + DETAIL.charGraph.nodes.length + ' 节点 / ' + DETAIL.charGraph.edges.length + ' 边（实线=关系，暗线=同场≥2段，悬停可看）</div>';
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
  var fullMeta = '点节点聚焦邻域 → 再点同节点进人物页；点空白复位全图。共 ' + DETAIL.charGraph.nodes.length + ' 节点 / ' + DETAIL.charGraph.edges.length + ' 边（实线=关系，暗线=同场≥2段，悬停可看）';
  if (focus) {
    var nb = new Set([focus]);
    edges.forEach(function (e) { if (e.a === focus) nb.add(e.b); if (e.b === focus) nb.add(e.a); });
    nodes = nodes.filter(function (n) { return nb.has(n.id); });
    edges = edges.filter(function (e) { return nb.has(e.a) && nb.has(e.b); });
    if (meta) meta.innerHTML = '聚焦「' + escHtml(focus) + '」的邻域（' + nodes.length + ' 节点 / ' + edges.length + ' 边）——再点同节点进人物页，点空白复位';
  } else {
    var deg = {};
    edges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    nodes = nodes.slice().sort(function (a, b) { return (deg[b.id] || 0) - (deg[a.id] || 0); }).slice(0, 70);
    edges = edges.filter(function (e) { return nodes.some(function (n) { return n.id === e.a; }) && nodes.some(function (n) { return n.id === e.b; }); });
    if (meta) meta.innerHTML = fullMeta;
    var lg = document.getElementById('relLegend');
    if (lg) lg.innerHTML = '<span><span class="dot" style="background:#4f7cff"></span>人物</span><span><span class="dot" style="background:#b45309"></span>设定/物品</span>';
  }
  forceLayout(svg, nodes, edges.map(function (e) { return { a: e.a, b: e.b, type: e.type, weight: e.weight }; }), { focus: focus || null });
}

/* ===== 主渲染分发 ===== */
function renderMain() {
  var v = document.getElementById('view');
  if (CUR.view === 'overview') v.innerHTML = vOverview();
  else if (CUR.view === 'outline') v.innerHTML = vOutline();
  else if (CUR.view === 'matrix') v.innerHTML = vMatrix();
  else if (CUR.view === 'timeline') v.innerHTML = vTimeline();
  else if (CUR.view === 'foreshadow') v.innerHTML = vForeshadow();
  else if (CUR.view === 'graph') v.innerHTML = vGraph();
  else if (CUR.view === 'char') v.innerHTML = vChar(CUR.name);
  else if (CUR.view === 'term') v.innerHTML = vTerm(CUR.name);
  else if (CUR.view === 'chapter') v.innerHTML = vChapter(Number(CUR.name));
  renderSide();
  // 视图后钩子：canvas 图表要在 innerHTML 落地后绘制（要量 clientWidth）
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
function closeSide() { toggleSide(false); }
document.getElementById('sideToggle').onclick = function () { toggleSide(); };
document.getElementById('sideMask').onclick = closeSide;

/* ===== 全局点击分发（wiki-links） ===== */
document.addEventListener('click', function (ev) {
  var a = ev.target.closest ? ev.target.closest('[data-go]') : null;
  if (!a) return;
  ev.preventDefault();
  go(a.dataset.go, a.dataset.name || a.dataset.no || null);
});

renderMain();
