// Problem generators. Every problem comes from a seeded random generator,
// so all students in a game get exactly the same problems in the same order.

export const CATS = [
  { id: "add",  name: "Addition",            sample: "368 + 457" },
  { id: "sub",  name: "Subtraction",         sample: "912 − 485" },
  { id: "mul",  name: "Multiplication",      sample: "47 × 6" },
  { id: "div",  name: "Division",            sample: "312 ÷ 8" },
  { id: "int",  name: "Integers",            sample: "(−7) × 4 − (−15)" },
  { id: "ord",  name: "Order of operations", sample: "(8 + 4) × 3 − 5" },
  { id: "sq",   name: "Squares & roots",     sample: "23² · √729" },
  { id: "pct",  name: "Percentages",         sample: "15% of 240" },
  { id: "frac", name: "Fractions",           sample: "2/3 + 1/4" },
  { id: "eq",   name: "Solve for x",         sample: "5x − 7 = 38" },
  { id: "mix",  name: "Mixed",               sample: "Any of the above" }
];
export const LEVELS = [{ v: 1, label: "Warm-up" }, { v: 2, label: "Contest" }, { v: 3, label: "Olympiad" }];
export const catName = id => (CATS.find(c => c.id === id) || { name: id }).name;
export const lvlName = v => (LEVELS.find(l => l.v == v) || { label: "Level " + v }).label;

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = "−";
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };
const Q = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const num = n => (n < 0 ? MIN + (-n) : String(n));
const par = n => (n < 0 ? "(" + MIN + (-n) + ")" : String(n));
const fr = (n, d) => `<span class="fr"><span>${n}</span><span>${d}</span></span>`;
export const frq = q => (q.d === 1 ? num(q.n) : (q.n < 0 ? MIN : "") + fr(Math.abs(q.n), q.d));
const sq2 = n => `${n}<sup>2</sup>`;
const X = "<i>x</i>";
const T = " × ", D = " ÷ ", M = " " + MIN + " ";
const P = (html, n) => ({ html, ans: { n, d: 1 } });
const rt = m => `√<span class="rad">${m}</span>`;
const lin = (a, b) => `${a === 1 ? "" : a === -1 ? MIN : num(a)}${X}${b === 0 ? "" : b < 0 ? M + (-b) : " + " + b}`;

