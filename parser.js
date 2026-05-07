// ============================================================
//  PARSER  — Upgraded for real C-like Flow Control
// ============================================================

let _tempCount = 0;
let _labelCount = 0;
function newTemp() { return 't' + (++_tempCount); }
function newLabel() { return 'L' + (++_labelCount); }

function parseInput(source, mode) {
  _tempCount = 0; _labelCount = 0;
  const lines = source.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  if (mode === 'tac') return parseTACLines(lines);
  return parseCLike(lines, true); // True means it's the top-level call
}

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

  if (/^func\s+\w+\s*:?\s*$/.test(line)) {
    const name = line.replace(/^func\s+/, '').replace(/:?\s*$/, '').trim();
    return { id, op:'func', label: name, raw: line };
  }
  if (/^param\s+\S+$/.test(line))
    return { id, op:'param', arg1: line.split(/\s+/)[1], raw: line };
  if (/^call\s+\w+$/.test(line))
    return { id, op:'call', label: line.split(/\s+/)[1], raw: line };
  if (/^[A-Za-z_]\w*:$/.test(line))
    return { id, op:'label', label: line.slice(0,-1), raw: line };
  if (/^goto\s+\w+$/.test(line))
    return { id, op:'goto', label: line.split(/\s+/)[1], raw: line };
  if (/^return(\s+.*)?$/.test(line)) {
    const parts = line.split(/\s+/);
    return { id, op:'return', arg1: parts[1] || null, raw: line };
  }
  const ifM = line.match(/^if\s+(\S+)\s*(>=|<=|==|!=|>|<)\s*(\S+)\s+goto\s+(\w+)$/);
  if (ifM) return { id, op:'if', arg1:ifM[1], cond:ifM[2], arg2:ifM[3], label:ifM[4], raw:line };
  const binM = line.match(/^(\S+)\s*=\s*(\S+)\s*([+\-*\/%])\s*(\S+)$/);
  if (binM) return { id, op:'binop', result:binM[1], arg1:binM[2], operator:binM[3], arg2:binM[4], raw:line };
  const assM = line.match(/^(\S+)\s*=\s*(\S+)$/);
  if (assM) return { id, op:'assign', result:assM[1], arg1:assM[2], raw:line };

  return { id, op:'unknown', raw:line };
}

function parseCLike(lines, isTopLevel = false) {
  const instrs = [];
  let id = 0;
  const emit = (instr) => { instr.id = id++; instrs.push(instr); };

  if (isTopLevel) {
    const hasFunc = lines.some(l => l.includes('int main') || l.includes('func '));
    if (!hasFunc) emit({ op: 'func', label: 'main', raw: 'func main:' });
  }

  for (let i = 0; i < lines.length; i++) {
    let tl = lines[i].trim();
    if (!tl || tl === '{' || tl === '}') continue;

    if (tl.startsWith('int main')) {
      emit({ op: 'func', label: 'main', raw: 'func main:' });
      continue;
    }

    const whileM = tl.match(/^while\s*\((.+?)\)\s*\{?$/);
    if (whileM) {
      const condStr = whileM[1].trim();
      const startL = newLabel();
      const endL = newLabel();
      emit({ op: 'label', label: startL, raw: `// while start` });
      const condParts = parseCond(condStr);
      emit({ op: 'if', arg1: condParts.a1, cond: invertCond(condParts.op), arg2: condParts.a2, label: endL, raw: `if !(${condStr}) goto ${endL}` });
      
      let bodyLines = [];
      let depth = 1;
      i++;
      while (i < lines.length && depth > 0) {
        let bl = lines[i].trim();
        if (bl.includes('{')) depth++;
        if (bl.includes('}')) depth--;
        if (depth > 0) bodyLines.push(bl);
        i++;
      }
      i--;
      parseCLike(bodyLines, false).forEach(ins => emit(ins)); // Pass false for nested calls
      emit({ op: 'goto', label: startL, raw: `goto ${startL}` });
      emit({ op: 'label', label: endL, raw: `// while end` });
      continue;
    }

    const ifM = tl.match(/^if\s*\((.+?)\)\s*goto\s+(\w+);?$/);
    if (ifM) {
      const cond = parseCond(ifM[1]);
      emit({ op:'if', arg1:cond.a1, cond:cond.op, arg2:cond.a2, label:ifM[2], raw:tl });
      continue;
    }

    const declM = tl.match(/^(?:int\s+)?(\w+)\s*=\s*(.+?);?$/);
    if (declM) {
      const varName = declM[1];
      const expr = declM[2].replace(/;$/, '').trim();
      flattenExpr(expr, varName).forEach(ins => emit(ins));
      continue;
    }

    const single = parseSingleTACLine(tl, id);
    if (single && single.op !== 'unknown') { id++; instrs.push(single); }
  }
  return instrs;
}

function parseCond(s) {
  const m = s.match(/^([A-Za-z_]\w*|\d+)\s*(>=|<=|==|!=|>|<)\s*([A-Za-z_]\w*|\d+)$/);
  if (m) return { a1: m[1], op: m[2], a2: m[3] };
  return { a1: s, op: '!=', a2: '0' };
}

function invertCond(op) {
  const map = { '>':'<=', '<':'>=', '==':'!=', '!=':'==', '>=':'<', '<=':'>' };
  return map[op] || '==';
}

function flattenExpr(expr, targetVar) {
  expr = expr.trim();
  const instrs = [];
  const result = flattenExprRec(expr, instrs);
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
  if (/^-?\d+(\.\d+)?$/.test(expr)) return expr;
  if (/^[A-Za-z_]\w*$/.test(expr)) return expr;
  let opIdx = -1, op = null;
  let depth = 0;
  for (let i = expr.length - 1; i >= 0; i--) {
    const c = expr[i];
    if (c === ')') depth++;
    else if (c === '(') depth--;
    else if (depth === 0 && (c === '+' || c === '-') && i > 0) { opIdx = i; op = c; break; }
  }
  if (opIdx === -1) {
    depth = 0;
    for (let i = expr.length - 1; i >= 0; i--) {
      const c = expr[i];
      if (c === ')') depth++;
      else if (c === '(') depth--;
      else if (depth === 0 && (c === '*' || c === '/' || c === '%')) { opIdx = i; op = c; break; }
    }
  }
  if (opIdx !== -1) {
    const a1 = flattenExprRec(expr.slice(0, opIdx).trim(), out);
    const a2 = flattenExprRec(expr.slice(opIdx + 1).trim(), out);
    const t = newTemp();
    out.push({ op:'binop', result:t, arg1:a1, operator:op, arg2:a2, raw:`${t} = ${a1} ${op} ${a2}` });
    return t;
  }
  if (expr.startsWith('(') && expr.endsWith(')')) return flattenExprRec(expr.slice(1,-1), out);
  return expr;
}

window.parseInput = parseInput;
window.parseSingleTACLine = parseSingleTACLine;
