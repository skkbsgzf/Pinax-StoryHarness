/* 世界书 SPA（作者 2026-11-12 裁定对齐原版 _web_demo 产品形态）。
 * 运行环境：单文件 HTML 内嵌，全局依赖 DETAIL（由 build-wiki.mjs 注入）。
 * 结构对齐 ref-Novelpedia/src/index_template.html：侧边导航 + 视图切换 + wiki-links + 手写力导向图。
 */

/* ===== 状态与工具 ===== */
var CUR = { view: 'overview', name: null };
var CH_BY_NO = {};
DETAIL.chapters.forEach(function (c) { CH_BY_NO[c.no] = c; });
var CHARS = {};
DETAIL.characters.forEach(function (c) { CHARS[c.name] = c; });
var TERMS = {};
DETAIL.terms.forEach(function (t) { TERMS[t.name] = t; });

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function charLink(n) {
  return CHARS[n] ? '<a data-go="char" data-name="' + escHtml(n) + '">' + escHtml(n) + '</a>' : '<span>' + escHtml(n) + '</span>';
}
function termLink(n) {
  return TERMS[n] ? '<a data-go="term" data-name="' + escHtml(n) + '">' + escHtml(n) + '</a>' : '<span>' + escHtml(n) + '</span>';
}
function go(view, name) {
  CUR = { view: view, name: name || null };
  renderMain();
  if (window.innerWidth <= 900) toggleSide(false);
  window.scrollTo(0, 0);
}

/* ===== 侧边导航 ===== */
function renderSide() {
  var h = '<div class="nav"><h3>导航</h3>';
  h += '<a data-go="overview" class="' + (CUR.view === 'overview' ? 'on' : '') + '">🏠 概览</a>';
  h += '<a data-go="outline" class="' + (CUR.view === 'outline' ? 'on' : '') + '">📖 章节大纲</a>';
  h += '<a data-go="timeline" class="' + (CUR.view === 'timeline' ? 'on' : '') + '">⏱ 时间线</a>';
  h += '<a data-go="graph" class="' + (CUR.view === 'graph' ? 'on' : '') + '">🔗 关系图谱</a>';
  h += '<a data-go="foreshadow" class="' + (CUR.view === 'foreshadow' ? 'on' : '') + '">🎣 伏笔</a></div>';
  h += '<h3>人物 (' + DETAIL.characters.length + ')</h3><div class="nav">';
  DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; }).forEach(function (c) {
    h += '<a data-go="char" data-name="' + escHtml(c.name) + '" class="' + (CUR.view === 'char' && CUR.name === c.name ? 'on' : '') + '">' + escHtml(c.name) + '</a>';
  });
  h += '</div><h3>设定 / 物品 (' + DETAIL.terms.length + ')</h3><div class="nav">';
  DETAIL.terms.slice(0, 40).forEach(function (t) {
    h += '<a data-go="term" data-name="' + escHtml(t.name) + '" class="' + (CUR.view === 'term' && CUR.name === t.name ? 'on' : '') + '">' + escHtml(t.name) + '</a>';
  });
  h += '</div>';
  document.getElementById('sideNav').innerHTML = h;
}

