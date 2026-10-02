// ===== Post-flop engine: 7-card evaluator, hand classes, villain betting ranges by player type, equity =====
const PF = (() => {
  const RCH = '23456789TJQKA', SCH = 'shdc';
  const str = c => RCH[c >> 2] + SCH[c & 3];
  function straightHigh(m) {
    for (let h = 12; h >= 4; h--) { const mk = 0x1F << (h - 4); if ((m & mk) === mk) return h; }
    if ((m & 0x100F) === 0x100F) return 3;
    return -1;
  }
  const enc = (cat, a) => { let v = cat << 20; for (let i = 0; i < 5; i++) v |= ((a[i] ?? 0) & 15) << (16 - 4 * i); return v; };
  function evalCards(cs) {
    const rc = new Int8Array(13), sm = [0, 0, 0, 0], sc = [0, 0, 0, 0]; let rm = 0;
    for (const c of cs) { const r = c >> 2, s = c & 3; rc[r]++; sm[s] |= 1 << r; sc[s]++; rm |= 1 << r; }
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) { const sf = straightHigh(sm[s]); if (sf >= 0) return enc(8, [sf]); }
    let quad = -1; const trips = [], pairs = [], singles = [];
    for (let r = 12; r >= 0; r--) { if (rc[r] === 4) quad = r; else if (rc[r] === 3) trips.push(r); else if (rc[r] === 2) pairs.push(r); else if (rc[r] === 1) singles.push(r); }
    if (quad >= 0) return enc(7, [quad, [...trips, ...pairs, ...singles].sort((a, b) => b - a)[0]]);
    if (trips.length && (trips.length > 1 || pairs.length)) return enc(6, [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)]);
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) { const a = []; for (let r = 12; r >= 0 && a.length < 5; r--) if (sm[s] >> r & 1) a.push(r); return enc(5, a); }
    const st = straightHigh(rm); if (st >= 0) return enc(4, [st]);
    if (trips.length) return enc(3, [trips[0], ...singles.slice(0, 2)]);
    if (pairs.length >= 2) return enc(2, [pairs[0], pairs[1], [...pairs.slice(2), ...singles].sort((a, b) => b - a)[0]]);
    if (pairs.length) return enc(1, [pairs[0], ...singles.slice(0, 3)]);
    return enc(0, singles.slice(0, 5));
  }

  // hand class on board (for labels, range building)
  function classify(h, board) {
    const v = evalCards([...h, ...board]); const cat = v >> 20;
    const br = board.map(c => c >> 2).sort((a, b) => b - a);
    const bset = [...new Set(br)];
    let label, tier; // tier: 6 nuts-ish .. 0 air
    if (cat >= 4) { label = ['', '', '', '', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'][cat]; tier = 6; }
    else if (cat === 3) { label = (h[0] >> 2) === (h[1] >> 2) ? 'Set' : 'Trips'; tier = 5; }
    else if (cat === 2) {
      const boardPairs = br.filter((r, i) => br.indexOf(r) !== i);
      const p1 = (v >> 16) & 15, p2 = (v >> 12) & 15;
      if (boardPairs.includes(p1) && boardPairs.includes(p2)) { label = 'Board two pair'; tier = 1; }
      else if (boardPairs.length) { const mine = boardPairs.includes(p1) ? p2 : p1; label = mine >= bset[0] ? 'Top pair' : 'Pair'; tier = mine >= bset[0] ? 3 : 2; if (mine > bset[0]) label = 'Overpair'; }
      else { label = 'Two pair'; tier = 4; }
    } else if (cat === 1) {
      const p = (v >> 16) & 15; const onBoardPair = br.filter(r => r === p).length >= 2;
      const pocket = (h[0] >> 2) === (h[1] >> 2);
      if (onBoardPair) { label = 'Board pair'; tier = 0; }
      else if (pocket && p > bset[0]) { label = 'Overpair'; tier = 3.5; }
      else if (p === bset[0]) { const k = Math.max(...h.map(c => c >> 2).filter(r => r !== p), -1); label = k >= 10 || (pocket) ? 'Top pair, good kicker' : 'Top pair, weak kicker'; tier = k >= 10 ? 3 : 2.7; }
      else if (p === bset[1]) { label = 'Second pair'; tier = 2; }
      else { label = 'Weak pair'; tier = 1.5; }
    } else { label = 'High card'; tier = 0; }
    // draws
    let fd = false, sd = 0;
    if (board.length < 5 && cat < 4) {
      const all = [...h, ...board];
      for (let s = 0; s < 4; s++) { const n = all.filter(c => (c & 3) === s).length; if (n === 4 && h.some(c => (c & 3) === s)) fd = true; }
      let rm = 0, bm = 0; all.forEach(c => rm |= 1 << (c >> 2)); board.forEach(c => bm |= 1 << (c >> 2));
      if (straightHigh(rm) < 0) for (let x = 0; x < 13; x++) if (!(rm >> x & 1) && straightHigh(rm | 1 << x) >= 0 && straightHigh(bm | 1 << x) < 0) sd++;
    }
    const draw = fd && sd ? 'Combo draw' : fd ? 'Flush draw' : sd >= 2 ? 'Open-ender' : sd === 1 ? 'Gutshot' : '';
    return { v, cat, label, tier, fd, sd, draw };
  }

  const R2 = 'AKQJT98765432';
  const rk = ch => 12 - R2.indexOf(ch);
  function classCombos(cls) {
    const a = rk(cls[0]), b = rk(cls[1]), out = [];
    if (cls.length === 2) { for (let s = 0; s < 4; s++) for (let t = s + 1; t < 4; t++) out.push([a * 4 + s, b * 4 + t]); }
    else if (cls[2] === 's') for (let s = 0; s < 4; s++) out.push([a * 4 + s, b * 4 + s]);
    else for (let s = 0; s < 4; s++) for (let t = 0; t < 4; t++) if (s !== t) out.push([a * 4 + s, b * 4 + t]);
    return out;
  }
  function rangeCombos(weights, dead) {
    const d = new Set(dead), out = [];
    for (let i = 0; i < 169; i++) if (weights[i] > 0.001) for (const c of classCombos(Engine.CL[i])) if (!d.has(c[0]) && !d.has(c[1])) out.push({ h: c, w: weights[i] });
    return out;
  }

  const TYPES = {
    nit: { name: 'Nit', open: 0.55, value: 0.6, bluff: 0.25, vpip: 12, pfr: 9 },
    fish: { name: 'Fish', open: 1.4, value: 1.35, bluff: 0.4, vpip: 45, pfr: 7 },
    tag: { name: 'TAG Reg', open: 1, value: 1, bluff: 1, vpip: 22, pfr: 18 },
    lag: { name: 'LAG Reg', open: 1.35, value: 1.12, bluff: 1.6, vpip: 32, pfr: 26 },
  };
  const STREET = { 3: 'Flop', 4: 'Turn', 5: 'River' };

  // Villain's betting range on this board for a given bet size
  function bettingRange(type, preW, board, heroH, pot, bet) {
    const T = TYPES[type];
    const combos = rangeCombos(preW, [...board, ...heroH]).map(c => ({ ...c, k: classify(c.h, board) }));
    const W = combos.reduce((s, c) => s + c.w, 0);
    const s = bet / pot;
    const base = s <= 0.4 ? 0.5 : s <= 0.6 ? 0.42 : s <= 0.9 ? 0.34 : 0.24;
    const vTarget = W * Math.min(0.85, base * T.value);
    const minTier = type === 'nit' ? 2.7 : type === 'fish' ? 1.5 : 2;
    const sorted = combos.slice().sort((a, b) => b.k.v - a.k.v);
    let vW = 0;
    for (const c of sorted) { if (vW >= vTarget) break; if (c.k.tier < minTier) continue; c.role = 'value'; vW += c.w; }
    const street = board.length;
    const alpha = bet / (pot + 2 * bet);
    const share = Math.min(0.6, alpha * (street === 5 ? 1 : street === 4 ? 1.3 : 1.6));
    const bTarget = vW * share / (1 - share) * T.bluff;
    const drawRank = c => c.k.draw === 'Combo draw' ? 4 : c.k.draw === 'Flush draw' ? 3 : c.k.draw === 'Open-ender' ? 2.5 : c.k.draw === 'Gutshot' ? 1.5 : 0;
    const cand = combos.filter(c => !c.role && c.k.tier <= 1.5).sort((a, b) => (drawRank(b) - drawRank(a)) || (a.k.v - b.k.v));
    let bW = 0;
    for (const c of cand) { if (bW >= bTarget) break; if (c.k.tier > 0 && !c.k.draw) continue; c.role = 'bluff'; bW += c.w; }
    const range = combos.filter(c => c.role);
    // composition
    const comp = {};
    range.forEach(c => { const key = c.role === 'bluff' ? (c.k.draw || 'Air') + ' (bluff)' : c.k.label; comp[key] = (comp[key] || 0) + c.w; });
    const tot = vW + bW;
    return { range, valueW: vW, bluffW: bW, bluffPct: tot ? bW / tot : 0, betPct: tot / W, comp: Object.entries(comp).map(([k, w]) => [k, w / tot]).sort((a, b) => b[1] - a[1]) };
  }

  function equity(heroH, board, range, iters = 2500) {
    if (!range.length) return 1;
    const hv = board.length === 5 ? evalCards([...heroH, ...board]) : 0;
    if (board.length === 5) {
      let s = 0, w = 0;
      for (const c of range) { const vv = evalCards([...c.h, ...board]); s += c.w * (hv > vv ? 1 : hv === vv ? 0.5 : 0); w += c.w; }
      return s / w;
    }
    const cum = []; let t = 0; for (const c of range) { t += c.w; cum.push(t); }
    const used = new Set([...heroH, ...board]);
    const deck = []; for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    const need = 5 - board.length; let win = 0;
    for (let i = 0; i < iters; i++) {
      const r = Math.random() * t; let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
      const vh = range[lo].h; const run = [];
      while (run.length < need) { const c = deck[(Math.random() * deck.length) | 0]; if (c !== vh[0] && c !== vh[1] && !run.includes(c)) run.push(c); }
      const b = board.concat(run);
      const a = evalCards([...heroH, ...b]), v = evalCards([...vh, ...b]);
      win += a > v ? 1 : a === v ? 0.5 : 0;
    }
    return win / iters;
  }

  // ---------- drill generation ----------
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const OPEN_POS = { UTG: 0.15, HJ: 0.22, CO: 0.28, BTN: 0.42 };
  function deal(opts = {}) {
    const type = opts.type && opts.type !== 'mix' ? opts.type : pick(['nit', 'fish', 'tag', 'lag']);
    const streetN = opts.street && opts.street !== 'mix' ? +opts.street : pick([3, 3, 4, 5]);
    const heroBB = Math.random() < 0.6;
    const vPos = heroBB ? pick(['UTG', 'HJ', 'CO', 'BTN']) : pick(['UTG', 'HJ', 'CO']);
    const heroPos = heroBB ? 'BB' : 'BTN';
    const preW = Engine.topRange(Math.min(0.7, OPEN_POS[vPos] * TYPES[type].open));
    const heroTop = heroBB ? 0.45 : 0.2, hero3b = heroBB ? 0.05 : 0.04;
    const hw = Engine.topRange(heroTop), h3 = Engine.topRange(hero3b);
    const heroW = hw.map((w, i) => Math.max(0, w - h3[i]));
    const startStack = Math.round(18 + Math.random() * 42);
    let pot = heroBB ? 5.9 : 6.9, invested = 2.2;
    const flopBet = pick([0.33, 0.5]), turnBet = pick([0.5, 0.66]);
    if (streetN >= 4) { invested += flopBet * pot; pot += 2 * flopBet * pot; }
    if (streetN >= 5) { invested += turnBet * pot; pot += 2 * turnBet * pot; }
    const remaining = Math.max(1, startStack - invested);
    const sizes = streetN === 3 ? [0.33, 0.5, 0.75] : [0.5, 0.75, 1.25];
    let bet = +(pick(sizes) * pot).toFixed(1); let allin = false;
    if (bet >= remaining * 0.9) { bet = +remaining.toFixed(1); allin = true; }
    // draw cards: board first, then pick an instructive hero hand
    const deck = [...Array(52).keys()].sort(() => Math.random() - 0.5);
    const board = deck.slice(0, streetN);
    const heroCombos = rangeCombos(heroW, board);
    const br = bettingRange(type, preW, board, [], pot, bet); // rough range for hand selection
    const need = bet / (pot + 2 * bet);
    const R = streetN === 5 ? 1 : heroBB ? 0.85 : 0.95;
    let best = null;
    for (let k = 0; k < 7; k++) {
      const c = pick(heroCombos).h;
      const rr = br.range.filter(x => !x.h.includes(c[0]) && !x.h.includes(c[1]));
      const e = equity(c, board, rr, 500);
      const d = Math.abs(e * R - need);
      if (!best || d < best.d) best = { h: c, d };
    }
    const heroH = Math.random() < 0.7 ? best.h : pick(heroCombos).h;
    return analyzeSpot({ type, streetN, heroBB, vPos, heroPos, preW, board, heroH, pot: +pot.toFixed(1), bet, allin, remaining: +remaining.toFixed(1), startStack });
  }

  function analyzeSpot(sp) {
    const br = bettingRange(sp.type, sp.preW, sp.board, sp.heroH, sp.pot, sp.bet);
    const eq = equity(sp.heroH, sp.board, br.range, 3000);
    const need = sp.bet / (sp.pot + 2 * sp.bet);
    const R = sp.streetN === 5 ? 1 : sp.heroBB ? 0.85 : 0.95;
    const callEV = eq * R * (sp.pot + 2 * sp.bet) - sp.bet;
    const raiseOK = !sp.allin && sp.remaining > sp.bet * 2.5;
    const raiseBar = sp.streetN === 5 ? 0.72 : sp.type === 'nit' ? 0.7 : 0.64;
    let mix;
    const sig = x => 1 / (1 + Math.exp(-x));
    if (raiseOK && eq >= raiseBar) { const r = sig((eq - raiseBar) / 0.04); mix = { raise: 0.45 + 0.4 * r, call: 0.55 - 0.4 * r, fold: 0 }; }
    else { const c = sig(callEV / 0.35); mix = { call: c, fold: 1 - c, raise: 0 }; }
    const k = classify(sp.heroH, sp.board);
    const raiseTo = +(sp.bet * (sp.streetN === 5 ? 2.8 : 3)).toFixed(1);
    return { ...sp, br, eq, need, R, callEV, mix, k, raiseOK, raiseTo };
  }

  function byType(sp) {
    const out = {};
    for (const t of Object.keys(TYPES)) {
      const preW = Engine.topRange(Math.min(0.7, OPEN_POS[sp.vPos] * TYPES[t].open));
      const r = analyzeSpot({ ...sp, type: t, preW });
      out[t] = r;
    }
    return out;
  }

  // ---------- outs (for math sprint) ----------
  function countOuts(h, board) {
    const used = new Set([...h, ...board]); const before = evalCards([...h, ...board]) >> 20; let outs = 0;
    for (let c = 0; c < 52; c++) if (!used.has(c)) { const after = evalCards([...h, ...board, c]) >> 20; const bAfter = evalCards([...board, c]) >> 20; if (after >= 4 && before < 4 && bAfter < 4) outs++; }
    return outs;
  }

  return { evalCards, classify, bettingRange, equity, deal, analyzeSpot, byType, countOuts, str, TYPES, STREET };
})();
