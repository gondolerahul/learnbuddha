// Tiny safe math-expression evaluator for AxesPlot `fn` series (no eval).
// Grammar: expr = term (('+'|'-') term)* ; term = factor (('*'|'/') factor)* ;
// factor = unary ('^' factor)? ; unary = '-' unary | primary ; primary = number | x | const | func '(' expr ')' | '(' expr ')'
// Implicit multiplication like "2x" or "3(x+1)" is supported.

type Node = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, ln: Math.log,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, log10: Math.log10, log2: Math.log2,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function compileExpr(src: string): Node {
  const s = src.replace(/\s+/g, "").replace(/\*\*/g, "^").replace(/π/g, "pi").replace(/−/g, "-").replace(/·|×/g, "*");
  let i = 0;
  const peek = () => s[i];
  const eat = (c: string) => {
    if (s[i] === c) {
      i++;
      return true;
    }
    return false;
  };
  function expr(): Node {
    let n = term();
    for (;;) {
      if (eat("+")) { const a = n, b = term(); n = (x) => a(x) + b(x); }
      else if (eat("-")) { const a = n, b = term(); n = (x) => a(x) - b(x); }
      else return n;
    }
  }
  function term(): Node {
    let n = factor();
    for (;;) {
      if (eat("*")) { const a = n, b = factor(); n = (x) => a(x) * b(x); }
      else if (eat("/")) { const a = n, b = factor(); n = (x) => a(x) / b(x); }
      else if (peek() && /[0-9a-z(.]/i.test(peek())) { const a = n, b = factor(); n = (x) => a(x) * b(x); }
      else return n;
    }
  }
  function factor(): Node {
    const base = unary();
    if (eat("^")) { const ex = factor(); return (x) => Math.pow(base(x), ex(x)); }
    return base;
  }
  function unary(): Node {
    if (eat("-")) { const a = unary(); return (x) => -a(x); }
    if (eat("+")) return unary();
    return primary();
  }
  function primary(): Node {
    if (eat("(")) {
      const n = expr();
      if (!eat(")")) throw new Error(`expected ) at ${i}`);
      return n;
    }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      const v = parseFloat(m[0]);
      return () => v;
    }
    const w = /^[a-z][a-z0-9]*/i.exec(s.slice(i));
    if (w) {
      const name = w[0].toLowerCase();
      // longest known function prefix (so "sinx" works)
      const fname = Object.keys(FUNCS).sort((a, b) => b.length - a.length).find((f) => name.startsWith(f) && s[i + f.length] === "(");
      if (fname) {
        i += fname.length;
        eat("(");
        const arg = expr();
        if (!eat(")")) throw new Error(`expected ) after ${fname}`);
        const f = FUNCS[fname];
        return (x) => f(arg(x));
      }
      if (name.startsWith("pi")) { i += 2; return () => Math.PI; }
      if (name[0] === "x") { i += 1; return (x) => x; }
      if (name[0] === "e" && !(name.length > 1 && name.startsWith("exp"))) { i += 1; return () => CONSTS.e; }
      throw new Error(`unknown identifier ${name}`);
    }
    throw new Error(`unexpected '${peek() ?? "end"}' at ${i}`);
  }
  const n = expr();
  if (i !== s.length) throw new Error(`unexpected '${s[i]}' at ${i}`);
  return n;
}
