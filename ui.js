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
  blocks.forEach(b => {
    const vis = b.instrs.filter(i => i.op !== 'label');
    nodeH[b.id] = HDR_H + PAD + Math.max(vis.length, 1) * LINE_H + PAD;
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
  <div class="cfg-legend">
    <span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#22d3a5"></span>Entry</span>
    <span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#6C63FF"></span>Basic</span>
    <span class="cfg-leg-item"><span class="cfg-leg-dot" style="background:#ff5672"></span>Exit</span>
    <span class="cfg-leg-item"><span class="cfg-leg-line" style="background:#22d3a5"></span>True branch</span>
    <span class="cfg-leg-item"><span class="cfg-leg-line" style="background:#ff5672"></span>False branch</span>
    <span class="cfg-leg-item"><span class="cfg-leg-line" style="background:#A78BFA;border-style:dashed"></span>Back edge ↺</span>
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
function renderMetrics(original, passes, optimized) {
  const origCount = original.filter(i => i.op !== 'label').length;
  const optCount  = optimized.filter(i => i.op !== 'label').length;
  const removed   = origCount - optCount;
  const pct       = origCount > 0 ? Math.round((removed / origCount) * 100) : 0;
  const totalChanges = passes.reduce((s, p) => s + p.changes.length, 0);
  const passesApplied = passes.filter(p => p.changes.length > 0).length;

  const grid = document.getElementById('metricsGrid');
  grid.innerHTML = `
    ${metricCard('📊','Instructions (Before)', origCount, '', '--purple')}
    ${metricCard('✅','Instructions (After)',  optCount,  '', '--green')}
    ${metricCard('🗑️','Instructions Removed',  removed,   '', '--cyan')}
    ${metricCard('📉','Reduction',  pct + '%', '', '--yellow', pct > 0 ? 'text-green' : '')}
    ${metricCard('⚡','Optimizations Applied', totalChanges, '', '--orange')}
    ${metricCard('🔧','Passes With Changes',   passesApplied + ' / ' + passes.length, '', '--purple-light')}
  `;

  // Details
  const details = document.getElementById('optDetails');
  let dhtml = '';
  for (const pass of passes) {
    if (!pass.changes.length) continue;
    dhtml += `<div class="opt-detail-row">
      <span class="opt-detail-icon">${passIcon(pass.name)}</span>
      <div class="opt-detail-text">
        <strong>${escHtml(pass.name)}</strong>: ${pass.changes.length} transformation${pass.changes.length > 1 ? 's' : ''} —
        ${pass.changes.map(c => `<span class="mono" style="font-size:.75rem;color:var(--cyan)">${escHtml(c.before)}</span> → <span class="mono" style="font-size:.75rem;color:var(--green)">${escHtml(c.after)}</span>`).join('; ')}
      </div>
    </div>`;
  }
  if (!dhtml) dhtml = `<div class="opt-detail-row"><span class="opt-detail-icon">ℹ️</span><div class="opt-detail-text">No optimizations were applicable to this code.</div></div>`;
  details.innerHTML = dhtml;
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

// ── Expose ───────────────────────────────────────────────────
window.renderTAC      = renderTAC;
window.renderCFG      = renderCFG;
window.renderPipeline = renderPipeline;
window.renderOutput   = renderOutput;
window.renderMetrics  = renderMetrics;
window.switchTab      = switchTab;
window.togglePass     = togglePass;
window.escHtml        = escHtml;
window.cfgHighlight   = cfgHighlight;
