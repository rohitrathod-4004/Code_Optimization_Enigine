// ============================================================
//  UI  — Rendering all visualization panels
// ============================================================

// ── TAC Renderer ─────────────────────────────────────────────
function renderTAC(instrs) {
  const grid = document.getElementById('tacGrid');
  if (!instrs.length) { grid.innerHTML = '<div class="pass-no-change">No instructions generated.</div>'; return; }

  let currentBlock = -1;
  let html = '';
  instrs.forEach((ins, idx) => {
    if (ins._block !== undefined && ins._block !== currentBlock) {
      currentBlock = ins._block;
      html += `<div class="tac-block-header">— Block ${currentBlock} —</div>`;
    }
    const cls = tacClass(ins.op);
    html += `<div class="tac-line">
      <span class="tac-num">${idx + 1}</span>
      <span class="tac-code ${cls}">${escHtml(instrToStr(ins))}</span>
    </div>`;
  });
  grid.innerHTML = html;
}

function tacClass(op) {
  if (op === 'label')  return 'tac-label';
  if (op === 'goto')   return 'tac-goto';
  if (op === 'if')     return 'tac-if';
  if (op === 'return') return 'tac-return';
  return 'tac-assign';
}

// ── CFG live-variable toggle state ───────────────────────────
let _showLV = false;

function cfgToggleLV() {
  _showLV = !_showLV;
  // Re-render CFG with current lvaBlocks (or regular blocks)
  const blocks = window.lvaBlocks;
  if (blocks && blocks.length) renderCFG(blocks);
}

/** Format a Set<string> as "{ a, b }" or "∅" */
function setStr(s) {
  if (!s || s.size === 0) return '\u2205';
  return '{ ' + [...s].join(', ') + ' }';
}

