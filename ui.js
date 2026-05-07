// ============================================================
//  UI  — Premium Unified Rendering Hub
// ============================================================

// ── TAC Renderer ─────────────────────────────────────────────
function renderTAC(instrs) {
  const grid = document.getElementById('tacGrid');
  if (!grid) return;
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
      <span class="tac-code ${cls}">${escHtml(window.instrToStr(ins))}</span>
    </div>`;
  });
  grid.innerHTML = html;
}

function tacClass(op) {
  if (op === 'label' || op === 'func') return 'tac-label';
  if (op === 'goto') return 'tac-goto';
  if (op === 'if') return 'tac-if';
  if (op === 'return' || op === 'call') return 'tac-return';
  return 'tac-assign';
}

// ── CFG Renderer (Premium SVG Logic) ─────────────────────────
function renderCFG(blocks) {
  const container = document.getElementById('cfgContainer');
  if (!container) return;
  if (!blocks.length) { container.innerHTML = '<div class="pass-no-change">No blocks.</div>'; return; }

  // 1. Detect back-edges and levels
  const backEdgeSet = new Set();
  const dfsVisited = new Set(), dfsStack = new Set();
  function dfs(b) {
    dfsVisited.add(b.id); dfsStack.add(b.id);
    b.successors.forEach(s => {
      if (dfsStack.has(s.id)) backEdgeSet.add(`${b.id}→${s.id}`);
      else if (!dfsVisited.has(s.id)) dfs(s);
    });
    dfsStack.delete(b.id);
  }
  dfs(blocks[0]);

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

  // 2. Layout Constants
  const NODE_W = 220, LINE_H = 17, HDR_H = 36, PAD = 10, V_GAP = 80, H_GAP = 50;
  const levelGroups = {};
  blocks.forEach(b => { const lv = levels[b.id]; if (!levelGroups[lv]) levelGroups[lv] = []; levelGroups[lv].push(b); });
  const numLevels = Math.max(...Object.keys(levelGroups).map(Number)) + 1;
  
  const pos = {};
  let cy = 60;
  for (let lv = 0; lv < numLevels; lv++) {
    const grp = levelGroups[lv] || [];
    const rowW = grp.length * NODE_W + (grp.length - 1) * H_GAP;
    const sx = (900 - rowW) / 2;
    let maxH = 0;
    grp.forEach((b, i) => {
      const h = HDR_H + PAD + Math.max(b.instrs.length, 1) * LINE_H + PAD;
      pos[b.id] = { x: sx + i * (NODE_W + H_GAP), y: cy, w: NODE_W, h: h };
      if (h > maxH) maxH = h;
    });
    cy += maxH + V_GAP;
  }

  // 3. Build SVG
  let svg = `<svg width="900" height="${cy + 60}" viewBox="0 0 900 ${cy + 60}">
    <defs>
      <marker id="arrowFwd"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#6C63FF"/></marker>
      <marker id="arrowTrue" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#22d3a5"/></marker>
      <marker id="arrowFalse" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#ff5672"/></marker>
      <marker id="arrowBack"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#A78BFA"/></marker>
    </defs>`;
  
  // Edges
  blocks.forEach(from => {
    from.successors.forEach(to => {
      const isBack = backEdgeSet.has(`${from.id}→${to.id}`);
      const fp = pos[from.id], tp = pos[to.id];
      if (!fp || !tp) return;

      const last = from.instrs[from.instrs.length-1];
      const isBranch = last && last.op === 'if' && from.successors.length === 2;
      const isTrue = isBranch && to === from.successors[0];
      const isFalse = isBranch && to === from.successors[1];

      const color = isTrue ? '#22d3a5' : isFalse ? '#ff5672' : isBack ? '#A78BFA' : '#6C63FF';
      const marker = isTrue ? 'arrowTrue' : isFalse ? 'arrowFalse' : isBack ? 'arrowBack' : 'arrowFwd';
      const dash = isBack ? '5,3' : 'none';

      const sx = fp.x + fp.w/2, sy = fp.y + fp.h;
      const tx = tp.x + tp.w/2, ty = tp.y;
      
      if (isBack) {
        const cx = Math.min(fp.x, tp.x) - 40;
        svg += `<path d="M ${fp.x} ${fp.y + fp.h/2} C ${cx} ${fp.y + fp.h/2} ${cx} ${tp.y + tp.h/2} ${tp.x} ${tp.y + tp.h/2}" 
                 stroke="${color}" stroke-dasharray="${dash}" fill="none" stroke-width="1.8" marker-end="url(#${marker})"/>`;
      } else {
        svg += `<path d="M ${sx} ${sy} C ${sx} ${sy + 35} ${tx} ${ty - 35} ${tx} ${ty}" 
                 stroke="${color}" fill="none" stroke-width="1.8" marker-end="url(#${marker})"/>`;
      }
    });
  });

  // Nodes
  blocks.forEach(b => {
    const p = pos[b.id];
    const isEntry = b.id === 0;
    const isExit = b.instrs.some(i => i.op === 'return');
    const color = isEntry ? '#22d3a5' : isExit ? '#ff5672' : '#6C63FF';
    
    // Header
    svg += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${HDR_H}" rx="8" fill="${color}" fill-opacity="0.15"/>`;
    svg += `<text x="${p.x+12}" y="${p.y+23}" fill="${color}" font-family="var(--font-mono)" font-size="13" font-weight="700">${escHtml(b.name)}</text>`;
    // Body
    svg += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.4"/>`;
    b.instrs.forEach((ins, i) => {
      svg += `<text x="${p.x+12}" y="${p.y+HDR_H+PAD+i*LINE_H+12}" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="11">${escHtml(window.instrToStr(ins))}</text>`;
    });
  });

  svg += `</svg>`;
  container.innerHTML = `<div class="cfg-svg-wrap">${svg}</div>`;
}

