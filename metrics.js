// ============================================================
//  METRICS.JS — TAC Performance Metrics
//  computeMetrics(instrs)  → metrics object
//  compareMetrics(before, after) → { before, after, improvement }
// ============================================================

// Cost weights per instruction type
const COST_WEIGHTS = {
  assign: 1,
  binop:  2,
  if:     1,
  goto:   1,
  label:  0,
  return: 1,
};

// ── Helpers ───────────────────────────────────────────────────

/** Collect all variable names referenced or defined in an instruction. */
function collectVars(ins) {
  const vars = new Set();
  if (ins.result) vars.add(ins.result);
  if (ins.arg1 && isNaN(Number(ins.arg1)) && ins.arg1 !== '') vars.add(ins.arg1);
  if (ins.arg2 && isNaN(Number(ins.arg2)) && ins.arg2 !== '') vars.add(ins.arg2);
  return vars;
}

// ── computeMetrics ────────────────────────────────────────────

/**
 * computeMetrics(instrs)
 *
 * @param  {Array}  instrs  TAC instruction array
 * @returns {Object}
 *   {
 *     instructionCount,        // total instructions
 *     operationBreakdown: {    // by category
 *       assign, binop, controlFlow, others
 *     },
 *     estimatedCost,           // weighted sum
 *     memoryUsage,             // unique variable count
 *   }
 */
function computeMetrics(instrs) {
  let assign = 0, binop = 0, controlFlow = 0, others = 0;
  let cost = 0;
  const allVars = new Set();

  for (const ins of instrs) {
    // Variable collection
    collectVars(ins).forEach(v => allVars.add(v));

    // Category + cost
    switch (ins.op) {
      case 'assign': assign++;      cost += COST_WEIGHTS.assign; break;
      case 'binop':  binop++;       cost += COST_WEIGHTS.binop;  break;
      case 'if':     controlFlow++; cost += COST_WEIGHTS.if;     break;
      case 'goto':   controlFlow++; cost += COST_WEIGHTS.goto;   break;
      case 'label':                 cost += COST_WEIGHTS.label;  break;
      case 'return': others++;      cost += COST_WEIGHTS.return; break;
      default:       others++;      break;
    }
  }

  return {
    instructionCount: instrs.length,
    operationBreakdown: { assign, binop, controlFlow, others },
    estimatedCost:  cost,
    memoryUsage:    allVars.size,
  };
}

// ── compareMetrics ────────────────────────────────────────────

/**
 * compareMetrics(beforeInstrs, afterInstrs)
 *
 * @param  {Array} beforeInstrs  original TAC
 * @param  {Array} afterInstrs   optimized TAC
 * @returns {Object}
 *   {
 *     before, after,
 *     improvement: {
 *       instructionReductionPercent,
 *       costReductionPercent,
 *       memoryReductionPercent
 *     }
 *   }
 */
function compareMetrics(beforeInstrs, afterInstrs) {
  const before = computeMetrics(beforeInstrs);
  const after  = computeMetrics(afterInstrs);

  function pct(b, a) {
    if (b === 0) return 0;
    return Math.round(((b - a) / b) * 100);
  }

  return {
    before,
    after,
    improvement: {
      instructionReductionPercent: pct(before.instructionCount, after.instructionCount),
      costReductionPercent:        pct(before.estimatedCost,    after.estimatedCost),
      memoryReductionPercent:      pct(before.memoryUsage,      after.memoryUsage),
    },
  };
}

// ── Export ────────────────────────────────────────────────────
window.computeMetrics  = computeMetrics;
window.compareMetrics  = compareMetrics;