// ── CFG Renderer — SVG Directed Graph ────────────────────────
function renderCFG(blocks) {
  const container = document.getElementById('cfgContainer');
  if (!blocks.length) { container.innerHTML = '<div class="pass-no-change">No blocks identified.</div>'; return; }

  /* ── 1. Detect back-edges via DFS ── */
  const backEdgeSet = new Set();
  const dfsVisited = new Set(), dfsStack = new Set();
  function dfs(b) {
    dfsVisited.add(b.id); dfsStack.add(b.id);
    b.successors.forEach(s => {
      if (dfsStack.has(s.id)) { backEdgeSet.add(`${b.id}→${s.id}`); }
      else if (!dfsVisited.has(s.id)) { dfs(s); }
    });
    dfsStack.delete(b.id);
  }
  dfs(blocks[0]);

  /* ── 2. BFS level assignment (skip back-edges) ── */
  const levels = {}; levels[blocks[0].id] = 0;
  const queue = [blocks[0]]; const bfsVis = new Set([blocks[0].id]);
  while (queue.length) {
    const b = queue.shift();
    b.successors.forEach(s => {
      if (!backEdgeSet.has(`${b.id}→${s.id}`) && !bfsVis.has(s.id)) {
        bfsVis.add(s.id); levels[s.id] = levels[b.id] + 1; queue.push(s);
      }
    });
  }
  blocks.forEach(b => { if (levels[b.id] === undefined) levels[b.id] = 0; });

  /* ── 3. Group by level and compute positions ── */
  const NODE_W = 230, LINE_H = 17, HDR_H = 42, PAD = 10;
  const V_GAP = 90, H_GAP = 60, MARGIN = 80;

  const levelGroups = {};
  blocks.forEach(b => {
    const lv = levels[b.id];
    if (!levelGroups[lv]) levelGroups[lv] = [];
    levelGroups[lv].push(b);
  });
  const numLevels = Math.max(...Object.keys(levelGroups).map(Number)) + 1;

  const nodeH = {};
  const LV_H = 38; // extra height per block when LV overlay is on
  const DOM_H = 24; // extra height when Dominators overlay is on
  blocks.forEach(b => {
    const vis = b.instrs.filter(i => i.op !== 'label');
    const base = HDR_H + PAD + Math.max(vis.length, 1) * LINE_H + PAD;
    let h = base;
    if (_showLV) h += LV_H;
    if (window.showDominators) h += DOM_H;
    nodeH[b.id] = h;
  });

  /* y positions per level (tallest node in level drives spacing) */
  const levelY = {}, levelMaxH = {};
  let cy = MARGIN;
  for (let lv = 0; lv < numLevels; lv++) {
    levelY[lv] = cy;
    levelMaxH[lv] = Math.max(...(levelGroups[lv] || []).map(b => nodeH[b.id]));
    cy += levelMaxH[lv] + V_GAP;
  }
  const totalH = cy + MARGIN;

  /* x positions – centre each level */
  const pos = {};
  const maxPerRow = Math.max(...Object.values(levelGroups).map(g => g.length));
  const totalW = Math.max(maxPerRow * (NODE_W + H_GAP) - H_GAP + MARGIN * 2, 500);
  Object.entries(levelGroups).forEach(([lv, grp]) => {
    const rowW = grp.length * NODE_W + (grp.length - 1) * H_GAP;
    const sx = (totalW - rowW) / 2;
    grp.forEach((b, i) => {
      pos[b.id] = { x: sx + i * (NODE_W + H_GAP), y: levelY[+lv], w: NODE_W, h: nodeH[b.id] };
    });
  });

  /* ── 4. Edge-label mapping (True / False for if-blocks) ── */
  const edgeLbl = {};
  blocks.forEach(b => {
    const last = b.instrs[b.instrs.length - 1];
    if (last && last.op === 'if' && b.successors.length === 2) {
      edgeLbl[`${b.id}→${b.successors[0].id}`] = 'T';
      edgeLbl[`${b.id}→${b.successors[1].id}`] = 'F';
    }
  });

  /* ── 5. Build SVG ── */
  const blockType = b =>
    b.id === 0 ? 'entry' :
    b.instrs.some(i => i.op === 'return') ? 'exit' : 'basic';

  const typeColor = { entry:'#22d3a5', basic:'#6C63FF', exit:'#ff5672' };
  const typeBg    = { entry:'rgba(34,211,165,.13)', basic:'rgba(108,99,255,.12)', exit:'rgba(255,86,114,.12)' };

  /* SVG path for an edge */
  function edgePath(from, to, isBack, isTrueBranch) {
    const fp = pos[from.id], tp = pos[to.id];
    if (!fp || !tp) return '';
    const key = `${from.id}→${to.id}`;
    const lbl = edgeLbl[key] || '';

    if (isBack) {
      /* Back edge: exit left side of source, curve up to left side of target */
      const sx = fp.x, sy = fp.y + fp.h / 2;
      const tx = tp.x, ty = tp.y + tp.h / 2;
      const cx = Math.min(sx, tx) - 55;
      return `<path class="cfg-edge-path cfg-edge-back" id="e${from.id}-${to.id}"
        d="M ${sx} ${sy} C ${cx} ${sy} ${cx} ${ty} ${tx} ${ty}"
        marker-end="url(#arrowBack)" />
        ${lbl ? edgeLabel(cx - 5, (sy + ty) / 2, lbl, true) : ''}
        ${backEdgeLoop(cx, (sy + ty) / 2)}`;
    } else {
      /* Forward edge: bottom-center to top-center with cubic bezier */
      const sx = fp.x + fp.w / 2, sy = fp.y + fp.h;
      const tx = tp.x + tp.w / 2, ty = tp.y;
      const my = (sy + ty) / 2;
      const color = lbl === 'T' ? '#22d3a5' : lbl === 'F' ? '#ff5672' : '#6C63FF';
      const cls   = lbl === 'T' ? 'cfg-edge-true' : lbl === 'F' ? 'cfg-edge-false' : 'cfg-edge-fwd';
      const markId = lbl === 'T' ? 'arrowTrue' : lbl === 'F' ? 'arrowFalse' : 'arrowFwd';
      return `<path class="cfg-edge-path ${cls}" id="e${from.id}-${to.id}"
        d="M ${sx} ${sy} C ${sx} ${my} ${tx} ${my} ${tx} ${ty}"
        marker-end="url(#${markId})" />
        ${lbl ? edgeLabel((sx + tx) / 2 + (lbl === 'T' ? -18 : 18), my, lbl, false) : ''}`;
    }
  }

  function edgeLabel(x, y, txt, isBack) {
    const fill = txt === 'T' ? '#22d3a5' : txt === 'F' ? '#ff5672' : '#A78BFA';
    return `<rect x="${x-10}" y="${y-9}" width="20" height="14" rx="3" fill="${fill}" fill-opacity=".9"/>
    <text x="${x}" y="${y+2}" text-anchor="middle" class="cfg-edge-lbl">${txt}</text>`;
  }

  function backEdgeLoop(cx, my) {
    return `<text x="${cx - 2}" y="${my + 4}" text-anchor="middle" class="cfg-back-icon">↺</text>`;
  }

  /* Node rectangle */
  function nodeRect(b) {
    const p = pos[b.id]; if (!p) return '';
    const type = blockType(b);
    const col  = typeColor[type];
    const bg   = typeBg[type];
    const vis  = b.instrs.filter(i => i.op !== 'label');

    let inner = '';
    /* header */
    inner += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${HDR_H}"
      rx="8" ry="8" fill="${col}" fill-opacity=".18" />`;
    inner += `<rect x="${p.x}" y="${p.y + HDR_H - 4}" width="${p.w}" height="4" fill="${col}" fill-opacity=".18"/>`;
    /* body bg */
    inner += `<rect x="${p.x}" y="${p.y + HDR_H}" width="${p.w}" height="${p.h - HDR_H}"
      fill="${bg}" />`;
    /* outer border */
    inner += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"
      rx="8" fill="none" stroke="${col}" stroke-width="1.5"
      class="cfg-node-border" data-bid="${b.id}" />`;
    /* block name */
    inner += `<text x="${p.x + 12}" y="${p.y + 18}" class="cfg-node-name" fill="${col}">${escHtml(b.name)}</text>`;
    /* type badge */
    const badgeTxt = type.charAt(0).toUpperCase() + type.slice(1);
    inner += `<rect x="${p.x + p.w - 52}" y="${p.y + 9}" width="44" height="16" rx="4"
      fill="${col}" fill-opacity=".25"/>`;
    inner += `<text x="${p.x + p.w - 30}" y="${p.y + 20}" class="cfg-node-badge" fill="${col}">${badgeTxt}</text>`;
    /* separator */
    inner += `<line x1="${p.x + 1}" y1="${p.y + HDR_H}" x2="${p.x + p.w - 1}" y2="${p.y + HDR_H}"
      stroke="${col}" stroke-opacity=".3" stroke-width="1"/>`;
    /* instructions */
    vis.forEach((ins, li) => {
      const iy = p.y + HDR_H + PAD + li * LINE_H + LINE_H * 0.72;
      const str = escHtml(instrToStr(ins));
      inner += `<text x="${p.x + 10}" y="${iy}" class="cfg-node-instr">${str}</text>`;
    });

    /* Live Variable IN / OUT overlay */
    if (_showLV && b.IN !== undefined) {
      const lvOffset = window.showDominators ? DOM_H : 0;
      const sepY  = p.y + p.h - LV_H - lvOffset;
      const inY   = sepY + 14;
      const outY  = sepY + 28;
      // separator line
      inner += `<line x1="${p.x + 1}" y1="${sepY}" x2="${p.x + p.w - 1}" y2="${sepY}"
        stroke="#A78BFA" stroke-opacity=".35" stroke-width="1" stroke-dasharray="3 2"/>`;
      // IN row (yellow)
      inner += `<text x="${p.x + 8}" y="${inY}" class="cfg-lv-label" fill="#FFD166">IN: ${escHtml(setStr(b.IN))}</text>`;
      // OUT row (purple-light)
      inner += `<text x="${p.x + 8}" y="${outY}" class="cfg-lv-label" fill="#A78BFA">OUT: ${escHtml(setStr(b.OUT))}</text>`;
    }

    /* Dominator overlay */
    if (window.showDominators && b.dominators) {
      const sepY = p.y + p.h - DOM_H;
      inner += `<line x1="${p.x + 1}" y1="${sepY}" x2="${p.x + p.w - 1}" y2="${sepY}"
        stroke="#b084ff" stroke-opacity=".35" stroke-width="1" stroke-dasharray="3 2"/>`;
      const domNames = [...b.dominators].map(db => db.name).sort(); 
      inner += `<text x="${p.x + 8}" y="${sepY + 16}" style="font-size:0.8rem; font-weight:500;" fill="#b084ff">Dom: {${escHtml(domNames.join(', '))}}</text>`;
    }

    return `<g class="cfg-node" data-bid="${b.id}"
      onmouseenter="cfgHighlight(${b.id}, true)"
      onmouseleave="cfgHighlight(${b.id}, false)">${inner}</g>`;
  }

  /* Assemble SVG */
  let edgesHtml = '', nodesHtml = '';
  blocks.forEach(from => {
    from.successors.forEach(to => {
      const isBack = backEdgeSet.has(`${from.id}→${to.id}`);
      edgesHtml += edgePath(from, to, isBack);
    });
  });
  blocks.forEach(b => { nodesHtml += nodeRect(b); });

  const svg = `
  <div class="cfg-toolbar" style="display:none">
    <button class="btn btn-ghost btn-sm cfg-lv-toggle ${_showLV ? 'active' : ''}" onclick="cfgToggleLV()">
      ${_showLV ? '🔴' : '🟢'} Live Variables
    </button>
  </div>
  <div class="cfg-legend">
    <span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#22d3a5"></span>Entry</span>
    <span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#6C63FF"></span>Basic</span>
    <span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#ff5672"></span>Exit</span>
    <span class="cfg-leg-item"><span class="cfg-leg-line" style="background:#22d3a5"></span>True branch</span>
    <span class="cfg-leg-item"><span class="cfg-leg-line" style="background:#ff5672"></span>False branch</span>
    <span class="cfg-leg-item"><span class="cfg-leg-line" style="background:#A78BFA;border-style:dashed"></span>Back edge ↺</span>
    ${_showLV ? '<span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#FFD166"></span>IN (live)</span><span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#A78BFA"></span>OUT (live)</span>' : ''}
  </div>
  <div class="cfg-svg-wrap">
  <svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}"
       viewBox="0 0 ${totalW} ${totalH}" id="cfgSvg">
    <defs>
      <marker id="arrowFwd"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#6C63FF"/></marker>
      <marker id="arrowTrue" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#22d3a5"/></marker>
      <marker id="arrowFalse" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#ff5672"/></marker>
      <marker id="arrowBack"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#A78BFA"/></marker>
    </defs>
    <g id="cfgEdges">${edgesHtml}</g>
    <g id="cfgNodes">${nodesHtml}</g>
  </svg>
  </div>`;

  container.innerHTML = svg;
}

