// ============================================================
//  EXECUTOR.JS — Unified TAC Interpreter
//  Supports: Multi-function calls, Stacks, Loops, and Branches.
// ============================================================

const MAX_STEPS = 5000;

/**
 * Resolve a value in the current environment.
 */
function resolveVal(v, env, retVal) {
  if (v === null || v === undefined) return 0;
  if (v === 'retval') return retVal !== null ? retVal : 0;
  const n = Number(v);
  if (!isNaN(n) && v !== '') return n;
  return env[v] !== undefined ? env[v] : 0;
}

/**
 * Evaluate binary operations.
 */
function evalBinop(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b !== 0 ? Math.trunc(a / b) : 0;
    case '%': return b !== 0 ? a % b : 0;
    default:  return 0;
  }
}

/**
 * Evaluate comparison conditions.
 */
function evalCond(a, cond, b) {
  switch (cond) {
    case '>':  return a >  b;
    case '<':  return a <  b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default:   return false;
  }
}

/**
 * Parse flat TAC into a function table with label maps.
 */
function parseFunctionTable(instrs) {
  const table = {};
  let cur = '__main__';
  let atStart = false;

  for (let i = 0; i < instrs.length; i++) {
    const ins = instrs[i];
    if (ins.op === 'func') {
      cur = ins.label;
      table[cur] = { formals: [], body: [], labelMap: {} };
      atStart = true;
    } else if (atStart && ins.op === 'param') {
      table[cur].formals.push(ins.arg1);
    } else {
      atStart = false;
      if (!table[cur]) table[cur] = { formals: [], body: [], labelMap: {} };
      const bodyIdx = table[cur].body.length;
      if (ins.op === 'label') {
        table[cur].labelMap[ins.label] = bodyIdx;
      }
      table[cur].body.push(ins);
    }
  }
  return table;
}

/**
 * Execute the function table starting from 'main' or the first function.
 */
function executeTAC(funcTable) {
  const trace  = [];
  const stack  = [];
  const params = []; // for pending 'param' instructions

  const startName = funcTable['main'] ? 'main' : Object.keys(funcTable)[0];
  if (!startName) return { trace: [], finalValue: null };

  let frame = {
    name:   startName,
    body:   funcTable[startName].body,
    lMap:   funcTable[startName].labelMap,
    env:    {},
    pc:     0
  };

  let retVal = null;
  let steps  = 0;

  while (steps++ < MAX_STEPS) {
    if (frame.pc >= frame.body.length) {
      if (stack.length) {
        frame = stack.pop();
        continue;
      } else break;
    }

    const ins = frame.body[frame.pc];
    const step = {
      funcName: frame.name,
      pc:       frame.pc,
      instr:    window.instrToStr ? window.instrToStr(ins) : (ins.raw || ins.op),
      env:      { ...frame.env },
      stackSnap: [...stack.map(f => ({ name: f.name, env: { ...f.env } })),
                  { name: frame.name, env: { ...frame.env } }],
      note:     '',
      callEvent:   null,
      returnEvent: null
    };

    let pcAdvanced = false;

    switch (ins.op) {
      case 'assign': {
        const val = resolveVal(ins.arg1, frame.env, retVal);
        frame.env[ins.result] = val;
        step.note = `${ins.result} = ${val}`;
        break;
      }
      case 'binop': {
        const a = resolveVal(ins.arg1, frame.env, retVal);
        const b = resolveVal(ins.arg2, frame.env, retVal);
        const res = evalBinop(a, ins.operator, b);
        frame.env[ins.result] = res;
        step.note = `${ins.result} = ${a} ${ins.operator} ${b} = ${res}`;
        break;
      }
      case 'label':
        step.note = 'label';
        break;
      case 'goto': {
        const target = frame.lMap[ins.label];
        if (frame.lMap[ins.label] !== undefined) {
          frame.pc = frame.lMap[ins.label];
          pcAdvanced = true;
        } else {
          console.warn(`Label ${ins.label} not found`);
          frame.pc++;
          pcAdvanced = true;
        }
        break;
      }
      case 'if': {
        const a = resolveVal(ins.arg1, frame.env, retVal);
        const b = resolveVal(ins.arg2, frame.env, retVal);
        if (evalCond(a, ins.cond, b)) {
          const target = frame.lMap[ins.label];
          if (target !== undefined) {
            frame.pc = target;
            pcAdvanced = true;
          } else {
            console.warn(`Label ${ins.label} not found`);
            frame.pc++;
            pcAdvanced = true;
          }
        } else {
          frame.pc++;
          pcAdvanced = true;
        }
        break;
      }
      case 'param': {
        const val = resolveVal(ins.arg1, frame.env, retVal);
        params.push({ name: ins.arg1, value: val });
        step.note = `param ${ins.arg1} = ${val}`;
        break;
      }
      case 'call': {
        const targetName = ins.label;
        const callee = funcTable[targetName];
        if (callee) {
          const newEnv = {};
          callee.formals.forEach((formal, i) => {
            newEnv[formal] = params[i] !== undefined ? params[i].value : 0;
          });
          step.callEvent = { func: targetName, params: [...params], formals: callee.formals, env: { ...newEnv } };
          step.note = `call ${targetName}`;
          stack.push({ ...frame, pc: frame.pc + 1 });
          frame = { name: targetName, body: callee.body, lMap: callee.labelMap, env: newEnv, pc: 0 };
          params.length = 0;
          pcAdvanced = true;
        } else {
          step.note = `error: unknown function ${targetName}`;
        }
        break;
      }
      case 'return': {
        retVal = ins.arg1 !== null ? resolveVal(ins.arg1, frame.env, retVal) : null;
        step.returnEvent = { func: frame.name, value: retVal };
        step.note = `return ${retVal}`;
        if (stack.length) {
          frame = stack.pop();
          pcAdvanced = false; // We already advanced pc when pushing
        } else {
          frame.pc = frame.body.length; // halt
          pcAdvanced = true;
        }
        break;
      }
      default:
        step.note = 'skip';
    }

    trace.push(step);
    if (!pcAdvanced) frame.pc++;
  }

  return { trace, finalValue: retVal, error: steps >= MAX_STEPS ? 'Max steps reached' : null };
}

window.parseFunctionTable = parseFunctionTable;
window.executeTAC          = executeTAC;