export function gen(rng, cat, L) {
  const R = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = a => a[Math.floor(rng() * a.length)];
  const nz = (a, b) => { let v; do v = R(a, b); while (v === 0); return v; };
  const coin = () => rng() < 0.5;
  L = Number(L);
  let c = cat;
  if (c === "mix") c = pick(CATS.filter(x => x.id !== "mix")).id;

  switch (c) {
    case "add": { const r = [[12, 99, 12, 99], [120, 999, 120, 999], [1200, 9999, 120, 9999]][L - 1]; const a = R(r[0], r[1]), b = R(r[2], r[3]); return P(`${a} + ${b}`, a + b); }
    case "sub": { let a, b; if (L === 1) { a = R(30, 99); b = R(11, a - 1); } else if (L === 2) { a = R(300, 999); b = R(101, a - 11); } else { a = R(2000, 9999); b = R(1001, a - 1); } return P(`${a}${M}${b}`, a - b); }
    case "mul": { const r = [[3, 12, 3, 12], [13, 99, 3, 9], [12, 99, 12, 99]][L - 1]; const a = R(r[0], r[1]), b = R(r[2], r[3]); return P(`${a}${T}${b}`, a * b); }
    case "div": { const r = [[2, 12, 2, 12], [3, 9, 12, 99], [12, 25, 12, 60]][L - 1]; const b = R(r[0], r[1]), q = R(r[2], r[3]); return P(`${b * q}${D}${b}`, q); }
    case "int": {
      if (L === 1) { const a = nz(-20, 20), b = nz(-20, 20); return coin() ? P(`${num(a)} + ${par(b)}`, a + b) : P(`${num(a)}${M}${par(b)}`, a - b); }
      if (L === 2) { let a = nz(-12, 12), b = nz(-12, 12); if (a > 0 && b > 0) { if (coin()) a = -a; else b = -b; } return coin() ? P(`${par(a)}${T}${par(b)}`, a * b) : P(`${par(a * b)}${D}${par(b)}`, a); }
      const a = nz(-12, 12), b = R(2, 9) * (coin() ? -1 : 1), c2 = nz(-20, 20);
      return P(`${par(a)}${T}${par(b)}${M}${par(c2)}`, a * b - c2);
    }
    case "ord": {
      const v = R(0, 2);
      if (L === 1) { const a = R(2, 20), b = R(2, 9), c2 = R(2, 9);
        if (v === 0) return P(`${a} + ${b}${T}${c2}`, a + b * c2);
        if (v === 1) { const s = R(1, b * c2 - 1); return P(`${b}${T}${c2}${M}${s}`, b * c2 - s); }
        return P(`${b * c2}${D}${b} + ${a}`, c2 + a); }
      if (L === 2) { const a = R(2, 15), b = R(2, 15), c2 = R(2, 9), d = R(1, 20);
        if (v === 0) return P(`(${a} + ${b})${T}${c2}${M}${d}`, (a + b) * c2 - d);
        if (v === 1) { const e = R(2, 9); return P(`${a}${T}${c2}${M}${e}${T}${b}`, a * c2 - e * b); }
        const hi = R(6, 15), lo = R(1, hi - 1); return P(`${a} + ${c2}${T}(${hi}${M}${lo})`, a + c2 * (hi - lo)); }
      if (v === 0) { const a = R(5, 15), b = R(2, 12), c2 = R(2, 12); return P(`${sq2(a)}${M}${b}${T}${c2}`, a * a - b * c2); }
      if (v === 1) { const c2 = R(2, 5), t = R(1, 3), diff = c2 * t, b = R(1, 20), a = b + diff; return P(`(${a}${M}${b})<sup>2</sup>${D}${c2}`, diff * diff / c2); }
      const b = R(2, 9), c2 = R(2, 9), e = R(2, 9), d = e * R(2, 9), a = R(20, 60);
      return P(`${a}${M}${b}${T}${c2} + ${d}${D}${e}`, a - b * c2 + d / e);
    }
    case "sq": {
      const x = rng();
      if (L === 1) { const n = R(2, 15); return x < 0.5 ? P(sq2(n), n * n) : P(rt(n * n), n); }
      if (L === 2) { if (x < 0.4) { const n = R(11, 30); return P(sq2(n), n * n); } if (x < 0.7) { const n = R(11, 30); return P(rt(n * n), n); } const n = R(2, 6); return P(`${n}<sup>3</sup>`, n ** 3); }
      if (x < 0.35) { const n = R(25, 75); return P(sq2(n), n * n); }
      if (x < 0.65) { const n = R(20, 60); return P(rt(n * n), n); }
      if (x < 0.85) { const n = R(4, 12); return P(`${n}<sup>3</sup>`, n ** 3); }
      const n = R(2, 10); return P(`∛<span class="rad">${n ** 3}</span>`, n);
    }
    case "pct": {
      if (L === 1) { const p = pick([10, 20, 25, 50]), b = R(1, 20) * 20; return P(`${p}% of ${b}`, p * b / 100); }
      if (L === 2) { const p = R(1, 19) * 5, b = R(1, 25) * 20; return P(`${p}% of ${b}`, p * b / 100); }
      if (rng() < 0.3) { const p = R(1, 9) * 10, b = R(2, 20) * 10; return P(`${p}% of ? = ${p * b / 100}`, b); }
      const [p, k] = pick([[12.5, 8], [37.5, 8], [15, 20], [35, 20], [45, 20], [65, 20], [75, 4], [125, 8], [150, 2], [2.5, 40], [120, 5]]);
      const lo = Math.ceil(20 / k), b = k * R(lo, lo + 30);
      return P(`${p}% of ${b}`, Math.round(p * b) / 100);
    }
    case "frac": {
      let q, html;
      if (L === 1) { const d = R(3, 12), a = R(1, d - 1), b = R(1, d - 1), plus = coin();
        q = Q(plus ? a + b : a - b, d); html = `${fr(a, d)} ${plus ? "+" : MIN} ${fr(b, d)}`; }
      else if (L === 2) { const d1 = R(2, 9); let d2; do d2 = R(2, 9); while (d2 === d1);
        const a = R(1, d1 - 1), b = R(1, d2 - 1), plus = coin();
        q = Q(plus ? a * d2 + b * d1 : a * d2 - b * d1, d1 * d2); html = `${fr(a, d1)} ${plus ? "+" : MIN} ${fr(b, d2)}`; }
      else { const a = R(1, 12), b = R(2, 12), c2 = R(1, 12), d = R(2, 12), mul = coin();
        q = mul ? Q(a * c2, b * d) : Q(a * d, b * c2); html = `${fr(a, b)} ${mul ? "×" : "÷"} ${fr(c2, d)}`; }
      return { html, ans: q, frac: true };
    }
    case "eq": {
      if (L === 1) { const v = R(0, 2);
        if (v === 0) { const x = R(1, 20), a = R(2, 20); return P(`${X} + ${a} = ${x + a}`, x); }
        if (v === 1) { const x = R(2, 12), a = R(2, 12); return P(`${a}${X} = ${a * x}`, x); }
        const x = R(1, 20), a = R(2, 20); return P(`${X}${M}${a} = ${num(x - a)}`, x); }
      if (L === 2) { const a = R(2, 9), x = R(-10, 15), b = nz(-20, 20); return P(`${lin(a, b)} = ${num(a * x + b)}`, x); }
      if (coin()) { const a = R(2, 8), x = R(-9, 12), b = R(1, 9); return P(`${a}(${X} + ${b}) = ${num(a * (x + b))}`, x); }
      const a = R(3, 12), c2 = R(1, a - 1), x = R(-8, 12), b = nz(-15, 15), d = (a - c2) * x + b;
      return P(`${lin(a, b)} = ${lin(c2, d)}`, x);
    }
  }
  throw new Error("Unknown event " + cat);
}

// Endless stream for sprint races: same seed → same sequence for everyone.
export function problemStream(seed, cat, level) {
  const rng = makeRng(seed);
  let last = "";
  return () => {
    let p, guard = 0;
    do { p = gen(rng, cat, level); } while (p.html === last && ++guard < 5);
    last = p.html;
    return p;
  };
}

// One problem per round in round mode.
export const roundProblem = (seed, idx, cat, level) => gen(makeRng((seed + (idx + 1) * 7919) >>> 0), cat, level);

function parse(s) {
  s = String(s).replace(/−/g, "-").replace(/\s+/g, "");
  const m = s.match(/^(-?)(\d+)(?:\/(\d+))?$/);
  if (!m) return null;
  const n = (m[1] ? -1 : 1) * parseInt(m[2], 10), d = m[3] === undefined ? 1 : parseInt(m[3], 10);
  if (!d) return null;
  return { n, d };
}
// 'ok' | 'wrong' | 'simplify' | 'bad'
export function judge(s, prob) {
  const p = parse(s); if (!p) return "bad";
  const a = prob.ans;
  if (p.n * a.d !== a.n * p.d) return "wrong";
  if (prob.frac) { if (a.d === 1) return p.d === 1 ? "ok" : "simplify"; if (gcd(p.n, p.d) !== 1) return "simplify"; }
  return "ok";
}