// ── Metrics Renderer (Premium Dashboard) ─────────────────────
function renderMetrics(original, passes, optimized) {
  const grid = document.getElementById('metricsGrid');
  if (!grid) return;

  const mBefore = window.computeMetrics(original);
  const mAfter  = window.computeMetrics(optimized);
  const diff    = window.compareMetrics(original, optimized);

  grid.innerHTML = `
    ${metricCard('📊','Instructions', mBefore.instructionCount, mAfter.instructionCount, '--purple', diff.improvement.instructionReductionPercent)}
    ${metricCard('⚡','Est. Cost', mBefore.estimatedCost, mAfter.estimatedCost, '--orange', diff.improvement.costReductionPercent)}
    ${metricCard('🧠','Memory Usage', mBefore.memoryUsage, mAfter.memoryUsage, '--cyan', diff.improvement.memoryReductionPercent)}
    ${metricCard('🔧','Passes Applied', passes.length, passes.filter(p=>p.changes.length>0).length, '--green', '')}
  `;

  // Detailed breakdown
  const details = document.getElementById('optDetails');
  if (details) {
    let html = `<div class="section-label">Optimization Timeline</div>`;
    passes.forEach(p => {
      if (p.changes.length === 0) return;
      html += `<div class="opt-detail-row">
        <span class="opt-detail-icon">⚙️</span>
        <div class="opt-detail-text">
          <strong>${p.name}</strong> applied ${p.changes.length} transformations.
        </div>
      </div>`;
    });
    details.innerHTML = html;
  }
}

function metricCard(icon, label, before, after, colorVar, improve) {
  const isBetter = improve > 0;
  return `
    <div class="metric-card" style="--metric-color:var(${colorVar})">
      <span class="metric-icon">${icon}</span>
      <span class="metric-label">${label}</span>
      <div class="metric-compare">
        <span class="m-val-old">${before}</span>
        <span class="m-arrow">→</span>
        <span class="m-val-new">${after}</span>
      </div>
      ${improve !== '' ? `<span class="metric-pct ${isBetter?'text-green':'text-muted'}">${isBetter?'+':''}${improve}% better</span>` : ''}
    </div>
  `;
}