/* ===== 概览 ===== */
function vOverview() {
  var h = '<h1>' + escHtml(D.book.title) + ' · 世界书</h1>';
  h += '<div class="meta"><span>' + escHtml(D.book.author) + '</span><span>' + D.book.words + ' 字</span><span>' + escHtml(D.book.group) + '</span><span>' + D.chapters.length + ' 章</span>' + (D.enrich.perspective ? '<span>视角：' + escHtml(D.enrich.perspective.perspective) + '</span>' : '') + '</div>';
  if (D.enrich.storySummary) h += '<h2>剧情梗概</h2><div class="summary">' + escHtml(D.enrich.storySummary) + '</div>';
  if (D.enrich.arc && D.enrich.arc.length) {
    h += '<h2>故事结构</h2>';
    D.enrich.arc.forEach(function (p) {
      h += '<div class="outline-ch"><h3>' + escHtml(p.phase) + '</h3><div>' + escHtml(p.text) + '</div></div>';
    });
  }
  h += '<div class="stat"><div><b>' + D.chapters.length + '</b><span>章</span></div><div><b>' + D.characters.length + '</b><span>人物</span></div><div><b>' + D.terms.length + '</b><span>设定/物品</span></div><div><b>' + D.charGraph.edges.length + '</b><span>关系</span></div><div><b>' + (D.quality.traceableRate != null ? (D.quality.traceableRate * 100).toFixed(1) + '%' : '-') + '</b><span>可溯源</span></div></div>';
  h += '<h2>出场分布</h2><div class="chbar">';
  var maxApp = Math.max.apply(null, D.characters.map(function (c) { return c.appearances; }).concat([1]));
  D.chapters.forEach(function (c) {
    var n = DETAIL.characters.filter(function (p) { return p.chapters.indexOf(c.no) >= 0; }).length;
    h += '<div style="height:' + Math.max(4, Math.round(n / maxApp * 44)) + 'px" title="第' + c.no + '章：' + n + '人"></div>';
  });
  h += '</div>';
  h += '<h2>人物（' + D.characters.length + '）</h2><div class="grid">';
  DETAIL.characters.slice().sort(function (a, b) { return b.appearances - a.appearances; }).forEach(function (c) {
    h += '<div class="card"><h4><a data-go="char" data-name="' + escHtml(c.name) + '">' + escHtml(c.name) + '</a></h4>';
    if (c.identity) h += '<div class="sub">' + escHtml(c.identity) + '</div>';
    if (c.personality.length) h += '<div style="margin-top:6px">' + c.personality.slice(0, 3).map(function (w) { return '<span class="tag warm">' + escHtml(w) + '</span>'; }).join('') + '</div>';
    h += '<div class="sub" style="margin-top:6px">' + c.appearances + ' 段出场' + (c.chapters.length ? ' · 第 ' + c.chapters[0] + (c.chapters.length > 1 ? '~' + c.chapters[c.chapters.length - 1] : '') + ' 章' : '') + '</div></div>';
  });
  h += '</div>';
  h += '<h2>章节大纲（' + D.chapters.length + '）</h2>';
  D.chapters.slice(0, 12).forEach(function (c) {
    h += '<div class="outline-ch"><h3><a data-go="chapter" data-no="' + c.no + '">' + escHtml(c.title) + '</a></h3>';
    if (c.summary) h += '<div class="summary">' + escHtml(c.summary) + '</div>';
    h += '<div>' + c.chars.slice(0, 8).map(function (n) { return charLink(n); }).join(' ') + '</div>';
    if (c.foreshadow.length) h += '<div style="margin-top:6px"><span class="tag red">伏笔 ×' + c.foreshadow.length + '</span></div>';
    h += '</div>';
  });
  if (D.chapters.length > 12) h += '<p><a data-go="outline">查看全部 ' + D.chapters.length + ' 章大纲 →</a></p>';
  return h;
}

/* ===== 人物页 ===== */
function vChar(name) {
  var c = CHARS[name];
  if (!c) return '<p>人物不存在</p>';
  var h = '<h1>' + escHtml(c.name) + '</h1>';
  h += '<div class="meta"><span>' + c.appearances + ' 段出场</span>' + (c.chapters.length ? '<span>第 ' + c.chapters[0] + (c.chapters[c.chapters.length - 1] !== c.chapters[0] ? '~' + c.chapters[c.chapters.length - 1] : '') + ' 章</span>' : '') + (c.castTier ? '<span>剧作档：' + escHtml(c.castTier) + '</span>' : '') + '</div>';
  if (c.aliases.length) h += '<div>' + c.aliases.map(function (a) { return '<span class="tag">别名：' + escHtml(a) + '</span>'; }).join('') + '</div>';
  if (c.identity) h += '<h2>身份</h2><p>' + escHtml(c.identity) + '</p>';
  if (c.summary) h += '<h2>人物小传</h2><div class="summary">' + escHtml(c.summary) + '</div>';
  if (c.personality.length) h += '<h2>性格</h2><div>' + c.personality.map(function (w) { return '<span class="tag warm">' + escHtml(w) + '</span>'; }).join('') + '</div>';
  if (c.edges.length) h += '<h2>关系</h2><ul>' + c.edges.map(function (e) {
    return '<li>' + (e.dir === 'out' ? '→' : '←') + ' ' + charLink(e.other) + ' <span class="tag">' + escHtml(e.type) + '</span>' + (e.how ? ' <span class="sub">' + escHtml(e.how) + '</span>' : '') + '</li>';
  }).join('') + '</ul>';
  h += '<h2>出场分布</h2><div class="chbar">';
  var per = {};
  c.chapters.forEach(function (n) { per[n] = (per[n] || 0) + 1; });
  var mx = Math.max.apply(null, Object.keys(per).map(function (k) { return per[k]; }).concat([1]));
  Object.keys(per).sort(function (a, b) { return a - b; }).forEach(function (n) {
    h += '<div style="height:' + Math.max(4, Math.round(per[n] / mx * 44)) + 'px" title="第' + n + '章"></div>';
  });
  h += '</div>';
  if (c.speech.length) h += '<h2>台词（摘 ' + c.speech.length + ' / 共 ' + c.speechTotal + '）</h2>' + c.speech.map(function (s) { return '<div class="quote">“' + escHtml(s) + '”</div>'; }).join('');
  if (c.behavior.length) h += '<h2>行为（' + c.behavior.length + '）</h2><ul>' + c.behavior.map(function (s) { return '<li>' + escHtml(s) + '</li>'; }).join('') + '</ul>';
  if (c.cooccur.length) h += '<h2>同场人物</h2><ul>' + c.cooccur.map(function (p) { return '<li>' + charLink(p[0]) + ' <span class="sub">' + p[1] + ' 段同场</span></li>'; }).join('') + '</ul>';
  return h;
}

