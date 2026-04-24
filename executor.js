// ============================================================
//  EXECUTOR.JS — TAC Interpreter
//  Executes a list of TAC instructions and returns:
//    { finalState, executionTrace, returnValue, error }
// ============================================================

const MAX_STEPS = 10000; // guard against infinite loops

/**
 * Resolve a value: if it looks like a number literal return it as a number,
 * otherwise look it up in the variable map (default 0 when undefined).
 */
function resolveVal(v, vars) {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  if (!isNaN(n) && v !== '') return n;
  return vars[v] !== undefined ? vars[v] : 0;
}

/**
 * Evaluate a binary operation.
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
 * Evaluate a comparison condition.
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
 * Build a label → instruction-index map from the instruction list.
 */
function buildLabelMap(instrs) {
  const map = {};
  instrs.forEach((ins, idx) => {
    if (ins.op === 'label') map[ins.label] = idx;
  });
  return map;
}

/**
 * Take a snapshot of the current variable state (shallow copy).
 */
function snapshot(vars) {
  return Object.assign({}, vars);
}

// ── Main exported function ────────────────────────────────────

/**
 * executeTAC(instrs)
 *
 * @param  {Array}  instrs  — array of TAC instruction objects (from parser)
 * @returns {Object}
 *   {
 *     finalState:     { varName: numericValue, … },
 *     executionTrace: [ { step, instr, stateSnapshot }, … ],
 *     returnValue:    number | null,
 *     error:          string | null
 *   }
 */
function executeTAC(instrs) {
  const vars      = {};          // variable store
  const trace     = [];          // execution trace
  const labelMap  = buildLabelMap(instrs);

  let pc          = 0;           // program counter (instruction index)
  let step        = 0;
  let returnValue = null;
  let error       = null;

  while (pc < instrs.length) {
    if (step >= MAX_STEPS) {
      error = `Execution halted after ${MAX_STEPS} steps (possible infinite loop).`;
      break;
    }

    const ins = instrs[pc];
    if (!ins) break;

    // Record state BEFORE executing this instruction
    trace.push({
      step:          step + 1,
      instr:         instrToStr(ins),
      stateSnapshot: snapshot(vars)
    });
    step++;

    switch (ins.op) {

      // ── assign: result = arg1 ───────────────────────────────
      case 'assign': {
        vars[ins.result] = resolveVal(ins.arg1, vars);
        pc++;
        break;
      }

      // ── binop: result = arg1 op arg2 ───────────────────────
      case 'binop': {
        const a = resolveVal(ins.arg1, vars);
        const b = resolveVal(ins.arg2, vars);
        vars[ins.result] = evalBinop(a, ins.operator, b);
        pc++;
        break;
      }

      // ── label: (no-op, just advance) ───────────────────────
      case 'label': {
        pc++;
        break;
      }

      // ── goto: unconditional jump ────────────────────────────
      case 'goto': {
        const target = labelMap[ins.label];
        if (target === undefined) {
          error = `goto: undefined label "${ins.label}"`;
          pc = instrs.length; // halt
        } else {
          pc = target;
        }
        break;
      }

      // ── if: conditional jump ────────────────────────────────
      case 'if': {
        const a = resolveVal(ins.arg1, vars);
        const b = resolveVal(ins.arg2, vars);
        if (evalCond(a, ins.cond, b)) {
          const target = labelMap[ins.label];
          if (target === undefined) {
            error = `if-goto: undefined label "${ins.label}"`;
            pc = instrs.length;
          } else {
            pc = target;
          }
        } else {
          pc++;
        }
        break;
      }

      // ── return: halt execution ──────────────────────────────
      case 'return': {
        returnValue = ins.arg1 !== null && ins.arg1 !== undefined
          ? resolveVal(ins.arg1, vars)
          : null;
        pc = instrs.length; // halt
        break;
      }

      // ── unknown: skip ───────────────────────────────────────
      default: {
        pc++;
        break;
      }
    }
  }

  return {
    finalState:     snapshot(vars),
    executionTrace: trace,
    returnValue,
    error
  };
}

// ── Export ───────────────────────────────────────────────────
window.executeTAC = executeTAC;
