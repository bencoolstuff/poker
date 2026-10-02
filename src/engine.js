// ===== Tournament study engine: ICM + push/fold + chart model + exploit adjustments =====
// Expects global EQDATA = {classes:[169], tri:[upper-triangle equities *10000]}
const Engine = (() => {
  const R = 'AKQJT98765432';
  let CL, EQ, COMBOS, STRENGTH_ORDER, PCT_RANK, PCT_OPEN, IDX = {};

  function init(data) {
    CL = data.classes;
    const n = CL.length;
    EQ = Array.from({ length: n }, () => new Float32Array(n));
    let k = 0;
    for (let x = 0; x < n; x++) for (let y = x; y < n; y++) {
      const e = data.tri[k++] / 10000;
      EQ[x][y] = e; EQ[y][x] = x === y ? 0.5 : 1 - e;
    }
    COMBOS = CL.map(c => c.length === 2 ? 6 : c[2] === 's' ? 4 : 12);
    CL.forEach((c, i) => IDX[c] = i);
    // strength = equity vs random hand (combo weighted)
    const tot = COMBOS.reduce((a, b) => a + b, 0);
    const vsRand = CL.map((_, x) => CL.reduce((s, _, y) => s + EQ[x][y] * COMBOS[y], 0) / tot);
    // blend with equity vs top 20% so calling/shoving order is realistic (pairs & broadways up, weak offsuit down)
    const pre = CL.map((_, i) => i).sort((a, b) => vsRand[b] - vsRand[a]);
    const top = new Float32Array(n); let cum = 0;
    for (const i of pre) { if (cum < tot * 0.2) top[i] = 1; cum += COMBOS[i]; }
    const vsTop = CL.map((_, x) => eqVs(x, top));
    const score = CL.map((_, i) => 0.5 * vsRand[i] + 0.5 * vsTop[i]);
    STRENGTH_ORDER = CL.map((_, i) => i).sort((a, b) => score[b] - score[a]);
    PCT_RANK = new Float32Array(n); cum = 0;
    for (const i of STRENGTH_ORDER) { PCT_RANK[i] = (cum + COMBOS[i] / 2) / tot; cum += COMBOS[i]; }
    // playability order for raise/call charts: suitedness + connectedness matter more when stacks are deeper
    const play = CL.map((c, i) => {
      let b = score[i];
      if (c.length === 3) {
        const gap = Math.abs(R.indexOf(c[0]) - R.indexOf(c[1])) - 1;
        if (c[2] === 's') b += 0.03 + (gap === 0 ? 0.02 : gap === 1 ? 0.012 : gap === 2 ? 0.005 : 0) + (c[0] === 'K' || c[0] === 'A' ? 0.012 : 0);
        else { if (c[0] === 'A' && R.indexOf(c[1]) >= 5) b -= 0.015; if (gap >= 3) b -= 0.008; }
      }
      return b;
    });
    const playOrder = CL.map((_, i) => i).sort((a, b) => play[b] - play[a]);
    PCT_OPEN = new Float32Array(n); cum = 0;
    for (const i of playOrder) { PCT_OPEN[i] = (cum + COMBOS[i] / 2) / tot; cum += COMBOS[i]; }
  }

  // ---------- ranges ----------
  const TOTAL = 1326;
  function topRange(pct) { // weights array for top pct (0..1) of hands
    const w = new Float32Array(169); let cum = 0, target = pct * TOTAL;
    for (const i of STRENGTH_ORDER) {
      if (cum >= target) break;
      const take = Math.min(1, (target - cum) / COMBOS[i]);
      w[i] = take; cum += take * COMBOS[i];
    }
    return w;
  }
  function rangePct(w) { let s = 0; for (let i = 0; i < 169; i++) s += w[i] * COMBOS[i]; return s / TOTAL; }
  function eqVs(x, w) {
    let num = 0, den = 0;
    for (let y = 0; y < 169; y++) { const c = w[y] * COMBOS[y]; if (c) { num += EQ[x][y] * c; den += c; } }
    return den ? num / den : 0.5;
  }

  // ---------- ICM (Malmuth-Harville, exact via exponential-race integral) ----------
  // stacks: table stacks (chips or bb). field: {others:int, otherStack:number}. payouts: array place 1..P
  // Returns $EV for player index i.
  function icmPlayer(i, stacks, field, payouts) {
    const si = stacks[i]; const N = stacks.filter(s => s > 0).length + field.others;
    if (si <= 0) { // busts now; tie-break ignored -> gets last remaining place
      return payouts[N] || 0; // place N+1 (1-indexed N+1 -> index N)
    }
    const total = stacks.reduce((a, b) => a + Math.max(0, b), 0) + field.others * field.otherStack;
    const rates = stacks.map(s => Math.max(0, s) / total);
    const ri = rates[i], ro = field.otherStack / total, m = field.others;
    // integrate only where hero can still finish in the money (focus the grid there)
    let uMax = 1;
    if (m > 0) {
      const Pp = payouts.length, pStar = (Pp + 8 * Math.sqrt(Pp) + 12) / m;
      if (pStar < 1) uMax = 1 - Math.pow(1 - pStar, ri / ro);
    }
    const Q = 400; let ev = 0;
    for (let q = 0; q < Q; q++) {
      const u = uMax * (q + 0.5) / Q; const t = -Math.log(1 - u) / ri;
      // distribution of number of players finishing ahead (T_j < t)
      let dist = [1];
      for (let j = 0; j < stacks.length; j++) {
        if (j === i || rates[j] <= 0) continue;
        const p = 1 - Math.exp(-rates[j] * t);
        const nd = new Array(dist.length + 1).fill(0);
        for (let k = 0; k < dist.length; k++) { nd[k] += dist[k] * (1 - p); nd[k + 1] += dist[k] * p; }
        dist = nd;
      }
      let val = 0;
      if (m > 0) {
        const p = 1 - Math.exp(-ro * t);
        // binomial pmf over m, only need up to payouts length
        const P = payouts.length; let lp = m * Math.log1p(-Math.min(p, 1 - 1e-15));
        const lr = Math.log(p || 1e-300) - Math.log1p(-Math.min(p, 1 - 1e-15));
        const lim = Math.min(m, P);
        for (let k = 0; k <= lim; k++) {
          if (k > 0) lp += Math.log((m - k + 1) / k) + lr;
          const pmf = Math.exp(lp);
          for (let a = 0; a < dist.length; a++) {
            const place = a + k; // 0-indexed
            if (place < P) val += pmf * dist[a] * payouts[place];
          }
        }
      } else {
        for (let a = 0; a < dist.length; a++) if (a < payouts.length) val += dist[a] * payouts[a];
      }
      ev += val;
    }
    return ev * uMax / Q;
  }

  // ---------- helpers ----------
  const sig = x => 1 / (1 + Math.exp(-x));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function positions(n) {
    const P = {
      2: ['SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['CO', 'BTN', 'SB', 'BB'], 5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
      6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], 7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
      8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'], 9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']
    };
    return P[n] || P[9];
  }
  // baseline first-in open % by number of players left to act (with antes, ~25-40bb)
  const OPEN_BASE = { 1: 0.45, 2: 0.46, 3: 0.31, 4: 0.25, 5: 0.20, 6: 0.18, 7: 0.16, 8: 0.15 };

  // spot = { n, heroSeat, bb (chip size of BB, optional), ante (total bb), seats:[{stack(bb behind), vpip, pfr}],
  //   scenario: 'rfi'|'vsOpen'|'vsShove', villainSeat, openSize (bb total),
  //   tourney:{left, paid, avgStack (bb), payouts[]} }
  function setup(spot) {
    const n = spot.n, pos = positions(n);
    const sbI = n - 2, bbI = n - 1;
    const post = new Array(n).fill(0);
    post[sbI] = 0.5; post[bbI] = 1;
    const anteTotal = spot.ante ?? 1;
    // BB-ante format: BB pays the ante
    post[bbI] += anteTotal;
    const start = spot.seats.map((s, i) => s.stack + post[i]);
    const field = { others: Math.max(0, spot.tourney.left - n), otherStack: spot.tourney.avgStack };
    // remaining payouts: places 1..left; payouts array index 0 = 1st
    const payouts = spot.tourney.payouts.slice(0, spot.tourney.left);
    return { n, pos, post, start, field, payouts, anteTotal };
  }

  function icmState(S, finalStacks, i) { return icmPlayer(i, finalStacks, S.field, S.payouts); }

  // marginal $ per bb for player i (for converting $EV to bb-equivalent)
  function dollarPerBB(S, stacks, i) {
    const up = stacks.slice(); up[i] += 2; const dn = stacks.slice(); dn[i] = Math.max(0.01, dn[i] - 2);
    return (icmState(S, up, i) - icmState(S, dn, i)) / (up[i] - dn[i]);
  }

  function looseness(seat) { // >1 looser than baseline
    if (!seat || !seat.vpip) return 1;
    return clamp(Math.pow(seat.vpip / 24, 0.75), 0.5, 2.2);
  }
  function aggro(seat) {
    if (!seat || !seat.pfr) return 1;
    return clamp(seat.pfr / 18, 0.45, 2.4);
  }
  function adjustRange(w, factor) { // widen/narrow a range by percentage factor
    const p = rangePct(w); return topRange(clamp(p * factor, 0, 1));
  }

  // ---- generic all-in confrontation engine ----
  // aggressor a shoves; callers in order (array of seat idx). dead: chips already committed by each seat (array).
  // Returns {statesWin[j], statesLose[j], foldAll} $ values for both aggressor and caller.
  function shoveStates(S, a, callers, committed, winnerIfFold) {
    const base = S.start.map((s, i) => s - committed[i]); // chips not yet in pot
    const pot0 = committed.reduce((x, y) => x + y, 0);
    const res = { fold: null, vs: {} };
    // all fold: aggressor gets pot
    const f = base.slice(); f[a] = S.start[a] - committed[a] + pot0; // aggressor never lost its committed chips
    // simpler: aggressor final = start_a + (pot0 - committed[a])
    f[a] = S.start[a] + (pot0 - committed[a]);
    for (let i = 0; i < S.n; i++) if (i !== a) f[i] = S.start[i] - committed[i];
    res.fold = { stacks: f };
    for (const j of callers) {
      const E = Math.min(S.start[a], S.start[j]);
      const dead = pot0 - committed[a] - committed[j];
      const w = S.start.map((s, i) => s - committed[i]);
      const l = w.slice();
      w[a] = S.start[a] + E + dead; w[j] = S.start[j] - E;
      l[a] = S.start[a] - E; l[j] = S.start[j] + E + dead;
      res.vs[j] = { E, win: w, lose: l };
    }
    return res;
  }

  // compute $ values for those states for players a and each j
  function priceStates(S, st, a, callers) {
    const out = { foldA: icmState(S, st.fold.stacks, a), vs: {} };
    for (const j of callers) {
      const v = st.vs[j];
      out.vs[j] = {
        aWin: icmState(S, v.win, a), aLose: icmState(S, v.lose, a),
        jWin: icmState(S, v.lose, j), jLose: icmState(S, v.win, j),
        jFold: icmState(S, st.fold.stacks, j),
      };
    }
    return out;
  }

  // Solve aggressor-shove vs callers equilibrium (callers evaluate heads-up vs shove range).
  // aggressorFoldDollar: aggressor $ if he folds instead.
  // fixedShoveRange: if provided, skip aggressor optimisation (used for vsShove).
  function solveShove(S, a, callers, P, aFoldDollar, opts = {}) {
    const n = 169; let shoveW = opts.fixedShoveRange || topRange(0.3);
    let callW = {};
    for (const j of callers) callW[j] = topRange(0.12);
    const iters = opts.fixedShoveRange ? 1 : 6;
    let aEV = new Float64Array(n);
    for (let it = 0; it < iters + 1; it++) {
      // callers best response
      for (const j of callers) {
        const p = P.vs[j]; const w = new Float32Array(n);
        for (let h = 0; h < n; h++) {
          const e = eqVs(h, shoveW);
          const ev = e * p.jWin + (1 - e) * p.jLose;
          w[h] = ev > p.jFold ? 1 : 0;
        }
        callW[j] = opts.callerAdjust ? adjustRange(w, opts.callerAdjust[j] || 1) : w;
      }
      // aggressor EV per hand
      const cp = callers.map(j => rangePct(callW[j]));
      for (let h = 0; h < n; h++) {
        let pReach = 1, ev = 0;
        callers.forEach((j, k) => {
          const pc = cp[k]; const e = eqVs(h, callW[j]);
          ev += pReach * pc * (e * P.vs[j].aWin + (1 - e) * P.vs[j].aLose);
          pReach *= 1 - pc;
        });
        ev += pReach * P.foldA;
        aEV[h] = ev;
      }
      if (opts.fixedShoveRange || it === iters) break;
      const nw = new Float32Array(n);
      for (let h = 0; h < n; h++) nw[h] = aEV[h] > aFoldDollar ? 1 : 0;
      shoveW = it < 2 ? nw : nw.map((v, h) => 0.5 * v + 0.5 * shoveW[h]); // damped
    }
    return { aEV, shoveW, callW };
  }

  const ORDER = ['fold', 'call', 'raise', 'allin'];

  // ======== main analysis: returns per-hand action mix for all 169 hands ========
  function analyze(spot, exploit = true) {
    const S = setup(spot);
    const h = spot.heroSeat, n = S.n;
    const heroStart = S.start[h];
    const result = { S, hands: [], notes: [], meta: {} };
    const behind = []; for (let i = h + 1; i < n; i++) behind.push(i);
    const eff = (ids) => Math.min(heroStart, Math.max(...ids.map(i => S.start[i])));
    const potBB = S.post.reduce((a, b) => a + b, 0);
    const curStacks = S.start.slice();
    const dpb = dollarPerBB(S, curStacks, h) || 1e-9;
    result.meta.dpb = dpb; result.meta.pot = potBB;
    // bubble factor vs biggest stack behind/villain
    const bfVs = (j) => {
      const E = Math.min(heroStart, S.start[j]);
      const w = curStacks.slice(), l = curStacks.slice();
      w[h] += E; w[j] -= E; l[h] -= E; l[j] += E;
      const now = icmState(S, curStacks, h);
      const gain = icmState(S, w, h) - now, loss = now - icmState(S, l, h);
      return gain > 0 ? loss / gain : 1;
    };
    const mix = (o) => { const s = ORDER.reduce((a, k) => a + (o[k] || 0), 0) || 1; const r = {}; ORDER.forEach(k => r[k] = (o[k] || 0) / s); return r; };
    const TAU = 0.25; // bb-equivalent temperature for confidence

    if (spot.scenario === 'rfi') {
      if (h === n - 1) throw new Error('BB cannot be first in. Pick another seat or scenario.');
      const effBB = eff(behind);
      result.meta.eff = effBB;
      const bf = Math.max(...behind.map(bfVs)); result.meta.bf = bf;
      // shove EV
      const committed = S.post.slice();
      const st = shoveStates(S, h, behind, committed);
      const P = priceStates(S, st, h, behind);
      const foldStacks = S.start.map((s, i) => s - committed[i]); foldStacks[n - 1] += potBB - committed[h] + committed[h]; // BB takes pot
      foldStacks[n - 1] = S.start[n - 1] + (potBB - committed[n - 1] - committed[h]);
      foldStacks[h] = S.start[h] - committed[h];
      const foldD = icmState(S, foldStacks, h);
      const adj = {}; behind.forEach(j => adj[j] = exploit ? looseness(spot.seats[j]) : 1);
      const sol = solveShove(S, h, behind, P, foldD, exploit ? { callerAdjust: adj } : {});
      result.meta.callRanges = behind.map(j => ({ seat: j, pct: rangePct(sol.callW[j]) }));
      result.meta.shovePct = rangePct(sol.shoveW);
      // open chart
      const k = behind.length;
      let openPct = OPEN_BASE[Math.min(8, k)];
      if (h === n - 2) openPct = 0.40;
      let icmF = 1 / (1 + 0.5 * Math.max(0, bf - 1));
      let behindF = 1;
      if (exploit) {
        const v = behind.map(j => spot.seats[j].vpip).filter(Boolean);
        if (v.length) behindF = clamp(Math.pow(24 / (v.reduce((a, b) => a + b, 0) / v.length), 0.5), 0.75, 1.3);
      }
      openPct = clamp(openPct * icmF * behindF, 0.05, 0.8);
      result.meta.openPct = openPct;
      const size = sizeOpen(effBB, h === n - 2);
      result.meta.raiseTo = size; result.meta.raisePctPot = (size - (S.post[h])) / potBB;
      for (let x = 0; x < 169; x++) {
        const dEV = (sol.aEV[x] - foldD) / dpb; // bb-equivalent
        const pr = PCT_RANK[x], po = PCT_OPEN[x];
        const inOpen = sig((openPct - (effBB > 20 ? po : (po + pr) / 2)) / 0.02);
        let o;
        if (effBB <= 12) o = { allin: sig(dEV / TAU), fold: 1 - sig(dEV / TAU) };
        else if (effBB <= 20) {
          const shoveW = sig(dEV / TAU);
          // strongest third of open range raise (to induce), middle shoves when +EV
          const strongRaise = sig((openPct * 0.35 - pr) / 0.02);
          const raise = inOpen * Math.max(strongRaise, 1 - shoveW);
          const allin = (1 - raise) * shoveW * (1 - strongRaise * 0.6);
          o = { raise, allin, fold: Math.max(0, 1 - raise - allin) };
        } else {
          o = { raise: inOpen, fold: 1 - inOpen };
          if (effBB <= 25 && pr > openPct * 0.35) { const sw = sig(dEV / TAU) * 0.35; o.allin = sw * inOpen; o.raise = inOpen - o.allin; }
        }
        result.hands.push({ i: x, mix: mix(o), ev: { allin: dEV, fold: 0 }, computed: effBB <= 20 });
      }
      result.meta.method = effBB <= 12 ? 'ICM push/fold (computed)' : effBB <= 20 ? 'ICM shove EV + opening chart' : 'Opening chart, ICM + opponent adjusted';
    }

    else if (spot.scenario === 'vsShove') {
      const s = spot.villainSeat;
      if (s >= h) throw new Error('The all-in player must act before you.');
      // shover range = his push/fold solution from his seat, then profile adjustment
      const shBehind = []; for (let i = s + 1; i < n; i++) shBehind.push(i);
      const committed = S.post.slice();
      const st = shoveStates(S, s, shBehind, committed);
      const P = priceStates(S, st, s, shBehind);
      const fs = S.start.map((v, i) => v - committed[i]); fs[n - 1] = S.start[n - 1] + (potBB - committed[n - 1] - committed[s]); fs[s] = S.start[s] - committed[s];
      const sFold = icmState(S, fs, s);
      const solS = solveShove(S, s, shBehind, P, sFold);
      let shoveRange = solS.shoveW;
      if (exploit) shoveRange = adjustRange(shoveRange, clamp(Math.sqrt(looseness(spot.seats[s]) * aggro(spot.seats[s])), 0.5, 2.5));
      result.meta.villainRange = rangePct(shoveRange);
      const E = Math.min(heroStart, S.start[s]); result.meta.eff = E;
      result.meta.bf = bfVs(s);
      const v = st.vs[h];
      const win = icmState(S, v.lose, h), lose = icmState(S, v.win, h);
      const fold = icmState(S, st.fold.stacks, h);
      const need = (fold - lose) / (win - lose);
      result.meta.needEq = need;
      result.meta.potOdds = (E - committed[h]) / (2 * E + (potBB - committed[h] - committed[s]) );
      for (let x = 0; x < 169; x++) {
        const e = eqVs(x, shoveRange);
        const dEV = (e * win + (1 - e) * lose - fold) / dpb;
        const c = sig(dEV / TAU);
        result.hands.push({ i: x, mix: mix({ call: c, fold: 1 - c }), ev: { call: dEV, fold: 0 }, eq: e, computed: true });
      }
      result.meta.method = 'ICM call/fold vs estimated shove range (computed)';
    }

    else if (spot.scenario === 'vsOpen') {
      const o = spot.villainSeat;
      if (o >= h) throw new Error('The raiser must act before you.');
      const R = spot.openSize || 2.2;
      const kO = n - 1 - o;
      let oPct = OPEN_BASE[Math.min(8, kO)]; if (o === n - 2) oPct = 0.40;
      if (exploit) oPct = clamp(oPct * aggro(spot.seats[o]), 0.04, 0.9);
      const openW = topRange(oPct);
      result.meta.villainRange = oPct;
      const behindH = []; for (let i = h + 1; i < n; i++) if (i !== o) behindH.push(i);
      const committed = S.post.slice(); committed[o] = Math.max(committed[o], R + (o === n - 1 ? S.anteTotal : 0));
      const pot = committed.reduce((a, b) => a + b, 0);
      const effBB = Math.min(heroStart, S.start[o]); result.meta.eff = effBB;
      const bf = bfVs(o); result.meta.bf = bf;
      result.meta.pot = pot;
      // reshove EV: callers = players behind hero, then opener (opener range restricted)
      const callers = behindH.concat([o]);
      const st = shoveStates(S, h, callers, committed);
      const P = priceStates(S, st, h, callers);
      const fs = S.start.map((v, i) => v - committed[i]); fs[o] = S.start[o] + (pot - committed[o]); fs[h] = S.start[h] - committed[h];
      const foldD = icmState(S, fs, h);
      // custom solve: opener calls only from his open range
      let shoveW = topRange(0.12); const callW = {};
      let aEV = new Float64Array(169);
      for (let it = 0; it < 6; it++) {
        for (const j of callers) {
          const p = P.vs[j]; const w = new Float32Array(169);
          for (let x = 0; x < 169; x++) {
            const e = eqVs(x, shoveW);
            w[x] = (e * p.jWin + (1 - e) * p.jLose > p.jFold ? 1 : 0) * (j === o ? openW[x] : 1);
          }
          let ww = w;
          if (exploit) ww = adjustRange(w, looseness(spot.seats[j]));
          if (j === o) for (let x = 0; x < 169; x++) ww[x] = Math.min(ww[x], openW[x]);
          callW[j] = ww;
        }
        for (let x = 0; x < 169; x++) {
          let pr = 1, ev = 0;
          for (const j of callers) {
            const pc = j === o ? rangePct(callW[j]) / Math.max(1e-6, rangePct(openW)) : rangePct(callW[j]);
            const e = eqVs(x, callW[j]);
            ev += pr * pc * (e * P.vs[j].aWin + (1 - e) * P.vs[j].aLose); pr *= 1 - pc;
          }
          ev += pr * P.foldA; aEV[x] = ev;
        }
        const nw = new Float32Array(169); for (let x = 0; x < 169; x++) nw[x] = aEV[x] > foldD ? 1 : 0;
        shoveW = it < 2 ? nw : nw.map((v, x) => 0.5 * v + 0.5 * shoveW[x]);
      }
      result.meta.openerCallPct = rangePct(callW[o]) / Math.max(1e-6, rangePct(openW));
      // continue chart
      const isBB = h === n - 1, isSB = h === n - 2;
      const icmF = 1 / (1 + 0.8 * Math.max(0, bf - 1));
      let cont;
      if (isBB) cont = Math.min(0.75, oPct * 1.4 + 0.18) * Math.pow(2.2 / R, 0.8);
      else if (isSB) cont = oPct * 0.55;
      else cont = oPct * 0.6;
      cont = clamp(cont * icmF, 0.02, 0.85);
      if (exploit) cont = clamp(cont * clamp(Math.pow(aggro(spot.seats[o]), 0.35), 0.8, 1.3), 0.02, 0.85);
      const tbPct = Math.min(cont * 0.35, Math.max(0.025, oPct * 0.3));
      result.meta.contPct = cont; result.meta.threebetPct = tbPct;
      const ip = !isBB && !isSB;
      const tb = Math.round((ip ? 3 : 3.8) * R * 10) / 10;
      result.meta.threebetTo = tb; result.meta.threebetPctPot = (tb - committed[h]) / pot;
      result.meta.raiseTo = tb; result.meta.raisePctPot = result.meta.threebetPctPot;
      for (let x = 0; x < 169; x++) {
        const dEV = (aEV[x] - foldD) / dpb; const pr = PCT_RANK[x], po = PCT_OPEN[x];
        const inCont = sig((cont - (effBB > 25 ? po : pr)) / 0.02), inTB = sig((tbPct - pr) / 0.012);
        let m;
        if (effBB <= 12) { const s = sig(dEV / TAU); m = { allin: s, call: isBB ? (1 - s) * inCont * 0.5 : 0 }; m.fold = 1 - m.allin - m.call; }
        else if (effBB <= 25) {
          const s = sig(dEV / TAU);
          const callable = (isBB || effBB > 18) ? inCont : 0;
          m = { allin: s, call: (1 - s) * callable }; m.fold = Math.max(0, 1 - m.allin - m.call);
        } else {
          m = { raise: inTB, call: Math.max(0, inCont - inTB) * (isSB ? 0.35 : 1) };
          if (isSB) m.raise += Math.max(0, inCont - inTB) * 0.4;
          if (effBB <= 35) { const s = sig(dEV / TAU) * inTB * clamp((35 - effBB) / 10, 0, 1); m.allin = s; m.raise -= s; }
          m.fold = Math.max(0, 1 - (m.raise + m.call + (m.allin || 0)));
        }
        result.hands.push({ i: x, mix: mix(m), ev: { allin: dEV, fold: 0 }, computed: effBB <= 25 });
      }
      result.meta.method = effBB <= 25 ? 'ICM reshove EV + defend chart' : 'Defend/3-bet chart, ICM + opponent adjusted';
    }

    // range-level summary
    const sum = { fold: 0, call: 0, raise: 0, allin: 0 };
    result.hands.forEach(hd => ORDER.forEach(k => sum[k] += hd.mix[k] * COMBOS[hd.i]));
    result.summary = {}; ORDER.forEach(k => result.summary[k] = { pct: sum[k] / TOTAL, combos: sum[k] });
    return result;
  }

  function sizeOpen(eff, isSB) {
    if (isSB) return eff > 30 ? 3.0 : 2.5;
    if (eff > 40) return 2.3; if (eff > 20) return 2.1; return 2.0;
  }

  function handIndex(str) {
    str = str.trim();
    if (str.length === 4) { // cards like AhKd
      const r1 = str[0].toUpperCase(), s1 = str[1].toLowerCase(), r2 = str[2].toUpperCase(), s2 = str[3].toLowerCase();
      const [a, b] = R.indexOf(r1) <= R.indexOf(r2) ? [r1, r2] : [r2, r1];
      str = a === b ? a + b : a + b + (s1 === s2 ? 's' : 'o');
    }
    let s = str.toUpperCase();
    if (s.length === 3) s = s.slice(0, 2) + s[2].toLowerCase();
    if (s.length === 2 && s[0] !== s[1]) s = s + 'o'; // default offsuit
    if (s.length === 3) { const a = s[0], b = s[1]; if (R.indexOf(a) > R.indexOf(b)) s = b + a + s[2]; }
    return IDX[s] ?? -1;
  }

  return { init, analyze, handIndex, positions, icmPlayer, eqVs, topRange, rangePct,
    get CL() { return CL; }, get COMBOS() { return COMBOS; }, get PCT_RANK() { return PCT_RANK; }, get EQ() { return EQ; }, ORDER };
})();
if (typeof module !== 'undefined') module.exports = Engine;