/* ===== 章节大纲 ===== */
function vOutline() {
  var h = '<h1>章节大纲</h1><div class="meta">' + D.chapters.length + ' 章 · 梗概由模型归纳，出场人物与伏笔来自 fact 条目</div>';
  D.chapters.forEach(function (c) {
    h += '<div class="outline-ch"><h3><a data-go="chapter" data-no="' + c.no + '">' + escHtml(c.title) + '</a></h3>';
    if (c.summary) h += '<div class="summary">' + escHtml(c.summary) + '</div>';
    h += '<div>' + c.chars.slice(0, 10).map(function (n) { return charLink(n); }).join(' ') + '</div>';
    if (c.newChars.length) h += '<div style="margin-top:6px">' + c.newChars.map(function (n) { return '<span class="tag green">新出场：' + escHtml(n) + '</span>'; }).join('') + '</div>';
    if (c.foreshadow.length) h += '<div style="margin-top:6px"><span class="tag red">伏笔 ×' + c.foreshadow.length + '</span></div>';
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
  if (c.foreshadow.length) h += '<h2>本章伏笔</h2><ul>' + c.foreshadow.map(function (f) { return '<li>' + escHtml(f) + '</li>'; }).join('') + '</ul>';
  h += '<h2>事件（' + c.events + '）</h2>';
  DETAIL.timeline.filter(function (t) { return t.no === Number(no); }).forEach(function (t) {
    t.events.forEach(function (e) {
      h += '<div class="event"><span class="who">' + escHtml(e.who || '—') + '</span> <span class="ch">[' + escHtml(e.channel) + ']</span><div>' + escHtml(e.text) + '</div></div>';
    });
  });
  return h;
}

/* ===== 时间线 ===== */
function vTimeline() {
  var h = '<h1>时间线</h1><div class="meta">' + D.chapters.length + ' 章，事件按章序归并</div><div class="tl">';
  DETAIL.timeline.forEach(function (t) {
    h += '<div class="tl-item"><h3><a data-go="chapter" data-no="' + t.no + '">' + escHtml(t.title) + '</a></h3>';
    t.events.forEach(function (e) {
      h += '<div class="event"><span class="who">' + escHtml(e.who || '—') + '</span> <span class="ch">[' + escHtml(e.channel) + ']</span><div>' + escHtml(e.text) + '</div></div>';
    });
    h += '</div>';
  });
  return h + '</div>';
}

/* ===== 伏笔 ===== */
function vForeshadow() {
  var all = [];
  DETAIL.chapters.forEach(function (c) {
    c.foreshadow.forEach(function (f) { all.push({ no: c.no, title: c.title, text: f }); });
  });
  var h = '<h1>伏笔（' + all.length + '）</h1>';
  if (!all.length) return h + '<p class="sub">本书拆解未产出伏笔条目（v3 契约只做减法，伏笔层待后续接入）。</p>';
  h += '<ul>';
  all.forEach(function (f) { h += '<li><span class="tag">第' + f.no + '章</span> ' + escHtml(f.text) + '</li>'; });
  return h + '</ul>';
}

/* ===== 设定 / 物品 ===== */
function vTerm(name) {
  var t = TERMS[name];
  if (!t) return '<p>词条不存在</p>';
  var h = '<h1>' + escHtml(t.name) + '</h1>';
  h += '<div class="meta"><span>' + t.mentions + ' 次关系提及</span><span>出现在 ' + t.chapters.length + ' 章</span></div>';
  if (t.edges.length) h += '<h2>关联</h2><ul>' + t.edges.map(function (e) {
    return '<li>' + charLink(e.person) + ' <span class="tag">' + escHtml(e.type) + '</span>' + (e.how ? ' <span class="sub">' + escHtml(e.how) + '</span>' : '') + '</li>';
  }).join('') + '</ul>';
  var inCh = DETAIL.timeline.filter(function (t2) {
    return t2.events.some(function (e) { return e.text.indexOf(name) >= 0; });
  }).map(function (t2) { return t2.no; });
  if (inCh.length) h += '<h2>出现章节</h2><p>' + inCh.map(function (n) { return '<a data-go="chapter" data-no="' + n + '">第' + n + '章</a>'; }).join('、') + '</p>';
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
    line.setAttribute('stroke', '#b9c2d8'); line.setAttribute('stroke-width', '1.2');
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
    g.addEventListener('click', function () { go(n.kind === 'person' ? 'char' : 'term', n.id); });
    svg.appendChild(g);
  });
}

