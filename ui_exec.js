// ============================================================
//  UI_EXEC.JS — Functions View · Call Stack · Execution Trace
// ============================================================

// ── Functions View ────────────────────────────────────────────
function renderFunctionsView(funcTable) {
  const el = document.getElementById('funcViewContainer');
  if (!el) return;
  const names = Object.keys(funcTable);
  if (!names.length) {
    el.innerHTML = '<div class="pass-no-change">No function definitions found. Use TAC mode with <code>func name:</code> syntax.</div>';
    return;
  }

  let html = '<div class="func-grid">';
  names.forEach(name => {
    const fn = funcTable[name];
    const formals = fn.formals || [];
    const body = fn.body || [];
    const sig = `${name}(${formals.join(', ')})`;

    html += `<div class="func-card">
      <div class="func-card-hdr">
        <span class="func-name">func <strong>${escHtml(sig)}</strong></span>
        <span class="func-stats">${formals.length} params · ${body.length} instrs</span>
      </div>
      ${formals.length ? `<div class="func-params-row">
        ${formals.map(f => `<span class="func-param-tag">${escHtml(f)}</span>`).join('')}
      </div>` : ''}
      <div class="func-body">
        ${body.length ? body.map((ins, i) => `<div class="func-instr-line">
          <span class="fi-num">${i + 1}</span>
          <span class="fi-code">${escHtml(instrToStr(ins))}</span>
        </div>`).join('') : '<div class="fi-empty">empty body</div>'}
      </div>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

// ── Call Stack Panel ──────────────────────────────────────────
function renderCallStack(stackSnap) {
  const el = document.getElementById('callStackPanel');
  if (!el) return;
  if (!stackSnap || !stackSnap.length) {
    el.innerHTML = '<div class="cs-empty">Stack is empty</div>';
    return;
  }

  let html = '<div class="cs-stack">';
  // Render top of stack first (highest index = current frame)
  [...stackSnap].reverse().forEach((frame, i) => {
    const isTop = i === 0;
    const envStr = Object.entries(frame.env || {})
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `<span class="cs-var">${escHtml(k)}<span class="cs-eq">=</span>${v !== null ? v : '?'}</span>`)
      .join('');
    html += `<div class="cs-frame ${isTop ? 'cs-top' : ''}">
      <div class="cs-frame-top-bar">
        ${isTop ? '<span class="cs-top-badge">▶ ACTIVE</span>' : ''}
        <span class="cs-fname">${escHtml(frame.name)}</span>
      </div>
      <div class="cs-vars">${envStr || '<span class="cs-empty-vars">no locals yet</span>'}</div>
    </div>`;
  });
  // Stack base indicator
  html += '<div class="cs-base">⊥ Stack Base</div>';
  html += '</div>';
  el.innerHTML = html;
}

// ── Execution Trace Panel ─────────────────────────────────────
let _execStep = 0;
let _execTrace = [];

function initExecTrace(trace) {
  _execTrace = trace;
  _execStep = 0;
  renderExecAtStep(0);
}

function renderExecAtStep(stepIdx) {
  _execStep = Math.max(0, Math.min(stepIdx, _execTrace.length - 1));
  const step = _execTrace[_execStep];

  // Counter
  const counter = document.getElementById('execStepCounter');
  if (counter) counter.textContent = `Step ${_execStep + 1} / ${_execTrace.length}`;

  // Prev/Next button states
  const prevBtn = document.getElementById('execPrevBtn');
  const nextBtn = document.getElementById('execNextBtn');
  if (prevBtn) prevBtn.disabled = _execStep === 0;
  if (nextBtn) nextBtn.disabled = _execStep === _execTrace.length - 1;

  if (!step) return;

  // Call stack
  renderCallStack(step.stackSnap);

  // Trace history list
  const el = document.getElementById('execTracePanel');
  if (!el) return;

  const start = Math.max(0, _execStep - 7);
  let html = '';

  for (let i = start; i <= _execStep; i++) {
    const s = _execTrace[i];
    const isCur = i === _execStep;
    const rowCls = isCur ? 'et-row et-current' : 'et-row et-past';
    const typeIcon = s.callEvent ? '📞' : s.returnEvent ? '↩' : '▸';

    html += `<div class="${rowCls}">
      <span class="et-icon">${typeIcon}</span>
      <span class="et-func">${escHtml(s.funcName)}</span>
      <span class="et-instr">${escHtml(s.instr)}</span>
      <span class="et-note">${escHtml(s.note)}</span>
    </div>`;

    if (s.callEvent) {
      const ps = s.callEvent.formals.map((f, i) => `${f} = ${s.callEvent.env[f]}`).join(', ');
      html += `<div class="et-call-banner">
        📞 Calling <strong>${escHtml(s.callEvent.func)}</strong>(${escHtml(ps)})
        <div class="et-param-list">${s.callEvent.params.map(p =>
        `<span class="et-param"><span class="et-param-name">${escHtml(p.name)}</span><span class="et-param-val">${p.value}</span></span>`
      ).join('')}</div>
      </div>`;
    }
    if (s.returnEvent) {
      html += `<div class="et-return-banner">
        ↩ <strong>${escHtml(s.returnEvent.func)}</strong> returned:
        <span class="et-retval">${s.returnEvent.value}</span>
      </div>`;
    }
  }

  el.innerHTML = html || '<div class="pass-no-change">Begin stepping through execution.</div>';
  // Auto-scroll to bottom
  el.scrollTop = el.scrollHeight;
}

function execStepForward() {
  if (_execStep < _execTrace.length - 1) renderExecAtStep(_execStep + 1);
}
function execStepBack() {
  if (_execStep > 0) renderExecAtStep(_execStep - 1);
}
function execStepFirst() { renderExecAtStep(0); }
function execStepLast() { renderExecAtStep(_execTrace.length - 1); }

// ── Return value summary ──────────────────────────────────────
function renderReturnValues(trace) {
  const el = document.getElementById('retvalPanel');
  if (!el) return;
  const returns = trace.filter(s => s.returnEvent);
  if (!returns.length) {
    el.innerHTML = '<div class="pass-no-change">No return events in trace.</div>';
    return;
  }
  let html = '';
  returns.forEach(s => {
    html += `<div class="rv-row">
      <span class="rv-func">${escHtml(s.returnEvent.func)}</span>
      <span class="rv-arrow">→</span>
      <span class="rv-val">${s.returnEvent.value}</span>
    </div>`;
  });
  el.innerHTML = html;
}

window.renderFunctionsView = renderFunctionsView;
window.renderCallStack = renderCallStack;
window.initExecTrace = initExecTrace;
window.renderExecAtStep = renderExecAtStep;
window.execStepForward = execStepForward;
window.execStepBack = execStepBack;
window.execStepFirst = execStepFirst;
window.execStepLast = execStepLast;
window.renderReturnValues = renderReturnValues;
