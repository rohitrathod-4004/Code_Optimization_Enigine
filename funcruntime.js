// ============================================================
//  FUNCRUNTIME.JS — Multi-Function Table + Execution Simulator
// ============================================================

// ── Parse flat TAC into per-function structure ────────────────
// Returns: { funcName: { formals:[], body:[] }, ... }
function parseFunctionTable(instrs) {
  const table = {};
  let cur = '__main__';
  let atStart = false;     // true right after a 'func' header

  for (const ins of instrs) {
    if (ins.op === 'func') {
      cur = ins.label;
      table[cur] = { formals: [], body: [] };
      atStart = true;
    } else if (atStart && ins.op === 'param') {
      // Formal parameter declaration  e.g.  func sum: / param a / param b
      table[cur].formals.push(ins.arg1);
    } else {
      atStart = false;
      if (!table[cur]) table[cur] = { formals: [], body: [] };
      table[cur].body.push(ins);
    }
  }
  return table;
}

// ── Evaluate a value in an env ────────────────────────────────
function frtEval(v, env, retVal) {
  if (v === undefined || v === null) return null;
  if (v === 'retval') return retVal;
  if (!isNaN(Number(v)) && v !== '') return Number(v);
  return env[v] !== undefined ? env[v] : null;
}

// ── Execution simulator ───────────────────────────────────────
// Returns: { trace[], finalValue }
function simulateExecution(funcTable, maxSteps = 300) {
  const trace  = [];
  const stack  = [];   // saved frames (caller frames below current)
  const pending = [];  // params accumulated before a call

  // Start in 'main' or first function
  const startName = funcTable['main'] ? 'main' : Object.keys(funcTable)[0];
  if (!startName) return { trace, finalValue: null };

  let frame = {
    name:   startName,
    body:   (funcTable[startName] || { body:[] }).body,
    env:    {},
    pc:     0
  };

  let retVal = null;
  let steps  = 0;

  while (steps++ < maxSteps) {
    if (frame.pc >= frame.body.length) {
      // Implicit return at end of function
      if (stack.length) {
        frame = stack.pop();
      } else break;
      continue;
    }

    const ins = frame.body[frame.pc];

    const step = {
      funcName: frame.name,
      pc:       frame.pc,
      instr:    instrToStr(ins),
      env:      { ...frame.env },
      // snapshot of call stack (bottom = main, top = current)
      stackSnap: [...stack.map(f => ({ name: f.name, env: { ...f.env } })),
                  { name: frame.name, env: { ...frame.env } }],
      note:     '',
      callEvent:   null,
      returnEvent: null
    };

    switch (ins.op) {
      case 'assign': {
        const val = frtEval(ins.arg1, frame.env, retVal);
        frame.env[ins.result] = val;
        step.note = `${ins.result} ← ${val !== null ? val : ins.arg1}`;
        if (ins.arg1 === 'retval') step.note += ` (return value from last call)`;
        break;
      }
      case 'binop': {
        const a = frtEval(ins.arg1, frame.env, retVal);
        const b = frtEval(ins.arg2, frame.env, retVal);
        const op = ins.operator;
        let val = null;
        if (op==='+') val=a+b; else if (op==='-') val=a-b;
        else if (op==='*') val=a*b;
        else if (op==='/' && b!==0) val=Math.trunc(a/b);
        else if (op==='%' && b!==0) val=a%b;
        frame.env[ins.result] = val;
        step.note = `${ins.result} ← ${a} ${op} ${b} = ${val}`;
        break;
      }
      case 'param': {
        const val = frtEval(ins.arg1, frame.env, retVal);
        pending.push({ name: ins.arg1, value: val });
        step.note = `push param ${ins.arg1} = ${val}`;
        break;
      }
      case 'call': {
        const calledName = ins.label;
        const callee = funcTable[calledName] || { formals:[], body:[] };
        // Build new env from formals + pending params
        const newEnv = {};
        callee.formals.forEach((formal, i) => {
          newEnv[formal] = pending[i] !== undefined ? pending[i].value : null;
        });
        const paramSummary = callee.formals.map((f,i) => `${f}=${newEnv[f]}`).join(', ');
        step.note = `call ${calledName}(${paramSummary})`;
        step.callEvent = { func: calledName, params: [...pending], formals: callee.formals, env: { ...newEnv } };
        // Push current frame (advance pc to after the call)
        stack.push({ ...frame, pc: frame.pc + 1 });
        // Switch to new frame
        frame = { name: calledName, body: callee.body, env: newEnv, pc: 0 };
        pending.length = 0;
        trace.push(step);
        continue;  // don't increment pc — we're in a new frame
      }
      case 'return': {
        retVal = ins.arg1 ? frtEval(ins.arg1, frame.env, retVal) : null;
        step.note = `${frame.name} returns ${retVal}`;
        step.returnEvent = { func: frame.name, value: retVal };
        if (stack.length) {
          frame = stack.pop();
          step.note += ` → resume ${frame.name}`;
        } else {
          trace.push(step);
          break;
        }
        trace.push(step);
        continue;
      }
      case 'if': {
        const a = frtEval(ins.arg1, frame.env, retVal);
        const b = frtEval(ins.arg2, frame.env, retVal);
        step.note = `if ${a} ${ins.cond} ${b} → (skip branch in simulation)`;
        break;
      }
      case 'label': case 'goto': case 'func':
        step.note = '(control flow)';
        break;
      default:
        step.note = '—';
    }

    trace.push(step);
    frame.pc++;
  }

  return { trace, finalValue: retVal };
}

window.parseFunctionTable  = parseFunctionTable;
window.simulateExecution   = simulateExecution;