/* Hover: highlight edges touching a node */
function cfgHighlight(bid, on) {
  document.querySelectorAll(`[id^="e${bid}-"], [id$="-${bid}"]`).forEach(el => {
    el.style.strokeWidth = on ? '2.5' : '';
    el.style.filter = on ? 'drop-shadow(0 0 4px currentColor)' : '';
  });
  const border = document.querySelector(`.cfg-node-border[data-bid="${bid}"]`);
  if (border) border.style.strokeWidth = on ? '2.5' : '1.5';
}

// ── Pipeline Renderer ─────────────────────────────────────────
function renderPipeline(passes, stepMode) {
  const container = document.getElementById('pipelinePasses');
  const controls   = document.getElementById('pipelineControls');

  controls.style.display = stepMode ? 'flex' : 'none';

  let html = '';
  passes.forEach((pass, pi) => {
    const hasChanges = pass.changes.length > 0;
    const badgeCls   = hasChanges ? 'pass-badge-applied' : 'pass-badge-skip';
    const badgeTxt   = hasChanges ? `${pass.changes.length} change${pass.changes.length > 1 ? 's' : ''}` : 'No change';
    const cardCls    = hasChanges ? 'has-changes' : 'no-changes';

    let diffHtml = '';
    if (hasChanges) {
      diffHtml = `<table class="diff-table">
        <thead><tr><th>Before</th><th>After</th><th>Note</th></tr></thead><tbody>`;
      pass.changes.forEach(c => {
        const rowCls = c.type === 'removed' ? 'diff-row-removed' : 'diff-row-changed';
        const beforeTxt = c.type === 'removed' ? `<span class="diff-strike">${escHtml(c.before)}</span>` : escHtml(c.before);
        diffHtml += `<tr class="${rowCls}">
          <td>${beforeTxt}</td>
          <td>${escHtml(c.after)}</td>
          <td>${escHtml(c.note || '')}</td>
        </tr>`;
      });
      diffHtml += '</tbody></table>';
    } else {
      diffHtml = `<div class="pass-no-change">✓ No optimizations applied in this pass.</div>`;
    }

    html += `<div class="pass-card ${cardCls}" id="pass-card-${pi}">
      <div class="pass-header" onclick="togglePass(${pi})">
        <span class="pass-name">
          ${passIcon(pass.name)} ${escHtml(pass.name)}
          <span class="pass-badge ${badgeCls}">${badgeTxt}</span>
        </span>
        <span class="pass-toggle" id="pass-toggle-${pi}">▶</span>
      </div>
      <div class="pass-body ${pi === 0 ? 'open' : ''}" id="pass-body-${pi}">
        <div class="pass-description">${pass.description}</div>
        ${diffHtml}
      </div>
    </div>`;
  });

  container.innerHTML = html;
  if (passes[0]) {
    const tog = document.getElementById('pass-toggle-0');
    if (tog) tog.classList.add('open');
  }
}

