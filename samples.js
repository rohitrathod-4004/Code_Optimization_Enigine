// ============================================================
//  SAMPLE PROGRAMS  (C-like mode + TAC mode)
// ============================================================
const SAMPLES = {
  c: {

    // ── 1. Simple ───────────────────────────────────────────
    simple: `// Constant folding + algebraic simplification demo
int main() {
  int a = 5;
  int b = 3;
  int c = a + b;
  int d = 2 + 3;
  int e = c * 1;
  int f = d + 0;
  int x = a + b;
  int result = c + e;
  return result;
}`,

    // ── 2. Branching ─────────────────────────────────────────
    branching: `// If-goto with dead code elimination
int main() {
  int x = 10;
  int y = 20;
  int z = x + y;
  int t = 4 * 2;
  int dead1 = z * 0;
  int dead2 = t + 0;
  if (z > t) goto L_then;
  int unused = z * 0;
  goto L_else;
L_then:
  int a = z + t;
  int b = a * 1;
  int c = b + 0;
  return c;
L_else:
  int w = z - 0;
  int v = w * 1;
  return v;
}`,

    // ── 3. For-loop (sum 1..n) ───────────────────────────────
    loop: `// For-loop: sum of 1 to n (using upgraded while parser)
int main() {
  int n = 10;
  int i = 1;
  int sum = 0;
  while (i <= n) {
    sum = sum + i;
    i = i + 1;
  }
  return sum;
}`,

    // ── 4. Algorithm (Fibonacci-style) ───────────────────────
    algo: `// Fibonacci-style iterative  (full optimization showcase)
int main() {
  int n = 8;
  int a = 0;
  int b = 1;
  int i = 2;
  int limit = n + 0;
  int step = 1 * 1;
  int dead = a * 0;
L_fib_loop:
  if (i > limit) goto L_fib_end;
  int t1 = a + b;
  int t2 = a + b;
  int t3 = b * 1;
  a = t3;
  b = t1;
  int t4 = b + 0;
  int i_next = i + step;
  int i_next2 = i + step;
  i = i_next;
  goto L_fib_loop;
L_fib_end:
  int result = b * 1;
  int unused = a + 0;
  return result;
}`
  },

  tac: {

    // ── 1. Simple TAC ────────────────────────────────────────
    simple: `// Constant folding + algebraic simplification
a = 5
b = 3
t1 = 2 + 3
t2 = t1 * 1
t3 = t2 + 0
t4 = a + b
t5 = a + b
t6 = t2 * 0
result = t3 + t4
return result`,

    // ── 2. Branching TAC ─────────────────────────────────────
    branching: `// Conditional branches + dead code
x = 10
y = 20
t1 = x + y
t2 = 4 * 2
dead1 = t1 * 0
dead2 = t2 + 0
if t1 > t2 goto L_then
unused = t1 * 0
goto L_else
L_then:
t3 = t1 + t2
t4 = t3 * 1
t5 = t4 + 0
return t5
L_else:
t6 = t1 - 0
t7 = t6 * 1
return t7`,

    // ── 3. Loop TAC (sum 1..n) ───────────────────────────────
    loop: `// For-loop sum: CSE + algebraic + DCE
n = 10
i = 1
sum = 0
step = 1 * 1
limit = n + 0
L_for_cond:
if i > limit goto L_for_end
t1 = sum + i
t2 = sum + i
sum = t1
t3 = i + step
t4 = i + step
i = t3
goto L_for_cond
L_for_end:
result = sum * 1
waste = result + 0
return result`,

    // ── 4. Algorithm TAC (Fibonacci) ─────────────────────────
    algo: `// Fibonacci iterative — full pipeline demo
n = 8
a = 0
b = 1
i = 2
limit = n + 0
step = 1 * 1
dead = a * 0
L_fib_loop:
if i > limit goto L_fib_end
t1 = a + b
t2 = a + b
t3 = b * 1
a = t3
b = t1
t4 = b + 0
t5 = i + step
t6 = i + step
i = t5
goto L_fib_loop
L_fib_end:
result = b * 1
unused = a + 0
return result`,

    // ── 5. Multi-Function (call stack demo) ───────────────────
    multifunc: `// Multi-function: sum + square + main
// Shows function calls, parameter passing, call stack
func sum:
param a
param b
t1 = a + b
dead1 = t1 + 0
result = t1 * 1
return result

func square:
param n
t2 = n * n
waste = t2 * 1
return t2

func main:
x = 3
y = 4
param x
param y
call sum
s = retval
param s
call square
ans = retval
return ans`
  }
};

window.SAMPLES = SAMPLES;