function vGraph() {
  var h = '<h1>关系图谱</h1><div class="meta">点击节点跳转人物/词条；再点一次背景返回全图。共 ' + DETAIL.charGraph.nodes.length + ' 节点 / ' + DETAIL.charGraph.edges.length + ' 边</div>';
  h += '<svg id="relSvg" class="relation"></svg><div id="relLegend" class="legend"></div>';
  return h;
}

function drawRelationGraph(focus) {
  var svg = document.getElementById('relSvg');
  if (!svg) return;
  var nodes = DETAIL.charGraph.nodes;
  var edges = DETAIL.charGraph.edges;
  if (focus) {
    var nb = new Set([focus]);
    edges.forEach(function (e) { if (e.a === focus) nb.add(e.b); if (e.b === focus) nb.add(e.a); });
    nodes = nodes.filter(function (n) { return nb.has(n.id); });
    edges = edges.filter(function (e) { return nb.has(e.a) && nb.has(e.b); });
  } else {
    var deg = {};
    edges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    nodes = nodes.slice().sort(function (a, b) { return (deg[b.id] || 0) - (deg[a.id] || 0); }).slice(0, 70);
    edges = edges.filter(function (e) { return nodes.some(function (n) { return n.id === e.a; }) && nodes.some(function (n) { return n.id === e.b; }); });
    var lg = document.getElementById('relLegend');
    if (lg) lg.innerHTML = '<span><span class="dot" style="background:#4f7cff"></span>人物</span><span><span class="dot" style="background:#b45309"></span>设定/物品</span>';
  }
  forceLayout(svg, nodes, edges.map(function (e) { return { a: e.a, b: e.b }; }), { focus: focus || null });
}

/* ===== 主渲染分发 ===== */
function renderMain() {
  var v = document.getElementById('view');
  if (CUR.view === 'overview') v.innerHTML = vOverview();
  else if (CUR.view === 'outline') v.innerHTML = vOutline();
  else if (CUR.view === 'timeline') v.innerHTML = vTimeline();
  else if (CUR.view === 'foreshadow') v.innerHTML = vForeshadow();
  else if (CUR.view === 'graph') v.innerHTML = vGraph();
  else if (CUR.view === 'char') v.innerHTML = vChar(CUR.name);
  else if (CUR.view === 'term') v.innerHTML = vTerm(CUR.name);
  else if (CUR.view === 'chapter') v.innerHTML = vChapter(Number(CUR.name));
  renderSide();
  if (CUR.view === 'graph') drawRelationGraph(null);
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
renderSide();
