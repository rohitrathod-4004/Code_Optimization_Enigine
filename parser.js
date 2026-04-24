// ============================================================
//  PARSER  — Simplified C-like code  →  TAC instructions
//  Also handles direct TAC input (passthrough)
// ============================================================

/**
 * TAC Instruction schema
 * { id, op, result, arg1, arg2, label, raw }
 * op: 'assign' | 'binop' | 'label' | 'goto' | 'if' | 'return' | 'param' | 'call'
 */

let _tempCount = 0;
function newTemp() { return 't' + (++_tempCount); }

// ── Main entry ───────────────────────────────────────────────
function parseInput(source, mode) {
  _tempCount = 0;
  const lines = source.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  if (mode === 'tac') return parseTACLines(lines);
  return parseCLike(lines);
}

// ============================================================
//  DIRECT TAC PARSER
// ============================================================
function parseTACLines(lines) {
  const instrs = [];
  let id = 0;
  for (const raw of lines) {
    const instr = parseSingleTACLine(raw, id++);
    if (instr) instrs.push(instr);
  }
  return instrs;
}

function parseSingleTACLine(raw, id) {
  const line = raw.trim();
  if (!line || line.startsWith('//')) return null;

  // label:
  if (/^[A-Za-z_]\w*:$/.test(line))
    return { id, op:'label', label: line.slice(0,-1), raw: line };

  // goto label
  if (/^goto\s+\w+$/.test(line))
    return { id, op:'goto', label: line.split(/\s+/)[1], raw: line };

  // return val
  if (/^return(\s+.*)?$/.test(line)) {
    const parts = line.split(/\s+/);
    return { id, op:'return', arg1: parts[1] || null, raw: line };
  }

  // if a op b goto L
  const ifM = line.match(/^if\s+(\S+)\s*(>=|<=|==|!=|>|<)\s*(\S+)\s+goto\s+(\w+)$/);
  if (ifM) return { id, op:'if', arg1:ifM[1], cond:ifM[2], arg2:ifM[3], label:ifM[4], raw:line };

  // result = arg1 op arg2
  const binM = line.match(/^(\S+)\s*=\s*(\S+)\s*([+\-*\/%])\s*(\S+)$/);
  if (binM) return { id, op:'binop', result:binM[1], arg1:binM[2], operator:binM[3], arg2:binM[4], raw:line };

  // result = arg1  (simple assign)
  const assM = line.match(/^(\S+)\s*=\s*(\S+)$/);
  if (assM) return { id, op:'assign', result:assM[1], arg1:assM[2], raw:line };

  return { id, op:'unknown', raw:line };
}

// ============================================================
//  SIMPLIFIED C-LIKE PARSER
// ============================================================
function parseCLike(lines) {
  const instrs = [];
  let id = 0;
  const emit = (instr) => { instr.id = id++; instrs.push(instr); };

  // Strip function wrapper: int main() { ... }
  let body = lines.slice();
  const startBrace = body.findIndex(l => l === '{');
  if (startBrace !== -1) body = body.slice(startBrace + 1);
  const lastBrace = body.lastIndexOf('}');
  if (lastBrace !== -1) body = body.slice(0, lastBrace);

  for (const line of body) {
    const tl = line.trim();
    if (!tl || tl === '{' || tl === '}') continue;

    // label (e.g. L1: or L_done:)
    if (/^[A-Za-z_]\w*:$/.test(tl)) {
      emit({ op:'label', label: tl.slice(0,-1), raw: tl }); continue;
    }
    // goto
    if (/^goto\s+\w+/.test(tl)) {
      emit({ op:'goto', label: tl.split(/\s+/)[1].replace(/;$/, ''), raw: tl }); continue;
    }
    // return
    if (/^return(\s+.*)?;?$/.test(tl)) {
      const v = tl.replace(/^return\s*/, '').replace(/;$/, '').trim();
      emit({ op:'return', arg1: v || null, raw: tl }); continue;
    }
    // if (cond) goto L
    const ifM = tl.match(/^if\s*\((.+?)\)\s*goto\s+(\w+);?$/);
    if (ifM) {
      const cond = ifM[1].trim();
      const condM = cond.match(/^(\S+)\s*(>=|<=|==|!=|>|<)\s*(\S+)$/);
      if (condM) {
        emit({ op:'if', arg1:condM[1], cond:condM[2], arg2:condM[3], label:ifM[2], raw:tl });
      } else {
        emit({ op:'if', arg1:cond, cond:'!=', arg2:'0', label:ifM[2], raw:tl });
      }
      continue;
    }
    // int var = expr;  or  var = expr;
    const declM = tl.match(/^(?:int\s+)?(\w+)\s*=\s*(.+?);?$/);
    if (declM) {
      const varName = declM[1];
      const exprInstrs = flattenExpr(declM[2].trim(), varName);
      exprInstrs.forEach(i => emit(i));
      continue;
    }
  }
  return instrs;
}

// Flatten a right-hand expression into TAC, targeting `targetVar`
function flattenExpr(expr, targetVar) {
  expr = expr.trim();
  const instrs = [];
  const result = flattenExprRec(expr, instrs);
  // If the last temp is not targetVar, assign
  if (instrs.length === 0) {
    instrs.push({ op:'assign', result: targetVar, arg1: result, raw: `${targetVar} = ${result}` });
  } else {
    const last = instrs[instrs.length - 1];
    if (last.result !== targetVar) {
      const oldResult = last.result;
      last.result = targetVar;
      last.raw = last.raw.replace(oldResult, targetVar);
    }
  }
  return instrs;
}

function flattenExprRec(expr, out) {
  expr = expr.trim();
  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(expr)) return expr;
  // Identifier
  if (/^[A-Za-z_]\w*$/.test(expr)) return expr;

  // Find the lowest precedence operator (rightmost + or -, then rightmost * / %)
  let opIdx = -1, op = null;
  let depth = 0;
  // scan right-to-left for + -
  for (let i = expr.length - 1; i >= 0; i--) {
    const c = expr[i];
    if (c === ')') depth++;
    else if (c === '(') depth--;
    else if (depth === 0 && (c === '+' || c === '-') && i > 0) {
      opIdx = i; op = c; break;
    }
  }
  if (opIdx === -1) {
    // scan right-to-left for * / %
    depth = 0;
    for (let i = expr.length - 1; i >= 0; i--) {
      const c = expr[i];
      if (c === ')') depth++;
      else if (c === '(') depth--;
      else if (depth === 0 && (c === '*' || c === '/' || c === '%')) {
        opIdx = i; op = c; break;
      }
    }
  }
  if (opIdx !== -1) {
    const left  = expr.slice(0, opIdx).trim();
    const right = expr.slice(opIdx + 1).trim();
    const a1 = flattenExprRec(left, out);
    const a2 = flattenExprRec(right, out);
    const t = newTemp();
    out.push({ op:'binop', result:t, arg1:a1, operator:op, arg2:a2, raw:`${t} = ${a1} ${op} ${a2}` });
    return t;
  }
  // Parenthesized
  if (expr.startsWith('(') && expr.endsWith(')')) return flattenExprRec(expr.slice(1,-1), out);
  // Fallback
  return expr;
}

// ── Export ───────────────────────────────────────────────────
window.parseInput = parseInput;
window.parseSingleTACLine = parseSingleTACLine;