function togglePass(pi) {
  const body = document.getElementById(`pass-body-${pi}`);
  const tog  = document.getElementById(`pass-toggle-${pi}`);
  const open = body.classList.toggle('open');
  tog.classList.toggle('open', open);
}

function passIcon(name) {
  const icons = {
    'Constant Folding':'🔢', 'Constant Propagation':'🔄',
    'Algebraic Simplification':'✏️', 'Copy Propagation':'📋',
    'Common Subexpression Elimination':'♻️', 'Dead Code Elimination':'🗑️'
  };
  return icons[name] || '⚙️';
}

// ── Output Renderer ───────────────────────────────────────────
function renderOutput(optimizedInstrs) {
  // TAC block
  const tacDiv = document.getElementById('optimizedTAC');
  tacDiv.innerHTML = optimizedInstrs.map((ins, i) =>
    `<span style="color:var(--text-muted);user-select:none">${String(i+1).padStart(2,' ')}  </span>${colorizeInstr(instrToStr(ins))}\n`
  ).join('');

  // Reconstructed C-like
  const cDiv = document.getElementById('reconstructedC');
  cDiv.innerHTML = reconstructC(optimizedInstrs);
}

function colorizeInstr(str) {
  // Simple token coloring
  str = escHtml(str);
  str = str.replace(/\b(goto|if|return)\b/g, '<span class="cl-keyword">$1</span>');
  str = str.replace(/\b(\d+)\b/g, '<span class="cl-number">$1</span>');
  str = str.replace(/([+\-*\/%=<>!]+)/g, '<span class="cl-operator">$1</span>');
  return str;
}

