// ============================================================
//  METRICS.JS — TAC Performance Metrics
// ============================================================

const COST_WEIGHTS = { assign: 1, binop: 2, if: 1, goto: 1, label: 0, return: 1, call: 2, param: 1, func: 0 };

function collectVars(ins) {
  const vars = new Set();
  if (ins.result) vars.add(ins.result);
  if (ins.arg1 && isNaN(Number(ins.arg1)) && ins.arg1 !== '') vars.add(ins.arg1);
  if (ins.arg2 && isNaN(Number(ins.arg2)) && ins.arg2 !== '') vars.add(ins.arg2);
  return vars;
}

function computeMetrics(instrs) {
  let assign = 0, binop = 0, controlFlow = 0, others = 0, cost = 0;
  const allVars = new Set();
  for (const ins of instrs) {
    collectVars(ins).forEach(v => allVars.add(v));
    const op = ins.op;
    if (op === 'assign') assign++;
    else if (op === 'binop') binop++;
    else if (op === 'if' || op === 'goto') controlFlow++;
    else others++;
    cost += COST_WEIGHTS[op] || 0;
  }
  return { instructionCount: instrs.length, operationBreakdown: { assign, binop, controlFlow, others }, estimatedCost: cost, memoryUsage: allVars.size };
}

function compareMetrics(beforeInstrs, afterInstrs) {
  const before = computeMetrics(beforeInstrs);
  const after  = computeMetrics(afterInstrs);
  const pct = (b, a) => b === 0 ? 0 : Math.round(((b - a) / b) * 100);
  return { before, after, improvement: { instructionReductionPercent: pct(before.instructionCount, after.instructionCount), costReductionPercent: pct(before.estimatedCost, after.estimatedCost), memoryReductionPercent: pct(before.memoryUsage, after.memoryUsage) } };
}

window.computeMetrics  = computeMetrics;
window.compareMetrics  = compareMetrics;