// ── Pipeline Renderer ─────────────────────────────────────────
function renderPipeline(passes) {
  const container = document.getElementById('pipelinePasses');
  if (!container) return;
  let html = '';
  passes.forEach((pass, pi) => {
    const hasChanges = pass.changes.length > 0;
    const badgeCls = hasChanges ? 'pass-badge-applied' : 'pass-badge-skip';
    const badgeTxt = hasChanges ? `${pass.changes.length} changes` : 'No change';
    
    let diffHtml = '';
    if (hasChanges) {
      diffHtml = `<table class="diff-table"><thead><tr><th>Before</th><th>After</th><th>Note</th></tr></thead><tbody>`;
      pass.changes.forEach(c => {
        diffHtml += `<tr class="${c.type==='removed'?'diff-row-removed':'diff-row-changed'}">
          <td>${escHtml(c.before)}</td><td>${escHtml(c.after)}</td><td>${escHtml(c.note)}</td>
        </tr>`;
      });
      diffHtml += '</tbody></table>';
    } else {
      diffHtml = `<div class="pass-no-change">✓ No optimizations applied in this pass.</div>`;
    }

    html += `<div class="pass-card ${hasChanges?'has-changes':''}">
      <div class="pass-header" onclick="togglePass(${pi})">
        <span class="pass-name">⚙️ ${pass.name} <span class="pass-badge ${badgeCls}">${badgeTxt}</span></span>
        <span class="pass-toggle" id="pass-toggle-${pi}">▶</span>
      </div>
      <div class="pass-body ${pi===0?'open' : ''}" id="pass-body-${pi}">
        <div class="pass-description">${pass.description}</div>
        ${diffHtml}
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function togglePass(pi) {
  const body = document.getElementById(`pass-body-${pi}`);
  const tog = document.getElementById(`pass-toggle-${pi}`);
  if (body) body.classList.toggle('open');
  if (tog) tog.classList.toggle('open');
}

// ── Execution Tab (Premium Simulation) ────────────────────────
let _execTrace = [], _execStep = 0, _execInterval = null;

function initExecution(trace) {
  _execTrace = trace;
  _execStep = 0;
  stopAutoPlay();
  renderExecAtStep(0);
}

function renderExecAtStep(stepIdx) {
  const container = document.getElementById('executionView');
  if (!container || !_execTrace.length) return;
  _execStep = stepIdx;
  const step = _execTrace[_execStep];

  // 1. Highlight in TAC View (if visible)
  const tacLines = document.querySelectorAll('#tacGrid .tac-line');
  tacLines.forEach((line, idx) => {
    line.classList.toggle('active-exec', idx === step.pc);
    if (idx === step.pc) line.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // 2. Render Simulation UI
  let html = `
    <div class="exec-layout">
      <div class="exec-main">
        <div class="exec-controls">
          <button class="btn btn-secondary btn-sm" onclick="execStepBack()" ${_execStep===0?'disabled':''}>◀</button>
          <button class="btn btn-primary btn-sm" id="playBtn" onclick="toggleAutoPlay()">${_execInterval?'⏸ Pause':'▶ Play'}</button>
          <button class="btn btn-secondary btn-sm" onclick="execStepForward()" ${_execStep===_execTrace.length-1?'disabled':''}>▶</button>
          <div style="flex:1"></div>
          <span class="exec-status">Step ${(_execStep+1).toString().padStart(3,'0')} / ${_execTrace.length}</span>
        </div>
        
        <div class="exec-visual-pc">
          <div class="pc-marker">PC: ${step.pc}</div>
          <div class="pc-instr">${escHtml(step.instr)}</div>
          <div class="pc-note">${escHtml(step.note)}</div>
        </div>

        <div class="exec-trace-list">`;
  
  const start = Math.max(0, _execStep - 4);
  for (let i = start; i <= _execStep; i++) {
    const s = _execTrace[i];
    html += `<div class="exec-trace-row ${i===_execStep?'current':''}">
      <span class="etr-icon">${s.callEvent?'📞':s.returnEvent?'↩':'▸'}</span>
      <span class="etr-func">${s.funcName}</span>
      <span class="etr-code">${escHtml(s.instr)}</span>
      <span class="etr-note">${i===_execStep? 'Current' : 'Done'}</span>
    </div>`;
  }

  html += `</div></div>
      <div class="exec-side">
        <div class="section-label">State & Stack</div>
        <div class="env-view">
          ${Object.entries(step.env).length ? Object.entries(step.env).map(([k,v])=>`
            <div class="env-row">
              <span class="env-key">${k}</span>
              <span class="env-val">${v}</span>
            </div>
          `).join('') : '<div class="pass-no-change">Empty environment</div>'}
        </div>
        <div class="section-label" style="margin-top:1.5rem">Call Stack</div>
        <div class="stack-view">`;
  
  if (step.stackSnap) {
    [...step.stackSnap].reverse().forEach((frame, i) => {
      html += `<div class="stack-frame ${i===0?'active':''}">
        <div class="sf-hdr">${frame.name}</div>
        <div class="sf-vars">${Object.keys(frame.env).length ? Object.entries(frame.env).map(([k,v])=>`<span class="stack-var">${k}=${v}</span>`).join('') : '—'}</div>
      </div>`;
    });
  }
  html += `</div></div></div>`;
  container.innerHTML = html;
}

function execStepForward() {
  if(_execStep < _execTrace.length-1) renderExecAtStep(_execStep+1);
  else stopAutoPlay();
}
function execStepBack() { if(_execStep > 0) renderExecAtStep(_execStep-1); }

function toggleAutoPlay() {
  if (_execInterval) stopAutoPlay();
  else {
    _execInterval = setInterval(execStepForward, 400);
    renderExecAtStep(_execStep); // refresh button state
  }
}
function stopAutoPlay() {
  if (_execInterval) { clearInterval(_execInterval); _execInterval = null; }
  const btn = document.getElementById('playBtn');
  if (btn) btn.innerHTML = '▶ Play';
}

window.toggleAutoPlay = toggleAutoPlay;

// ── Helpers ───────────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function switchTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
}

window.renderTAC = renderTAC;
window.renderCFG = renderCFG;
window.renderPipeline = renderPipeline;
// ── Data Flow Tab (Premium) ───────────────────────────────────
function renderDataFlow(instrs, instrLiveIn, instrLiveOut) {
  const el = document.getElementById('dfTable');
  if (!el) return;
  let html = `<table class="df-table"><thead><tr><th>#</th><th>Instruction</th><th>Live-In</th><th>Live-Out</th></tr></thead><tbody>`;
  instrs.forEach((ins, i) => {
    const lIn = [...(instrLiveIn[i] || [])].join(', ') || '∅';
    const lOut = [...(instrLiveOut[i] || [])].join(', ') || '∅';
    const isDead = ins.op === 'assign' && ins.result && !instrLiveOut[i]?.has(ins.result);
    html += `<tr class="${isDead?'df-row-dead':''}">
      <td class="df-num">${i+1}</td>
      <td class="df-instr">${escHtml(window.instrToStr(ins))}</td>
      <td class="df-set">${lIn}</td>
      <td class="df-set">${lOut}</td>
    </tr>`;
  });
  el.innerHTML = html + '</tbody></table>';
}

function renderInsights(varStats) {
  const el = document.getElementById('insightTable');
  if (!el) return;
  let html = `<table class="df-table"><thead><tr><th>Variable</th><th>Uses</th><th>Defs</th><th>Status</th></tr></thead><tbody>`;
  Object.entries(varStats).forEach(([v, s]) => {
    const status = s.uses === 0 ? '<span class="df-tag-dead">Unused</span>' : (s.constVal !== null ? '<span class="df-tag-const">Constant</span>' : '<span class="df-tag-live">Live</span>');
    html += `<tr>
      <td class="text-cyan mono"><strong>${v}</strong></td>
      <td>${s.uses}</td>
      <td>${s.defs}</td>
      <td>${status}</td>
    </tr>`;
  });
  el.innerHTML = html + '</tbody></table>';
}

// ── Compare Tab (Premium) ─────────────────────────────────────
function renderCompare(original, optimized) {
  const container = document.getElementById('compareContainer');
  if (!container) return;
  const max = Math.max(original.length, optimized.length);
  let html = `<div class="compare-grid"><div class="compare-col"><div class="compare-hdr">Original Code</div>`;
  for(let i=0; i<max; i++) {
    html += `<div class="compare-row"><span class="compare-num">${i+1}</span><span class="compare-code">${original[i]?escHtml(window.instrToStr(original[i])):''}</span></div>`;
  }
  html += `</div><div class="compare-col"><div class="compare-hdr">Optimized Code</div>`;
  for(let i=0; i<max; i++) {
    const origStr = original[i] ? window.instrToStr(original[i]) : '';
    const optStr = optimized[i] ? window.instrToStr(optimized[i]) : '';
    const changed = origStr !== optStr;
    html += `<div class="compare-row ${changed?'changed':''}"><span class="compare-num">${i+1}</span><span class="compare-code">${optStr || ''}</span></div>`;
  }
  html += `</div></div>`;
  container.innerHTML = html;
}

// ── Report Tab (Premium) ──────────────────────────────────────
function renderReport(original, passes, optimized, oLevel) {
  const el = document.getElementById('reportContent');
  if (!el) return;
  const changedPasses = passes.filter(p => p.changes.length > 0);
  let html = `
    <div class="report-header">
      <div class="report-title">Compilation Report</div>
      <div class="report-level">Optimization Level: <strong>O${oLevel}</strong></div>
    </div>
    <div class="report-section-title">Global Summary</div>
    <div class="report-summary-grid">
      <div class="rs-card"><span class="rs-label">Original</span><span class="rs-val">${original.length}</span></div>
      <div class="rs-card" style="border-color:var(--green)"><span class="rs-label">Optimized</span><span class="rs-val text-green">${optimized.length}</span></div>
      <div class="rs-card" style="border-color:var(--purple)"><span class="rs-label">Reduction</span><span class="rs-val text-purple">${original.length?Math.round((original.length-optimized.length)/original.length*100):0}%</span></div>
    </div>
    <div class="report-section-title">Pipeline Efficiency</div>
    <div class="report-rows">`;
  
  passes.forEach(p => {
    const n = p.changes.length;
    html += `<div class="report-row ${n?'rr-applied':'rr-skipped'}">
      <span class="rr-icon">${n?'✅':'⏭️'}</span>
      <span class="rr-name">${p.name}</span>
      <span class="rr-val">${n ? n+' optimizations' : 'No changes'}</span>
    </div>`;
  });
  el.innerHTML = html + `</div>`;
}

// ── Output Tab ────────────────────────────────────────────────
function renderOutput(optimized) {
  const tac = document.getElementById('optimizedTAC');
  const c = document.getElementById('reconstructedC');
  if (tac) tac.textContent = optimized.map(ins => window.instrToStr(ins)).join('\n');
  if (c) c.textContent = '// Optimized Code Output\n' + optimized.map(ins => window.instrToStr(ins)).join('\n');
}

window.renderDataFlow = renderDataFlow;
window.renderInsights = renderInsights;
window.renderCompare = renderCompare;
window.renderReport = renderReport;
window.renderOutput = renderOutput;
window.initExecution = initExecution;
window.switchTab = switchTab;
window.execStepForward = execStepForward;
window.execStepBack = execStepBack;
window.togglePass = togglePass;