function reconstructC(instrs) {
  let lines = [];
  lines.push('<span class="cl-keyword">int</span> main() {');
  const declared = new Set();
  for (const ins of instrs) {
    if (ins.op === 'binop' || ins.op === 'assign') {
      const decl = !declared.has(ins.result);
      if (decl) declared.add(ins.result);
      const prefix = decl ? '  <span class="cl-keyword">int</span> ' : '  ';
      lines.push(`${prefix}<span class="cl-var">${escHtml(ins.result)}</span> <span class="cl-operator">=</span> ${escHtml(instrToStr(ins).split('=').slice(1).join('=').trim())};`);
    } else if (ins.op === 'label') {
      lines.push(`<span class="cl-label">${escHtml(ins.label)}:</span>`);
    } else if (ins.op === 'goto') {
      lines.push(`  <span class="cl-keyword">goto</span> <span class="cl-label">${escHtml(ins.label)}</span>;`);
    } else if (ins.op === 'if') {
      lines.push(`  <span class="cl-keyword">if</span> (${escHtml(ins.arg1)} ${escHtml(ins.cond)} ${escHtml(ins.arg2)}) <span class="cl-keyword">goto</span> <span class="cl-label">${escHtml(ins.label)}</span>;`);
    } else if (ins.op === 'return') {
      lines.push(`  <span class="cl-keyword">return</span>${ins.arg1 ? ' <span class="cl-var">' + escHtml(ins.arg1) + '</span>' : ''};`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

// ── Metrics Renderer ──────────────────────────────────────────
/**
 * renderMetrics(comparison, passes)
 * comparison = result of compareMetrics(beforeInstrs, afterInstrs)
 */
function renderMetrics(comparison, passes) {
  const { before, after, improvement } = comparison;
  const totalChanges  = passes.reduce((s, p) => s + p.changes.length, 0);
  const passesApplied = passes.filter(p => p.changes.length > 0).length;

  // ── Top summary cards ──────────────────────────────────────
  const grid = document.getElementById('metricsGrid');
  grid.innerHTML = `
    ${metricCard('📊', 'Instructions', `${before.instructionCount} → ${after.instructionCount}`, '', '--purple')}
    ${metricCard('⚡', 'Est. Cost', `${before.estimatedCost} → ${after.estimatedCost}`, 'weighted ops', '--orange')}
    ${metricCard('💾', 'Memory (vars)', `${before.memoryUsage} → ${after.memoryUsage}`, 'unique identifiers', '--cyan')}
    ${metricCard('⚙️', 'Passes Applied', `${passesApplied} / ${passes.length}`, `${totalChanges} transformations`, '--purple-light')}
  `;

  // ── Comparison table + improvement badges ──────────────────
  function improvBadge(pct) {
    if (pct > 0)  return `<span class="improv-badge improv-pos">▼ ${pct}%</span>`;
    if (pct < 0)  return `<span class="improv-badge improv-neg">▲ ${Math.abs(pct)}%</span>`;
    return `<span class="improv-badge improv-neutral">— 0%</span>`;
  }

  const compTable = `
    <table class="metrics-cmp-table">
      <thead>
        <tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="cmp-metric-name">📋 Instruction count</td>
          <td class="cmp-before">${before.instructionCount}</td>
          <td class="cmp-after">${after.instructionCount}</td>
          <td>${improvBadge(improvement.instructionReductionPercent)}</td>
        </tr>
        <tr>
          <td class="cmp-metric-name">⚡ Estimated cost</td>
          <td class="cmp-before">${before.estimatedCost}</td>
          <td class="cmp-after">${after.estimatedCost}</td>
          <td>${improvBadge(improvement.costReductionPercent)}</td>
        </tr>
        <tr>
          <td class="cmp-metric-name">💾 Memory (vars)</td>
          <td class="cmp-before">${before.memoryUsage}</td>
          <td class="cmp-after">${after.memoryUsage}</td>
          <td>${improvBadge(improvement.memoryReductionPercent)}</td>
        </tr>
      </tbody>
    </table>`;

  // ── Operation breakdown (two mini columns) ─────────────────
  function breakdownRow(label, bVal, aVal) {
    const delta = bVal - aVal;
    const cls   = delta > 0 ? 'bd-reduced' : delta < 0 ? 'bd-increased' : '';
    return `<tr class="${cls}">
      <td class="bd-name">${label}</td>
      <td class="bd-val">${bVal}</td>
      <td class="bd-val">${aVal}</td>
      <td class="bd-delta">${delta > 0 ? '-'+delta : delta < 0 ? '+'+Math.abs(delta) : '—'}</td>
    </tr>`;
  }
  const breakdownTable = `
    <table class="metrics-bd-table">
      <thead><tr><th>Op type</th><th>Before</th><th>After</th><th>Δ</th></tr></thead>
      <tbody>
        ${breakdownRow('Assign',       before.operationBreakdown.assign,      after.operationBreakdown.assign)}
        ${breakdownRow('Binop',        before.operationBreakdown.binop,       after.operationBreakdown.binop)}
        ${breakdownRow('Control flow', before.operationBreakdown.controlFlow, after.operationBreakdown.controlFlow)}
        ${breakdownRow('Other',        before.operationBreakdown.others,      after.operationBreakdown.others)}
      </tbody>
    </table>`;

  // ── Pass details ───────────────────────────────────────────
  let dhtml = '';
  for (const pass of passes) {
    if (!pass.changes.length) continue;
    dhtml += `<div class="opt-detail-row">
      <span class="opt-detail-icon">${passIcon(pass.name)}</span>
      <div class="opt-detail-text">
        <strong>${escHtml(pass.name)}</strong>: ${pass.changes.length} transformation${pass.changes.length > 1 ? 's' : ''} —
        <div style="margin-top:.4rem; display:flex; flex-direction:column; gap:.4rem">
          ${pass.changes.map(c => `
            <div class="opt-change">
              <div><span class="mono" style="font-size:.75rem;color:var(--cyan)">${escHtml(c.before)}</span> → <span class="mono" style="font-size:.75rem;color:var(--green)">${escHtml(c.after)}</span></div>
              ${c.reason ? `<div class="opt-reason">↳ ${escHtml(c.reason)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }
  if (!dhtml) dhtml = `<div class="opt-detail-row"><span class="opt-detail-icon">ℹ️</span><div class="opt-detail-text">No optimizations were applicable to this code.</div></div>`;

  const details = document.getElementById('optDetails');
  details.innerHTML = `
    <div class="section-label" style="margin:.1rem 0 .6rem">Before vs After</div>
    ${compTable}
    <div class="metrics-breakdown-row">
      <div>
        <div class="section-label" style="margin:1.25rem 0 .6rem">Operation Breakdown</div>
        ${breakdownTable}
      </div>
    </div>
    <div class="section-label" style="margin:1.25rem 0 .6rem">Pass Details</div>
    ${dhtml}`;
}

function metricCard(icon, label, value, sub, colorVar, valClass) {
  return `<div class="metric-card" style="--metric-color:var(${colorVar})">
    <span class="metric-icon">${icon}</span>
    <span class="metric-label">${escHtml(label)}</span>
    <span class="metric-value ${valClass || ''}">${value}</span>
    ${sub ? `<span class="metric-sub">${sub}</span>` : ''}
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Tab Switching ─────────────────────────────────────────────
function switchTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
}

// ── Execution Renderer ────────────────────────────────────────
/**
 * renderExecution(origResult, optResult)
 * origResult / optResult: return value of executeTAC()
 */
function renderExecution(origResult, optResult) {
  const container = document.getElementById('tab-execute');
  if (!container) return;

  function stateTable(state) {
    const entries = Object.entries(state);
    if (!entries.length) return '<span class="exec-empty">— no variables —</span>';
    let h = '<table class="exec-state-table"><thead><tr><th>Variable</th><th>Value</th></tr></thead><tbody>';
    entries.forEach(([k, v]) => {
      h += `<tr><td class="exec-var">${escHtml(k)}</td><td class="exec-val">${escHtml(String(v))}</td></tr>`;
    });
    return h + '</tbody></table>';
  }

  function summaryCard(label, result) {
    const retVal  = result.returnValue !== null ? result.returnValue : '—';
    const errHtml = result.error
      ? `<div class="exec-error">⚠️ ${escHtml(result.error)}</div>` : '';
    return `
      <div class="exec-summary-card">
        <div class="exec-summary-header">${escHtml(label)}</div>
        ${errHtml}
        <div class="exec-kv"><span class="exec-kv-key">Return value</span><span class="exec-kv-val ${result.returnValue !== null ? 'exec-highlight' : ''}">${escHtml(String(retVal))}</span></div>
        <div class="exec-kv"><span class="exec-kv-key">Steps executed</span><span class="exec-kv-val">${result.executionTrace.length}</span></div>
        <div class="exec-kv"><span class="exec-kv-key">Variables</span><span class="exec-kv-val">${Object.keys(result.finalState).length}</span></div>
        <div class="section-label" style="margin:.75rem 0 .4rem">Final Variable State</div>
        ${stateTable(result.finalState)}
      </div>`;
  }

  function tracePanel(label, result) {
    const { executionTrace: trace } = result;
    if (!trace.length) return `<div class="pass-no-change">No instructions executed.</div>`;

    // Truncate very long traces to keep the DOM manageable
    const MAX_ROWS = 200;
    const truncated = trace.length > MAX_ROWS;
    const displayed = truncated ? trace.slice(0, MAX_ROWS) : trace;

    // Cap total animation spread at 600ms regardless of row count
    const delayPerRow = Math.min(18, 600 / Math.max(displayed.length, 1));

    let rows = '';
    displayed.forEach(({ step, instr, stateSnapshot }) => {
      const vars = Object.entries(stateSnapshot).map(([k,v]) =>
        `<span class="exec-snap-var">${escHtml(k)}</span><span class="exec-snap-eq">=</span><span class="exec-snap-num">${escHtml(String(v))}</span>`
      ).join('  ');
      rows += `
        <tr class="exec-trace-row" style="animation-delay:${((step-1)*delayPerRow).toFixed(0)}ms">
          <td class="exec-trace-step">${step}</td>
          <td class="exec-trace-instr">${escHtml(instr)}</td>
          <td class="exec-trace-snap">${vars || '<span class="exec-empty">—</span>'}</td>
        </tr>`;
    });

    const truncNote = truncated
      ? `<tr><td colspan="3" style="text-align:center;padding:.5rem;font-size:.75rem;color:var(--text-muted);font-style:italic">
           … ${trace.length - MAX_ROWS} more steps not shown (${trace.length} total)
         </td></tr>`
      : '';

    return `
      <div class="exec-panel">
        <div class="exec-panel-header">${escHtml(label)}</div>
        <div class="exec-trace-wrap">
          <table class="exec-trace-table">
            <thead><tr><th>#</th><th>Instruction</th><th>State before</th></tr></thead>
            <tbody>${rows}${truncNote}</tbody>
          </table>
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="section-label">Execution Summary</div>
    <div class="exec-summary-row">
      ${summaryCard('Original TAC', origResult)}
      ${summaryCard('Optimized TAC', optResult)}
    </div>
    <div class="section-label" style="margin-top:1.5rem">Execution Trace</div>
    <div class="exec-traces-row">
      ${tracePanel('Original TAC — Trace', origResult)}
      ${tracePanel('Optimized TAC — Trace', optResult)}
    </div>`;
}

// ── Compare Rendering ─────────────────────────────────────────
function simpleDiff(leftLines, rightLines) {
  const m = leftLines.length, n = rightLines.length;
  // Use typed arrays for faster DP allocation and GC
  const dp = new Int32Array((m + 1) * (n + 1));
  const idx = (r, c) => r * (n + 1) + c;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i-1] === rightLines[j-1]) {
        dp[idx(i,j)] = dp[idx(i-1, j-1)] + 1;
      } else {
        dp[idx(i,j)] = Math.max(dp[idx(i-1, j)], dp[idx(i, j-1)]);
      }
    }
  }

  let i = m, j = n;
  const path = [];
  while (i > 0 && j > 0) {
    if (leftLines[i-1] === rightLines[j-1]) {
      path.push({ i: i-1, j: j-1 });
      i--; j--;
    } else if (dp[idx(i-1, j)] >= dp[idx(i, j-1)]) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();

  const diff = [];
  let currL = 0, currR = 0;
  
  const processUnmatched = (limitL, limitR) => {
    const unL = [], unR = [];
    while (currL < limitL) unL.push(leftLines[currL++]);
    while (currR < limitR) unR.push(rightLines[currR++]);
    
    const maxLen = Math.max(unL.length, unR.length);
    for (let k = 0; k < maxLen; k++) {
      if (k < unL.length && k < unR.length) diff.push({ left: unL[k], right: unR[k], type: 'modified' });
      else if (k < unL.length)              diff.push({ left: unL[k], right: '', type: 'removed' });
      else                                  diff.push({ left: '', right: unR[k], type: 'added' });
    }
  };

  for (const match of path) {
    processUnmatched(match.i, match.j);
    diff.push({ left: leftLines[match.i], right: rightLines[match.j], type: 'same' });
    currL++; currR++;
  }
  processUnmatched(m, n);
  
  return diff;
}

function renderCompareTab(leftInstrs, rightInstrs) {
  const container = document.getElementById('compareGrid');
  if (!container) return;
  
  const leftLines = leftInstrs.map(i => i.raw);
  const rightLines = rightInstrs.map(i => i.raw);
  
  if (leftLines.join('\\n') === rightLines.join('\\n')) {
    container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-secondary);">No differences — outputs are identical</div>`;
    return;
  }
  
  const diffs = simpleDiff(leftLines, rightLines);
  let html = '';
  
  let leftLineNum = 1, rightLineNum = 1;
  const esc = str => str ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  
  for (const d of diffs) {
    let lCls = 'diff-cell', rCls = 'diff-cell';
    let lText = '&nbsp;', rText = '&nbsp;';
    
    if (d.type === 'same') {
      lText = `<span class="diff-line-number">${leftLineNum++} |</span>${esc(d.left)}`;
      rText = `<span class="diff-line-number">${rightLineNum++} |</span>${esc(d.right)}`;
    } else if (d.type === 'modified') {
      lCls += ' diff-modified'; rCls += ' diff-modified';
      lText = `<span class="diff-line-number">${leftLineNum++} |</span>${esc(d.left)}`;
      rText = `<span class="diff-line-number">${rightLineNum++} |</span>${esc(d.right)}`;
    } else if (d.type === 'removed') {
      lCls += ' diff-removed';
      lText = `<span class="diff-line-number">${leftLineNum++} |</span>${esc(d.left)}`;
    } else if (d.type === 'added') {
      rCls += ' diff-added';
      rText = `<span class="diff-line-number">${rightLineNum++} |</span>${esc(d.right)}`;
    }
    
    html += `
      <div class="diff-row">
        <div class="${lCls}">${lText}</div>
        <div class="${rCls}">${rText}</div>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

// ── Expose ───────────────────────────────────────────────────
window.renderTAC        = renderTAC;
window.renderCFG        = renderCFG;
window.renderPipeline   = renderPipeline;
window.renderOutput     = renderOutput;
window.renderMetrics    = renderMetrics;
window.renderExecution  = renderExecution;
window.renderCompareTab = renderCompareTab;
window.switchTab        = switchTab;
window.togglePass       = togglePass;
window.escHtml          = escHtml;
window.cfgHighlight     = cfgHighlight;
window.cfgToggleLV      = cfgToggleLV;
