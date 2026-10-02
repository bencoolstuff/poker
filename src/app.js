Engine.init(EQDATA);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ORDER = ['allin', 'raise', 'call', 'fold'];
const LABEL = { allin: 'All-in', raise: 'Raise', call: 'Call', fold: 'Fold' };
const RANKV = { fold: 0, call: 1, raise: 2, allin: 3 };
const SUITS = { s: ['♠', 0], h: ['♥', 1], d: ['♦', 1], c: ['♣', 0] };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
let LOG = store.get('mttcoach.log', []);
const fmt = (x, d = 1) => (x == null || isNaN(x)) ? '–' : Number(x).toFixed(d);
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = () => new Promise(r => setTimeout(r, 0));

// ---------- player types ----------
const TYPE = {
  none: { name: 'No read' },
  nit: { name: 'Nit', vpip: 12, pfr: 9, short: 'Nit' },
  fish: { name: 'Fish', vpip: 45, pfr: 7, short: 'Fish' },
  tag: { name: 'TAG Reg', vpip: 22, pfr: 18, short: 'TAG' },
  lag: { name: 'LAG Reg', vpip: 32, pfr: 26, short: 'LAG' },
  custom: { name: 'Custom' }
};
const TYPE_GUIDE = {
  nit: ['Extremely tight rec player who only plays premium hands.', 'Steal their blinds relentlessly. Fold to their 3-bets and big bets unless you have the goods. Their shove range is narrow - call it tighter.'],
  fish: ['Rec player who loves to see flops and never folds top pair.', 'Value bet thinner and bigger. Don\'t bluff them - they call. Isolate their limps with strong hands and keep pots heads-up.'],
  tag: ['Tight-aggressive reg. Plays few hands, plays them hard - the classic winning style.', 'Respect their early-position opens. Their bets are balanced, so lean on pot odds and MDF. Pick on them at the bubble when they tighten up.'],
  lag: ['Loose-aggressive reg. Plays lots of hands aggressively and is tough to read when done well.', 'Call down lighter and 3-bet or jam wider over their opens. Let them bluff into you, and avoid marginal spots out of position.'],
};
function typeOf(p) {
  if (!p.vpip && !p.pfr) return 'none';
  for (const k of ['nit', 'fish', 'tag', 'lag']) if (+p.vpip === TYPE[k].vpip && +p.pfr === TYPE[k].pfr) return k;
  return 'custom';
}
function typeTag(p) {
  const t = p.type || typeOf(p); if (t === 'none') return '';
  return `<span class="ptag ${t}">${t === 'custom' ? `${p.vpip || '–'}/${p.pfr || '–'}` : TYPE[t].short}</span>`;
}

// ---------- chips ----------
function parseChips(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(/[,\s]/g, '');
  const m = t.match(/^([\d.]+)([km]?)$/); if (!m) return NaN;
  return +m[1] * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
}
function fmtChips(n) {
  if (n == null || isNaN(n)) return '–';
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString();
}

// ---------- payouts ----------
function makePayouts(pool, paid, shape, custom) {
  if (shape === 'custom') { const arr = (custom || '').split(/[\s,;]+/).map(parseChips).filter(v => v > 0); if (arr.length) return arr; }
  const a = shape === 'top' ? 1.15 : shape === 'flat' ? 0.6 : 0.9;
  const w = Array.from({ length: paid }, (_, i) => 1 / Math.pow(i + 1, a));
  const s = w.reduce((x, y) => x + y, 0);
  return w.map(v => pool * v / s);
}

// ================= SHARED TABLE SETUP =================
function defaultTable() {
  const P = (chips, type, name = '') => ({ name, chips, type, vpip: TYPE[type]?.vpip ?? '', pfr: TYPE[type]?.pfr ?? '', empty: false });
  return {
    name: 'Final table (example)', N: 8, hero: 5, button: 7, unit: 'chips', sb: 10000, bb: 20000, ante: 20000,
    left: 8, paid: 9, pool: 10000, shape: 'standard', custom: '', avg: '',
    players: [P(820000, 'nit'), P(410000, 'fish'), P(1250000, 'tag'), P(300000, 'lag'), P(640000, 'none', 'TRexBite'), P(980000, 'fish'), P(230000, 'tag'), P(560000, 'nit')]
  };
}
let T = store.get('ttt.table', null) || defaultTable();
let SETUPS = store.get('ttt.setups', {});
const saveTable = () => store.set('ttt.table', T);

function model(t = T) {
  const active = []; for (let no = 1; no <= t.N; no++) if (t.players[no - 1] && !t.players[no - 1].empty) active.push(no);
  const n = active.length;
  if (n < 2) return { err: 'Need at least two players in.' };
  if (!active.includes(t.hero)) return { err: 'Your seat is marked out. Pick your seat in the Me column.' };
  let button = t.button; if (!active.includes(button)) { for (let k = 1; k <= t.N; k++) { const c = ((button - 1 + k) % t.N) + 1; if (active.includes(c)) { button = c; break; } } }
  const ib = active.indexOf(button);
  const A = []; for (let k = 1; k <= n; k++) A.push(active[(ib + k) % n]);
  const engine = n === 2 ? [button, A[0]] : A.slice(2).concat([A[0], A[1]]);
  const pos = Engine.positions(n), posBySeat = {};
  engine.forEach((no, i) => posBySeat[no] = pos[i]);
  return { active, n, engine, posBySeat, button, heroIdx: engine.indexOf(t.hero) };
}
function seatLabel(no, m = model()) { const p = T.players[no - 1]; return `Seat ${no}${m.posBySeat?.[no] ? ' · ' + m.posBySeat[no] : ''}${p?.name ? ' · ' + p.name : ''}`; }
function spotFromTable(t, extra = {}) {
  const m = model(t); if (m.err) throw new Error(m.err);
  const n = m.n, bb = t.bb || 1, anteBB = (t.ante || 0) / bb;
  const post = new Array(n).fill(0); post[n - 2] = 0.5; post[n - 1] = 1 + anteBB;
  const seats = m.engine.map((no, i) => { const p = t.players[no - 1]; return { stack: Math.max(0.1, (+p.chips || 0) / bb - post[i]), vpip: +p.vpip || 0, pfr: +p.pfr || 0, chipsBB: (+p.chips || 0) / bb }; });
  const actAvg = m.engine.reduce((s, no) => s + (+t.players[no - 1].chips || 0), 0) / n;
  const avgChips = t.avg !== '' && !isNaN(parseChips(t.avg)) ? parseChips(t.avg) : actAvg;
  const left = Math.max(n, +t.left || n), paid = Math.max(1, +t.paid || 1);
  return Object.assign({
    n, heroSeat: m.heroIdx, ante: anteBB, seats, bbChips: bb,
    tourney: { left, paid, avgStack: avgChips / bb, payouts: makePayouts(+t.pool || 1000, paid, t.shape, t.custom) },
    labels: m.engine.map(no => `Seat ${no} (${m.posBySeat[no]})`), seatNos: m.engine, model: m
  }, extra);
}

// ---------- generic felt renderer ----------
// cfg: {N, heroNo, seats:[{no, empty, cls, top, name, main, sub, reads, status, bet, betBig, cards, click}], dealerNo, center, hu}
function renderTable(cfg) {
  const narrow = window.matchMedia && matchMedia('(max-width: 600px)').matches;
  const [RX, RY, BX, BY, DX, DY] = narrow ? [38, 43, 21, 27, 27, 33] : [44, 41, 25, 22, 31, 28];
  let html = `<div class="ptable ${cfg.hu ? 'hu' : ''}"><div class="felt"></div>`;
  for (const s of cfg.seats) {
    const k = (s.no - cfg.heroNo + cfg.N) % cfg.N;
    const ang = (90 + k * 360 / cfg.N) * Math.PI / 180;
    const sx = 50 + RX * Math.cos(ang), sy = 50 + RY * Math.sin(ang);
    const tag = s.click ? 'button' : 'div';
    if (s.empty) { html += `<${tag} class="seat emptyseat" ${s.click ? `data-seat="${s.no}" type="button"` : ''} style="left:${sx}%;top:${sy}%"><div class="ppos">Seat ${s.no}</div><div class="pname">empty</div></${tag}>`; continue; }
    html += `<${tag} class="seat ${s.cls || ''}" ${s.click ? `data-seat="${s.no}" type="button" aria-label="${esc(s.top)}"` : ''} style="left:${sx}%;top:${sy}%">
      ${s.cards ? `<div class="mini">${s.cards}</div>` : ''}
      <div class="ppos">${s.top}</div>${s.name ? `<div class="pname">${esc(s.name)}</div>` : ''}
      <div class="pstack">${s.main}${s.cover ? '<i class="cov" title="Covers you">▲</i>' : ''}</div>
      ${s.sub ? `<div class="pname">${s.sub}</div>` : ''}
      ${s.reads != null ? `<div class="preads">${s.reads}</div>` : ''}
      ${s.status || ''}
    </${tag}>`;
    if (s.bet) { html += `<div class="pbet ${s.betBig ? 'big' : ''}" style="left:${50 + BX * Math.cos(ang)}%;top:${50 + BY * Math.sin(ang)}%"><i></i>${s.bet}</div>`; }
    if (s.no === cfg.dealerNo) { const a2 = ang + (cfg.N <= 3 ? 0.6 : 0.42); html += `<div class="dealer" style="left:${50 + DX * Math.cos(a2)}%;top:${50 + DY * Math.sin(a2)}%">D</div>`; }
  }
  html += `<div class="pot">${cfg.center || ''}</div></div>`;
  return html;
}
function cardHTML(r, su) { return `<div class="card ${SUITS[su][1] ? 'r' : ''}">${r === 'T' ? '10' : r}<small>${SUITS[su][0]}</small></div>`; }
function cardsHTML(handStr, idx) {
  const s = (handStr || '').trim();
  if (/^[2-9TJQKA][shdc][2-9TJQKA][shdc]$/i.test(s)) return cardHTML(s[0].toUpperCase(), s[1].toLowerCase()) + cardHTML(s[2].toUpperCase(), s[3].toLowerCase());
  const c = Engine.CL[idx]; const suited = c[2] === 's';
  return cardHTML(c[0], 's') + cardHTML(c[1], suited ? 's' : 'h');
}
const pfCard = c => cardHTML('23456789TJQKA'[c >> 2], 'shdc'[c & 3]);

// visual of the shared setup
function setupTableHTML(opts = {}) {
  const m = model(); if (m.err) return `<p class="err">${m.err}</p>`;
  const bbC = T.bb || 1, unitBB = T.unit === 'bb';
  const show = ch => unitBB ? `${fmt(ch / bbC)}<small>bb</small>` : `${fmtChips(ch)}`;
  const showSmall = ch => unitBB ? fmtChips(ch) : `${fmt(ch / bbC)}bb`;
  const betTxt = ch => unitBB ? fmt(ch / bbC) : fmtChips(ch);
  const heroChips = +T.players[T.hero - 1].chips || 0;
  const n = m.n, sbNo = m.engine[n - 2], bbNo = m.engine[n - 1];
  const vIdx = opts.villainSeat ? m.engine.indexOf(opts.villainSeat) : -1;
  let pot = (T.sb || 0) + bbC + (T.ante || 0);
  const seats = [];
  for (let no = 1; no <= T.N; no++) {
    const p = T.players[no - 1];
    if (!p || p.empty) { seats.push({ no, empty: true, click: !!opts.click }); continue; }
    const i = m.engine.indexOf(no), isHero = no === T.hero, isV = opts.scenario && opts.scenario !== 'rfi' && no === opts.villainSeat;
    let bet = no === sbNo ? T.sb : no === bbNo ? bbC : 0;
    let status = '';
    if (opts.scenario) {
      const folded = i < m.heroIdx && !isV;
      if (isV) { const amt = opts.scenario === 'vsShove' ? +p.chips : (opts.openSize || 2.2) * bbC; pot += amt - bet; bet = amt; status = `<span class="pstat act">${opts.scenario === 'vsShove' ? 'All-in' : 'Raise ' + fmt(opts.openSize)}</span>`; }
      else if (folded) status = '<span class="pstat">Folded</span>';
      else if (!isHero) status = '<span class="pstat">To act</span>';
      seats.push({ no, cls: [isHero ? 'hero' : '', isV ? 'villain' : '', folded ? 'folded' : '', opts.focus === no ? 'focus' : ''].join(' '), top: `${no} · ${m.posBySeat[no]}${isHero ? ' · You' : ''}`, name: isHero ? '' : p.name, main: show(+p.chips), sub: showSmall(+p.chips), reads: isHero ? null : (typeTag(p) || '<span class="nr">no read</span>'), status, bet: bet ? betTxt(bet) : '', betBig: isV, cards: isHero ? opts.cards : '', cover: !isHero && +p.chips >= heroChips, click: !!opts.click });
    } else {
      seats.push({ no, cls: [isHero ? 'hero' : '', opts.focus === no ? 'focus' : ''].join(' '), top: `${no} · ${m.posBySeat[no]}${isHero ? ' · You' : ''}`, name: p.name, main: show(+p.chips), sub: showSmall(+p.chips), reads: isHero ? null : (typeTag(p) || '<span class="nr">no read</span>'), bet: bet ? betTxt(bet) : '', cover: !isHero && +p.chips >= heroChips, click: !!opts.click });
    }
  }
  const center = `<span>Pot</span><b>${unitBB ? fmt(pot / bbC) + 'bb' : fmtChips(pot)}</b><em>Blinds ${fmtChips(T.sb)}/${fmtChips(bbC)} · ante ${fmtChips(T.ante)}</em>`;
  return renderTable({ N: T.N, heroNo: T.hero, seats, dealerNo: m.button, center });
}

// ---------- editor ----------
function editorHTML(px) {
  const unitBB = T.unit === 'bb', m = model();
  const rows = T.players.slice(0, T.N).map((p, i) => {
    const no = i + 1, t = typeOf(p);
    const stackVal = unitBB ? fmt((+p.chips || 0) / (T.bb || 1)) : fmtChips(+p.chips || 0);
    return `<tr class="${no === T.hero ? 'hero' : ''} ${p.empty ? 'out' : ''}" data-i="${i}">
      <td class="sn">${no}<small class="poscell">${p.empty ? 'out' : (m.posBySeat?.[no] || '')}</small></td>
      <td><input type="radio" name="${px}-me" id="${px}-me${i}" data-f="me" ${no === T.hero ? 'checked' : ''} aria-label="I'm in seat ${no}"></td>
      <td><input type="radio" name="${px}-d" id="${px}-d${i}" data-f="btn" ${no === m.button ? 'checked' : ''} aria-label="Button on seat ${no}"></td>
      <td><input class="nm" id="${px}-nm${i}" data-f="name" value="${esc(p.name)}" placeholder="${no === T.hero ? 'Me' : 'Player'}"></td>
      <td><input class="num" id="${px}-st${i}" data-f="chips" value="${stackVal}" inputmode="decimal" aria-label="Seat ${no} stack"></td>
      <td>${no === T.hero ? '<span class="hint">You</span>' : `<select id="${px}-ty${i}" data-f="type" aria-label="Seat ${no} player type">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${k === t ? 'selected' : ''} ${k === 'custom' && t !== 'custom' ? 'hidden' : ''}>${v.name}</option>`).join('')}</select>`}</td>
      <td>${no === T.hero ? '' : `<input class="sm" id="${px}-vp${i}" data-f="vpip" type="number" min="0" max="100" value="${p.vpip}" placeholder="–" aria-label="Seat ${no} VPIP">`}</td>
      <td>${no === T.hero ? '' : `<input class="sm" id="${px}-pf${i}" data-f="pfr" type="number" min="0" max="100" value="${p.pfr}" placeholder="–" aria-label="Seat ${no} PFR">`}</td>
      <td><input type="checkbox" id="${px}-out${i}" data-f="empty" ${p.empty ? 'checked' : ''} aria-label="Seat ${no} empty"></td>
    </tr>`;
  }).join('');
  const names = Object.keys(SETUPS);
  return `<div class="edhead"><h2 style="margin:0">Table setup</h2>
      <div class="seg unitseg" role="group" aria-label="Stack units"><button data-unit="chips" aria-pressed="${!unitBB}">Chips</button><button data-unit="bb" aria-pressed="${unitBB}">Big blinds</button></div></div>
    <div class="row">
      <label>Seats<select id="${px}-N" data-g="N">${[2, 3, 4, 5, 6, 7, 8, 9].map(k => `<option ${k === T.N ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Small blind<input id="${px}-sb" data-g="sb" value="${(+T.sb).toLocaleString()}" inputmode="decimal"></label>
      <label>Big blind<input id="${px}-bb" data-g="bb" value="${(+T.bb).toLocaleString()}" inputmode="decimal"></label>
      <label>BB ante<input id="${px}-ante" data-g="ante" value="${(+T.ante).toLocaleString()}" inputmode="decimal"></label>
    </div>
    <div class="tablewrap"><table class="seats ed">
      <thead><tr><th>Seat</th><th>Me</th><th>D</th><th>Player</th><th>${unitBB ? 'Stack bb' : 'Chips'}</th><th>Type</th><th>VPIP</th><th>PFR</th><th>Out</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="hint">Chip counts before the hand. Type "820k" or "1.2m" in chips mode. Pick a player type to fill VPIP/PFR, then overwrite if you have real numbers.</div>
    <h3>Tournament</h3>
    <div class="row">
      <label>Players left<input id="${px}-left" data-g="left" type="number" min="2" value="${T.left}"></label>
      <label>Places paid<input id="${px}-paid" data-g="paid" type="number" min="1" value="${T.paid}"></label>
      <label>Avg stack ${unitBB ? '(bb)' : '(chips)'}<input id="${px}-avg" data-g="avg" value="${T.avg === '' ? '' : unitBB ? fmt(parseChips(T.avg) / T.bb) : T.avg}" placeholder="auto = table avg"></label>
    </div>
    <div class="row">
      <label>Prize pool<input id="${px}-pool" data-g="pool" value="${(+T.pool).toLocaleString()}" inputmode="decimal"></label>
      <label>Payout shape<select id="${px}-shape" data-g="shape">${[['standard', 'Standard'], ['top', 'Top-heavy'], ['flat', 'Flat'], ['custom', 'Paste my own']].map(([v, l]) => `<option value="${v}" ${T.shape === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label ${T.shape === 'custom' ? '' : 'hidden'}>Payouts, 1st place first<textarea id="${px}-custom" data-g="custom" placeholder="2500, 1600, 1100, 800, 600, ...">${esc(T.custom)}</textarea></label>
    <h3>Saved tables</h3>
    <div class="row" style="align-items:flex-end">
      <label>Name<input id="${px}-sname" value="${esc(T.name || '')}" placeholder="Sunday Major FT"></label>
      <button class="btn sm" data-act="save">Save</button>
    </div>
    <div class="row" style="align-items:flex-end">
      <label>Load<select id="${px}-sload">${names.length ? names.map(n => `<option>${esc(n)}</option>`).join('') : '<option value="">No saved tables yet</option>'}</select></label>
      <button class="btn sm" data-act="load" ${names.length ? '' : 'disabled'}>Load</button>
      <button class="btn sm" data-act="del" ${names.length ? '' : 'disabled'}>Delete</button>
      <button class="btn sm" data-act="reset">Example</button>
    </div>
    <div class="hint" data-msg></div>`;
}
let editorHost = null;
function mountEditor(el) {
  editorHost = el; el.innerHTML = editorHTML(el.id);
  const px = el.id, msg = t => { const m = el.querySelector('[data-msg]'); if (m) m.textContent = t; };
  el.oninput = e => {
    const f = e.target.dataset.f, g = e.target.dataset.g;
    if (f) {
      const i = +e.target.closest('tr').dataset.i, p = T.players[i];
      if (f === 'chips') { const v = T.unit === 'bb' ? parseFloat(e.target.value) * T.bb : parseChips(e.target.value); if (!isNaN(v)) p.chips = v; }
      if (f === 'name') p.name = e.target.value;
      if (f === 'vpip' || f === 'pfr') { p[f] = e.target.value; p.type = typeOf(p); const sel = el.querySelector(`#${px}-ty${i}`); if (sel) { sel.querySelector('option[value=custom]').hidden = p.type !== 'custom'; sel.value = p.type; } }
      changed(false);
    } else if (g && g !== 'N' && g !== 'shape') {
      const v = e.target.value;
      if (g === 'sb' || g === 'bb' || g === 'ante' || g === 'pool') { const c = parseChips(v); if (!isNaN(c) && (g !== 'bb' || c > 0)) T[g] = c; }
      else if (g === 'avg') T.avg = v.trim() === '' ? '' : T.unit === 'bb' ? String((parseFloat(v) || 0) * T.bb) : v;
      else T[g] = v;
      changed(false);
    }
  };
  el.onchange = e => {
    const f = e.target.dataset.f, g = e.target.dataset.g;
    if (f === 'type') { const i = +e.target.closest('tr').dataset.i, p = T.players[i], t = e.target.value; p.type = t; if (t === 'none') { p.vpip = ''; p.pfr = ''; } else if (TYPE[t].vpip) { p.vpip = TYPE[t].vpip; p.pfr = TYPE[t].pfr; } el.querySelector(`#${px}-vp${i}`).value = p.vpip; el.querySelector(`#${px}-pf${i}`).value = p.pfr; changed(false); }
    if (f === 'me') { T.hero = +e.target.closest('tr').dataset.i + 1; T.players[T.hero - 1].empty = false; changed(true); }
    if (f === 'btn') { T.button = +e.target.closest('tr').dataset.i + 1; changed(true); }
    if (f === 'empty') { const i = +e.target.closest('tr').dataset.i; if (i + 1 === T.hero) { e.target.checked = false; msg("That's your seat - move yourself first."); return; } T.players[i].empty = e.target.checked; changed(true); }
    if (g === 'N') { const N = +e.target.value; const avg = T.players.reduce((s, p) => s + (+p.chips || 0), 0) / Math.max(1, T.players.length); while (T.players.length < N) T.players.push({ name: '', chips: Math.round(avg), type: 'none', vpip: '', pfr: '', empty: false }); T.N = N; if (T.hero > N) T.hero = 1; if (T.button > N) T.button = N; changed(true); }
    if (g === 'shape') { T.shape = e.target.value; changed(true); }
  };
  el.onclick = e => {
    const u = e.target.dataset.unit; if (u) { T.unit = u; changed(true); return; }
    const a = e.target.dataset.act; if (!a) return;
    if (a === 'save') { const nm = el.querySelector(`#${px}-sname`).value.trim() || 'Table ' + (Object.keys(SETUPS).length + 1); T.name = nm; SETUPS[nm] = JSON.parse(JSON.stringify(T)); store.set('ttt.setups', SETUPS); saveTable(); mountEditor(el); el.querySelector('[data-msg]').textContent = `Saved "${nm}".`; }
    if (a === 'load') { const nm = el.querySelector(`#${px}-sload`).value; if (SETUPS[nm]) { T = JSON.parse(JSON.stringify(SETUPS[nm])); changed(true); el.querySelector('[data-msg]').textContent = `Loaded "${nm}".`; } }
    if (a === 'del') { const nm = el.querySelector(`#${px}-sload`).value; if (!nm) return; if (e.target.dataset.armed) { delete SETUPS[nm]; store.set('ttt.setups', SETUPS); mountEditor(el); el.querySelector('[data-msg]').textContent = `Deleted "${nm}".`; } else { e.target.dataset.armed = 1; e.target.textContent = 'Tap to confirm'; } }
    if (a === 'reset') { T = defaultTable(); changed(true); }
  };
}
function refreshPositions() {
  if (!editorHost) return; const m = model();
  editorHost.querySelectorAll('tbody tr').forEach((tr, i) => { const c = tr.querySelector('.poscell'); if (c) c.textContent = T.players[i].empty ? 'out' : (m.posBySeat?.[i + 1] || ''); });
}
function changed(structural) {
  saveTable();
  if (structural && editorHost) mountEditor(editorHost); else refreshPositions();
  if (!$('#view-review').hidden) { buildVillain(); drawReviewTable(); scheduleReview(); }
  if (!$('#view-prep').hidden) { drawPrepTable(); schedulePlan(); }
}

// ================= REVIEW =================
let scenario = 'rfi', villainSeat = null;
function buildVillain() {
  const m = model(), sel = $('#villain'); sel.innerHTML = '';
  if (m.err) return;
  m.engine.slice(0, m.heroIdx).forEach(no => sel.insertAdjacentHTML('beforeend', `<option value="${no}">${esc(seatLabel(no, m))}</option>`));
  if (villainSeat && [...sel.options].some(o => +o.value === villainSeat)) sel.value = villainSeat;
  else if (sel.options.length) { sel.value = sel.options[sel.options.length - 1].value; villainSeat = +sel.value; } else villainSeat = null;
  $('#villainL').hidden = scenario === 'rfi'; $('#openSizeL').hidden = scenario !== 'vsOpen'; $('#villainHint').hidden = scenario === 'rfi';
}
function drawReviewTable() {
  const x = Engine.handIndex($('#hand').value);
  $('#tableReview').innerHTML = setupTableHTML({ scenario, villainSeat, openSize: +$('#openSize').value || 2.2, cards: x >= 0 ? cardsHTML($('#hand').value, x) : '', click: true });
}
$('#tableReview').addEventListener('click', e => {
  const b = e.target.closest('[data-seat]'); if (!b) return; const no = +b.dataset.seat; const m = model(); if (m.err) return;
  const i = m.engine.indexOf(no);
  if (i >= 0 && i < m.heroIdx) { villainSeat = no; if (scenario === 'rfi') setScenario('vsOpen'); else { buildVillain(); drawReviewTable(); scheduleReview(); } }
});
function setScenario(v) {
  scenario = v; $$('#scenarioSeg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === v));
  buildVillain(); drawReviewTable(); scheduleReview();
}
$$('#scenarioSeg button').forEach(b => b.addEventListener('click', () => setScenario(b.dataset.v)));
$('#villain').addEventListener('change', () => { villainSeat = +$('#villain').value; drawReviewTable(); scheduleReview(); });
['#hand', '#openSize'].forEach(s => $(s).addEventListener('input', () => { drawReviewTable(); scheduleReview(); }));

function bestOf(mix) { return ORDER.reduce((b, k) => mix[k] > mix[b] ? k : b, 'fold'); }
function confLabel(p) { return p >= 0.85 ? 'Clear decision' : p >= 0.6 ? 'Leaning' : 'Close spot - mixed'; }
function sizeText(spot, r, act) {
  const m = r.meta, bbc = spot.bbChips;
  const chips = x => bbc ? ` · ${fmtChips(x * bbc)}` : '';
  if (act === 'raise' && m.raiseTo) return `to ${fmt(m.raiseTo)}bb${chips(m.raiseTo)} · ${pct(m.raisePctPot)} pot`;
  if (act === 'allin') return `${fmt(m.eff)}bb${chips(m.eff)}`;
  if (act === 'call' && spot.scenario === 'vsOpen') return `${fmt(spot.openSize)}bb`;
  if (act === 'call' && spot.scenario === 'vsShove') return `${fmt(m.eff)}bb`;
  return '';
}
function availActions(spot, r) { return { fold: true, call: spot.scenario !== 'rfi', raise: spot.scenario !== 'vsShove' && r.meta.eff > 12, allin: spot.scenario !== 'vsShove' }; }
function mixColor(mix) {
  let acc = 0; const stops = [];
  for (const k of ORDER) { const v = mix[k] * 100; if (v < 0.5) continue; stops.push(`var(--${k}) ${acc}% ${acc + v}%`); acc += v; }
  return stops.length ? `linear-gradient(90deg, ${stops.join(',')})` : 'var(--fold)';
}
function rangeGrid(r, selIdx, onPick) {
  const wrap = document.createElement('div'); wrap.className = 'hgrid';
  for (let i = 0; i < 169; i++) {
    const b = document.createElement('button'); const c = Engine.CL[i];
    b.textContent = c; b.style.background = mixColor(r.hands[i].mix);
    b.title = c + ' - ' + ORDER.filter(k => r.hands[i].mix[k] > 0.005).map(k => LABEL[k] + ' ' + pct(r.hands[i].mix[k])).join(', ');
    if (i === selIdx) b.className = 'sel';
    if (onPick) b.addEventListener('click', () => onPick(c)); else b.tabIndex = -1;
    wrap.appendChild(b);
  }
  return wrap;
}
function summaryHTML(r) {
  const s = r.summary;
  return `<div class="sumbar">${ORDER.map(k => `<div style="width:${s[k].pct * 100}%;background:var(--${k})"></div>`).join('')}</div>
   <div class="legend">${ORDER.filter(k => s[k].pct > 0.0005).map(k => `<span><i style="background:var(--${k})"></i>${LABEL[k]} <b>${pct(s[k].pct, 1)}</b> · ${s[k].combos.toFixed(1)} combos</span>`).join('')}</div>`;
}
function whyList(spot, r, x, rb) {
  const m = r.meta, L = spot.labels || Engine.positions(spot.n), out = [];
  const v = spot.villainSeat, vs = spot.seats[v] || {};
  out.push(`Method: ${m.method}.`);
  if (m.bf != null) { const prem = (m.bf / (1 + m.bf) - 0.5) * 100; out.push(`ICM pressure: bubble factor ${fmt(m.bf, 2)} - you need about ${fmt(Math.max(0, prem), 1)}% more equity than in a cash game to get stacks in.`); }
  if (spot.scenario === 'rfi') {
    out.push(`Opening range from here: ~${pct(m.openPct)} of hands. Push/fold range: ~${pct(m.shovePct)}.`);
    if (m.callRanges) out.push('Estimated calls vs your shove: ' + m.callRanges.map(c => `${L[c.seat]} ${pct(c.pct)}`).join(', ') + '.');
  }
  if (spot.scenario === 'vsShove') {
    out.push(`${L[v]} shove range estimate: top ${pct(m.villainRange)}${vs.vpip ? ` (${vs.vpip}/${vs.pfr || '–'})` : ''}.`);
    out.push(`Your equity vs that range: ${pct(r.hands[x].eq, 1)}. Needed with ICM: ${pct(m.needEq, 1)} (chip-EV pot odds: ${pct(m.potOdds, 1)}).`);
  }
  if (spot.scenario === 'vsOpen') {
    out.push(`${L[v]} opening range estimate: ~${pct(m.villainRange)}${vs.pfr ? ` (PFR ${vs.pfr})` : ''}. You continue with ~${pct(m.contPct)}, 3-bet ~${pct(m.threebetPct)}.`);
    if (m.eff <= 30) out.push(`If you jam, ${L[v]} calls about ${pct(m.openerCallPct)} of their opens.`);
  }
  const b1 = bestOf(r.hands[x].mix), b0 = bestOf(rb.hands[x].mix);
  out.push(b1 !== b0 ? `Reads change the answer: baseline says ${LABEL[b0]} (${pct(rb.hands[x].mix[b0])}), adjusted for these players it's ${LABEL[b1]}.` : `Baseline without reads agrees: ${LABEL[b0]} ${pct(rb.hands[x].mix[b0])}.`);
  return out;
}
function renderResult(spot, r, rb, x, handStr, target) {
  const hb = r.hands[x]; const best = bestOf(hb.mix); const av = availActions(spot, r); const evs = hb.ev || {};
  const tiles = ORDER.map(k => {
    const e = evs[k] != null && k !== 'fold' ? `EV ${evs[k] >= 0 ? '+' : ''}${fmt(evs[k], 2)}bb vs fold` : k === 'fold' ? 'EV 0 (baseline)' : '';
    const lab = k === 'allin' ? `All-in ${fmt(r.meta.eff, 1)}` : k === 'raise' ? `Raise ${r.meta.raiseTo ? fmt(r.meta.raiseTo, 1) : ''}` : LABEL[k];
    return `<div class="tile t-${k} ${av[k] ? '' : 'dim'}"><div class="t">${lab}</div><div class="p">${pct(hb.mix[k], 1)}</div><div class="e">${av[k] ? e : 'not an option'}</div></div>`;
  }).join('');
  const m = r.meta, L = spot.labels || Engine.positions(spot.n);
  const fac = [['Effective', fmt(m.eff, 1) + 'bb'], ['Pot now', fmt(m.pot, 1) + 'bb'], ['Bubble factor', fmt(m.bf, 2)], ['Players left', `${spot.tourney.left} / ${spot.tourney.paid} paid`], ['$ per bb (ICM)', fmt(m.dpb, 2)]];
  target.innerHTML = `
    <div class="row" style="align-items:center;gap:14px">
      <div class="cards">${cardsHTML(handStr, x)}</div>
      <div><div class="hint">${esc(L[spot.heroSeat])} · ${Engine.CL[x]}</div>
        <div class="rec">${LABEL[best]}<span class="size">${sizeText(spot, r, best)}</span></div>
        <span class="conf">${confLabel(hb.mix[best])} · ${pct(hb.mix[best])}</span></div>
    </div>
    <div class="tiles">${tiles}</div>
    <div class="factors">${fac.map(([a, b]) => `<div class="factor"><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <ul class="why">${whyList(spot, r, x, rb).map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
}
let rvTimer = null, last = null;
function scheduleReview() { clearTimeout(rvTimer); rvTimer = setTimeout(runReview, 180); }
function runReview() {
  const res = $('#result');
  try {
    const handStr = $('#hand').value, x = Engine.handIndex(handStr);
    if (x < 0) { res.innerHTML = `<p class="err">Can't read that hand. Try AJs, KQo, 77 or AhJd.</p>`; return; }
    const m = model(); if (m.err) { res.innerHTML = `<p class="err">${m.err}</p>`; return; }
    if (scenario === 'rfi' && m.heroIdx === m.n - 1) { res.innerHTML = `<p class="err">You're in the big blind, so it can't fold to you. Pick "Facing a raise" or move the button.</p>`; $('#rangePanel').innerHTML = ''; return; }
    if (scenario !== 'rfi' && !villainSeat) { res.innerHTML = `<p class="err">Nobody acts before you from this seat. Use "Folded to me" or move the button.</p>`; $('#rangePanel').innerHTML = ''; return; }
    const spot = spotFromTable(T, { scenario, villainSeat: scenario === 'rfi' ? 0 : m.engine.indexOf(villainSeat), openSize: +$('#openSize').value || 2.2 });
    const r = Engine.analyze(spot, true), rb = Engine.analyze(spot, false);
    last = { spot, r, rb, x, handStr };
    renderResult(spot, r, rb, x, handStr, res);
    const rp = $('#rangePanel');
    rp.innerHTML = `<h2>Whole range in this spot</h2><div class="hint">How your full range plays here, adjusted for reads. Tap a hand to review it.</div>${summaryHTML(r)}`;
    rp.appendChild(rangeGrid(r, x, c => { $('#hand').value = c; drawReviewTable(); runReview(); }));
    $('#taken').value = bestOf(r.hands[x].mix);
  } catch (e) { res.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---------- grading + log ----------
function posGroup(n, i) { const k = n - 1 - i; if (i === n - 1) return 'BB'; if (i === n - 2) return 'SB'; if (k <= 3) return 'Late (CO/BTN)'; if (k <= 5) return 'Middle'; return 'Early'; }
function stackBucket(e) { return e <= 12 ? '≤12bb' : e <= 25 ? '12-25bb' : e <= 40 ? '25-40bb' : '40bb+'; }
const SCEN = { rfi: 'Folded to me', vsOpen: 'Facing a raise', vsShove: 'Facing all-in', post: 'Post-flop' };
function gradeMix(mix, ev, taken) {
  const best = bestOf(mix), f = mix[taken] || 0;
  const verdict = f >= 0.5 || taken === best ? 'good' : f >= 0.2 ? 'ok' : 'bad';
  const dir = verdict === 'bad' ? (RANKV[taken] > RANKV[best] ? 'loose' : 'tight') : null;
  const evT = taken === 'fold' ? 0 : ev?.[taken], evB = best === 'fold' ? 0 : ev?.[best];
  const evLoss = (evT != null && evB != null) ? Math.max(0, evB - evT) : null;
  return { best, freq: f, verdict, dir, evLoss };
}
function grade(spot, r, x, taken) {
  const g = gradeMix(r.hands[x].mix, r.hands[x].ev, taken);
  return { ...g, key: `${SCEN[spot.scenario]} · ${posGroup(spot.n, spot.heroSeat)} · ${stackBucket(r.meta.eff)}` };
}
function addLog(entry) { LOG.push(entry); if (LOG.length > 3000) LOG = LOG.slice(-3000); store.set('mttcoach.log', LOG); }
$('#logBtn').addEventListener('click', () => {
  if (!last) return;
  const taken = $('#taken').value; const g = grade(last.spot, last.r, last.x, taken);
  addLog({ ts: Date.now(), src: 'hand', hand: Engine.CL[last.x], pos: Engine.positions(last.spot.n)[last.spot.heroSeat], scen: last.spot.scenario, eff: last.r.meta.eff, taken, note: $('#note').value, ...g });
  $('#logMsg').innerHTML = (g.verdict === 'good' ? `<span class="pill good">Good</span> ${LABEL[taken]} matches the recommendation.` :
    g.verdict === 'ok' ? `<span class="pill ok">Fine</span> ${LABEL[taken]} is part of a mixed strategy (${pct(g.freq)}).` :
      `<span class="pill bad">Mistake - too ${g.dir}</span> Recommended ${LABEL[g.best]}${g.evLoss != null ? `, cost about ${fmt(g.evLoss, 2)}bb` : ''}.`) + ' Saved to Leaks.';
  $('#note').value = '';
});

// ================= TABLE PREP =================
let focusSeat = null, planToken = 0, planTimer = null, PLAN = null, gridKey = 'rfi';
function drawPrepTable() { $('#tablePrep').innerHTML = setupTableHTML({ focus: focusSeat, click: true }); }
$('#tablePrep').addEventListener('click', e => {
  const b = e.target.closest('[data-seat]'); if (!b) return; const no = +b.dataset.seat; if (no === T.hero || T.players[no - 1].empty) return;
  focusSeat = no; const m = model(); const i = m.engine.indexOf(no);
  gridKey = i < m.heroIdx ? 'shove-' + no : 'rfi';
  drawPrepTable(); renderPlan();
});
function rotate(dir) {
  const m = model(); if (m.err) return; const a = m.active; const i = a.indexOf(m.button);
  T.button = a[(i + dir + a.length) % a.length]; changed(true);
}
$('#btnNext').addEventListener('click', () => rotate(1));
$('#btnPrev').addEventListener('click', () => rotate(-1));
function schedulePlan() { clearTimeout(planTimer); planTimer = setTimeout(computePlan, 350); $('#prepPlan').innerHTML = '<h2>Your plan</h2><div class="hint">Working out your ranges…</div>'; }
function bfBetween(spot, h, j) {
  const S = spot, n = S.n, post = new Array(n).fill(0); post[n - 2] = 0.5; post[n - 1] = 1 + S.ante;
  const st = S.seats.map((s, i) => s.stack + post[i]); const E = Math.min(st[h], st[j]);
  const field = { others: Math.max(0, S.tourney.left - n), otherStack: S.tourney.avgStack }, pay = S.tourney.payouts.slice(0, S.tourney.left);
  const now = Engine.icmPlayer(h, st, field, pay); const w = st.slice(), l = st.slice(); w[h] += E; w[j] -= E; l[h] -= E; l[j] += E;
  const gain = Engine.icmPlayer(h, w, field, pay) - now, loss = now - Engine.icmPlayer(h, l, field, pay);
  return gain > 0 ? loss / gain : 1;
}
async function computePlan() {
  const tok = ++planToken; const m = model();
  if (m.err) { $('#prepPlan').innerHTML = `<h2>Your plan</h2><p class="err">${m.err}</p>`; return; }
  let base; try { base = spotFromTable(T); } catch (e) { $('#prepPlan').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const h = base.heroSeat, n = base.n, P = { base, m, rfi: null, opp: {}, orbit: [], icm: [] };
  if (h !== n - 1) P.rfi = Engine.analyze({ ...base, scenario: 'rfi' }, true);
  for (let j = 0; j < n; j++) {
    if (j === h) continue; await sleep(); if (tok !== planToken) return;
    const o = { seat: m.engine[j], idx: j, bf: bfBetween(base, h, j) };
    if (j < h) {
      const os = base.seats[j].stack <= 20 ? 2.0 : 2.2;
      o.open = Engine.analyze({ ...base, scenario: 'vsOpen', villainSeat: j, openSize: os }, true); o.openSize = os;
      o.shove = Engine.analyze({ ...base, scenario: 'vsShove', villainSeat: j }, true);
    }
    P.opp[m.engine[j]] = o;
  }
  // ICM table
  const post = new Array(n).fill(0); const field = { others: Math.max(0, base.tourney.left - n), otherStack: base.tourney.avgStack }, pay = base.tourney.payouts.slice(0, base.tourney.left);
  const stk = base.seats.map(s => s.chipsBB);
  const tot = stk.reduce((a, b) => a + b, 0) + field.others * field.otherStack;
  P.icm = m.engine.map((no, i) => ({ no, chips: +T.players[no - 1].chips, share: stk[i] / tot, ev: Engine.icmPlayer(i, stk, field, pay) }));
  // orbit
  for (let k = 0; k < m.n; k++) {
    await sleep(); if (tok !== planToken) return;
    const ib = m.active.indexOf(m.button); const T2 = { ...T, button: m.active[(ib + k) % m.active.length] };
    try {
      const sp = spotFromTable(T2); const pos = Engine.positions(sp.n)[sp.heroSeat];
      if (sp.heroSeat === sp.n - 1) P.orbit.push({ k, pos, txt: 'Defend vs steals' });
      else { const r = Engine.analyze({ ...sp, scenario: 'rfi' }, true); const s = r.summary; P.orbit.push({ k, pos, raise: s.raise.pct, allin: s.allin.pct, eff: r.meta.eff }); }
    } catch (e) { }
  }
  if (tok !== planToken) return;
  PLAN = P; renderPlan();
}
function renderPlan() {
  const P = PLAN; if (!P) return; const { base, m } = P; const h = base.heroSeat, L = base.labels;
  const heroBB = base.seats[h].chipsBB, M = heroBB / (1.5 + base.ante);
  let html = `<div class="dhead"><h2 style="margin:0">Your plan this hand</h2><span class="spotline">Seat ${T.hero} · ${Engine.positions(base.n)[h]} · ${fmt(heroBB)}bb · M ${fmt(M)}</span></div>`;
  if (P.rfi) {
    const s = P.rfi.summary, mt = P.rfi.meta;
    html += `<div class="tiles t3">
      <div class="tile t-raise"><div class="t">Open-raise</div><div class="p">${pct(s.raise.pct, 1)}</div><div class="e">${s.raise.pct > 0.001 ? `to ${fmt(mt.raiseTo)}bb · ${fmtChips(mt.raiseTo * base.bbChips)}` : 'not at this depth'}</div></div>
      <div class="tile t-allin"><div class="t">Jam first in</div><div class="p">${pct(s.allin.pct, 1)}</div><div class="e">${fmt(mt.eff)}bb effective</div></div>
      <div class="tile t-fold"><div class="t">Fold</div><div class="p">${pct(s.fold.pct, 1)}</div><div class="e">of hands when folded to you</div></div></div>`;
  } else html += `<p class="hint">You're in the big blind this hand - your defending ranges vs each raiser are below.</p>`;
  const rows = m.engine.map((no, i) => {
    if (i === h) return ''; const o = P.opp[no]; const p = T.players[no - 1]; if (!o) return '';
    const cont = o.open ? 1 - o.open.summary.fold.pct : null, jam = o.open ? o.open.summary.allin.pct : null;
    const call = o.shove ? o.shove.summary.call.pct : null;
    const theyCall = P.rfi?.meta.callRanges?.find(c => c.seat === i)?.pct;
    const covers = base.seats[i].chipsBB >= heroBB;
    const risk = o.bf >= 1.5 ? '<span class="pill bad">High</span>' : o.bf >= 1.2 ? '<span class="pill ok">Medium</span>' : '<span class="pill good">Low</span>';
    return `<tr class="click ${focusSeat === no ? 'on' : ''}" data-seat="${no}">
      <td><b>${esc(L[i])}</b>${p.name ? `<div class="hint">${esc(p.name)}</div>` : ''}</td><td>${typeTag(p) || '<span class="nr">–</span>'}</td>
      <td>${fmt(base.seats[i].chipsBB)}bb${covers ? ' <span class="cov" style="font-size:12px">▲</span>' : ''}</td><td>${risk} <span class="spotline">${fmt(o.bf, 2)}</span></td>
      <td>${cont != null ? `${pct(cont)}${jam > 0.005 ? ` <span class="spotline">(jam ${pct(jam)})</span>` : ''}` : '<span class="nr">acts after you</span>'}</td>
      <td>${call != null ? pct(call) : '<span class="nr">–</span>'}</td>
      <td>${theyCall != null ? pct(theyCall) : '<span class="nr">–</span>'}</td></tr>`;
  }).join('');
  html += `<h3>Versus each player</h3><div class="tablewrap"><table class="data"><thead><tr><th>Player</th><th>Type</th><th>Stack</th><th>ICM risk</th><th>They raise: I continue</th><th>They jam: I call</th><th>I jam: they call</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="hint">ICM risk is the bubble factor between you and that stack - above 1.5, avoid marginal all-ins with them. ▲ = covers you. Tap a row for the range chart.</div>`;
  $('#prepPlan').innerHTML = html;
  $('#prepPlan').querySelectorAll('tr[data-seat]').forEach(tr => tr.addEventListener('click', () => {
    const no = +tr.dataset.seat; focusSeat = no; const i = m.engine.indexOf(no); gridKey = i < h ? 'shove-' + no : 'rfi'; drawPrepTable(); renderPlan();
  }));
  // grid panel
  const opts = []; if (P.rfi) opts.push(['rfi', 'Folded to me - my opening range']);
  m.engine.forEach((no, i) => { if (i < h) { opts.push(['open-' + no, `${L[i]} raises to ${P.opp[no].openSize}bb`]); opts.push(['shove-' + no, `${L[i]} jams`]); } });
  if (!opts.some(o => o[0] === gridKey) && opts.length) gridKey = opts[0][0];
  const g = $('#prepGrid');
  if (!opts.length) { g.innerHTML = '<h2>Range chart</h2><p class="hint">Nothing to chart from this seat.</p>'; }
  else {
    g.innerHTML = `<h2>Range chart</h2><label>Scenario<select id="gridSel">${opts.map(([k, l]) => `<option value="${k}" ${k === gridKey ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><div id="gridBody"></div>`;
    const draw = () => {
      const [kind, no] = gridKey.split('-'); const r = kind === 'rfi' ? P.rfi : kind === 'open' ? P.opp[no].open : P.opp[no].shove;
      const b = $('#gridBody'); b.innerHTML = summaryHTML(r) + `<div class="hint" style="margin-top:6px">${esc(r.meta.method)} · ${fmt(r.meta.eff)}bb effective.</div>`;
      b.appendChild(rangeGrid(r, -1, c => { $('#hand').value = c; showTab('review'); }));
    };
    draw(); $('#gridSel').addEventListener('change', e => { gridKey = e.target.value; draw(); });
  }
  // orbit
  $('#prepOrbit').innerHTML = `<h2>Next ${P.orbit.length} hands</h2><div class="hint" style="margin-bottom:8px">Your first-in range as the button moves, if stacks stay the same.</div>
    <div class="orbit">${P.orbit.map(o => `<div class="orb ${o.k === 0 ? 'now' : ''}"><span class="hint">${o.k === 0 ? 'This hand' : '+' + o.k}</span><b>${o.pos}</b>${o.txt ? o.txt : `${o.raise > 0.003 ? `Open ${pct(o.raise)}` : ''}${o.raise > 0.003 && o.allin > 0.003 ? ' · ' : ''}${o.allin > 0.003 ? `Jam ${pct(o.allin)}` : ''}${o.raise + o.allin < 0.003 ? 'Fold all' : ''}`}</div>`).join('')}</div>`;
  // ICM
  const pay = base.tourney.payouts, left = base.tourney.left;
  const jumps = []; for (let p = Math.min(left, pay.length); p >= 2 && jumps.length < 4; p--) jumps.push(`${p}th→${p - 1}${p - 1 === 1 ? 'st' : p - 1 === 2 ? 'nd' : p - 1 === 3 ? 'rd' : 'th'}: +${Math.round((pay[p - 2] || 0) - (pay[p - 1] || 0)).toLocaleString()}`);
  const sorted = P.icm.slice().sort((a, b) => b.chips - a.chips);
  $('#prepICM').innerHTML = `<h2>ICM equity</h2><div class="tablewrap"><table class="data"><thead><tr><th>Player</th><th>Chips</th><th>Chip %</th><th>ICM $</th><th>ICM %</th></tr></thead><tbody>
    ${sorted.map(r => `<tr class="${r.no === T.hero ? 'on' : ''}"><td>${esc(seatLabel(r.no, m))}${r.no === T.hero ? ' (you)' : ''}</td><td>${fmtChips(r.chips)}</td><td><span class="mini-bar" style="width:${r.share * 120}px"></span>${pct(r.share, 1)}</td><td>${Math.round(r.ev).toLocaleString()}</td><td>${pct(r.ev / (pay.slice(0, left).reduce((a, b) => a + b, 0) || 1), 1)}</td></tr>`).join('')}</tbody></table></div>
    <div class="hint" style="margin-top:6px">${left > base.n ? `${left - base.n} players at other tables counted at the average stack. ` : ''}Next pay jumps: ${jumps.join(' · ') || 'none'}. Big stacks are worth less per chip than short stacks - that's why short stacks must be careful and big stacks can pressure.</div>`;
}

// ================= PRE-FLOP DRILLS =================
let drill = null, dStats = store.get('mttcoach.drill', { n: 0, good: 0, streak: 0, best: 0 });
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
function dealDrill() {
  for (let tries = 0; tries < 30; tries++) {
    const n = 8;
    let scen = $('#dScen').value; if (scen === 'mix') scen = pick(['rfi', 'rfi', 'vsOpen', 'vsShove']);
    let stage = $('#dStage').value; if (stage === 'mix') stage = pick(['early', 'bubble', 'ft']);
    const sm = $('#dStack').value; const [lo, hi] = sm === 'short' ? [6, 15] : sm === 'mid' ? [15, 30] : sm === 'deep' ? [30, 60] : [8, 50];
    const hero = scen === 'rfi' ? Math.floor(rnd(0, n - 1)) : Math.floor(rnd(1, n));
    const villain = scen === 'rfi' ? 0 : Math.floor(rnd(Math.max(0, hero - 4), hero));
    const seats = Array.from({ length: n }, () => ({ stack: +rnd(6, 70).toFixed(1), vpip: 0, pfr: 0, type: 'none' }));
    seats[hero].stack = +rnd(lo, hi).toFixed(1);
    if (scen !== 'rfi') seats[villain].stack = +rnd(lo, hi * 1.4).toFixed(1);
    if ($('#dReads').checked) seats.forEach((s, i) => { if (i === hero) return; const t = pick(['nit', 'fish', 'tag', 'lag', 'tag', 'none']); s.type = t; if (t !== 'none') { s.vpip = TYPE[t].vpip; s.pfr = TYPE[t].pfr; } });
    let left, paid, avg;
    if (stage === 'early') { left = Math.round(rnd(150, 600)); paid = 60; avg = rnd(35, 60); }
    else if (stage === 'bubble') { paid = pick([18, 27, 45]); left = paid + Math.round(rnd(1, 5)); avg = rnd(20, 35); }
    else { paid = 9; left = n; avg = rnd(25, 60); }
    const spot = { n, heroSeat: hero, scenario: scen, villainSeat: villain, openSize: pick([2, 2.1, 2.2, 2.5]), ante: 1, seats, tourney: { left, paid, avgStack: avg, payouts: makePayouts(10000, paid, 'standard') }, bbChips: 0 };
    let r; try { r = Engine.analyze(spot, true); } catch (e) { continue; }
    const cand = r.hands.filter(hd => hd.mix[bestOf(hd.mix)] < 0.97);
    const hd = (cand.length && Math.random() < 0.75) ? pick(cand) : pick(r.hands);
    return { spot, r, x: hd.i, stage };
  }
  return null;
}
function drillTableHTML(s, x) {
  const n = s.n, pos = Engine.positions(n), h = s.heroSeat;
  const sb = n - 2, bbI = n - 1, vil = s.scenario === 'rfi' ? -1 : s.villainSeat;
  const bets = new Array(n).fill(0); bets[sb] = 0.5; bets[bbI] = 1;
  if (s.scenario === 'vsOpen') bets[vil] = s.openSize;
  if (s.scenario === 'vsShove') bets[vil] = s.seats[vil].stack + (vil === sb ? 0.5 : vil === bbI ? 1 : 0);
  const pot = bets.reduce((a, b) => a + b, 0) + (s.ante || 0);
  const seats = s.seats.map((st, i) => {
    const folded = i < h && i !== vil;
    const status = folded ? '<span class="pstat">Folded</span>' : i === vil ? `<span class="pstat act">${s.scenario === 'vsShove' ? 'All-in' : 'Raise ' + fmt(s.openSize)}</span>` : (i > h ? '<span class="pstat">To act</span>' : '');
    const stackNow = i === vil ? (s.scenario === 'vsShove' ? 0 : Math.max(0, st.stack - s.openSize + (i === sb ? 0.5 : 0))) : st.stack;
    return { no: i + 1, cls: [i === h ? 'hero' : '', i === vil ? 'villain' : '', folded ? 'folded' : ''].join(' '), top: pos[i] + (i === h ? ' · You' : ''), main: `${fmt(stackNow)}<small>bb</small>`, reads: i === h ? null : (st.type && st.type !== 'none' ? typeTag(st) : '<span class="nr">no read</span>'), status, bet: bets[i] ? fmt(bets[i]) : '', betBig: i === vil, cards: i === h ? cardsHTML(Engine.CL[x], x) : '', cover: i !== h && st.stack + bets[i] >= s.seats[h].stack + bets[h] };
  });
  return renderTable({ N: n, heroNo: h + 1, seats, dealerNo: n - 2, center: `<span>Pot</span><b>${fmt(pot)}bb</b><em>incl. ${fmt(s.ante)}bb ante</em>` });
}
function renderDrillSpot() {
  const d = drill, s = d.spot, pos = Engine.positions(s.n), box = $('#dSpot');
  const what = s.scenario === 'rfi' ? `Folded to you in ${pos[s.heroSeat]}` : s.scenario === 'vsOpen' ? `${pos[s.villainSeat]} raises to ${s.openSize}bb` : `${pos[s.villainSeat]} moves all-in`;
  const av = availActions(s, d.r);
  box.innerHTML = `<div class="dhead"><h2 style="margin:0">Your decision</h2><div class="spotline">${s.tourney.left} left · ${s.tourney.paid} paid · avg ${fmt(s.tourney.avgStack, 0)}bb</div></div>
    <div class="rec" style="font-size:24px">${what}</div>
    ${drillTableHTML(s, d.x)}
    <div class="actbtns">${ORDER.map(k => `<button class="t-${k}" data-a="${k}" ${av[k] ? '' : 'disabled'}>${k === 'raise' && d.r.meta.raiseTo ? 'Raise ' + fmt(d.r.meta.raiseTo) : k === 'allin' ? 'All-in ' + fmt(d.r.meta.eff) : LABEL[k]}</button>`).join('')}</div>`;
  box.querySelectorAll('.actbtns button').forEach(b => b.addEventListener('click', () => answerDrill(b.dataset.a)));
}
function answerDrill(a) {
  if (!drill || drill.done) return; drill.done = true;
  const { spot, r, x } = drill; const g = grade(spot, r, x, a);
  dStats.n++; if (g.verdict !== 'bad') { dStats.good++; dStats.streak++; dStats.best = Math.max(dStats.best, dStats.streak); } else dStats.streak = 0;
  store.set('mttcoach.drill', dStats);
  addLog({ ts: Date.now(), src: 'drill', hand: Engine.CL[x], pos: Engine.positions(spot.n)[spot.heroSeat], scen: spot.scenario, eff: r.meta.eff, taken: a, ...g });
  const rb = Engine.analyze(spot, false);
  const box = $('#dResult'); box.hidden = false;
  const head = g.verdict === 'good' ? `<span class="pill good">Correct</span>` : g.verdict === 'ok' ? `<span class="pill ok">Acceptable mix</span>` : `<span class="pill bad">Too ${g.dir}</span>`;
  box.innerHTML = `<div style="margin-bottom:10px">${head} You chose ${LABEL[a]}.</div><div id="dRes"></div>
    <h2 style="margin-top:16px">Whole range here</h2>${summaryHTML(r)}<div id="dGrid"></div>
    <div style="margin-top:12px"><button class="btn primary" id="dNext">Next spot</button></div>`;
  renderResult(spot, r, rb, x, Engine.CL[x], $('#dRes'));
  $('#dGrid').appendChild(rangeGrid(r, x, null));
  $('#dNext').addEventListener('click', newDrill);
  renderDrillScore();
}
function kpiHTML(list) { return list.map(([a, b]) => `<div class="kpi"><span>${a}</span><b>${b}</b></div>`).join(''); }
function renderDrillScore() { $('#dScore').innerHTML = kpiHTML([['Spots', dStats.n], ['Accuracy', dStats.n ? pct(dStats.good / dStats.n) : '–'], ['Streak', dStats.streak], ['Best streak', dStats.best]]); }
function newDrill() { drill = dealDrill(); $('#dResult').hidden = true; if (drill) renderDrillSpot(); else $('#dSpot').innerHTML = '<p class="err">Could not deal a spot with these settings. Try Mixed.</p>'; }
$('#dNew').addEventListener('click', newDrill);

// ================= POST-FLOP DRILLS =================
let post = null, pStats = store.get('ttt.post', { n: 0, good: 0, streak: 0, best: 0 }), postMode = 'dec';
let sprint = null, sBest = store.get('ttt.sprintBest', 0);
function renderPostScore() {
  if (postMode === 'dec') $('#pScore').innerHTML = kpiHTML([['Spots', pStats.n], ['Accuracy', pStats.n ? pct(pStats.good / pStats.n) : '–'], ['Streak', pStats.streak], ['Best streak', pStats.best]]);
  else $('#pScore').innerHTML = kpiHTML([['Best sprint', `${sBest}/10`], ['This sprint', sprint ? `${sprint.score}/${sprint.i + (sprint.answered ? 1 : 0)}` : '–']]);
}
$$('#postMode button').forEach(b => b.addEventListener('click', () => {
  postMode = b.dataset.m; $$('#postMode button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('#postSettings').hidden = postMode !== 'dec'; $('#sprintSettings').hidden = postMode !== 'sprint'; $('#pResult').hidden = true;
  if (postMode === 'dec') { post ? renderPostSpot() : newPost(); } else { sprint ? renderSprint() : startSprint(); }
  renderPostScore();
}));
const sizeLabel = (bet, pot) => { const s = bet / pot; return s <= 0.4 ? 'small' : s <= 0.6 ? 'half-pot' : s <= 0.9 ? 'large' : 'overbet'; };
function postTableHTML(sp, reveal) {
  const T2 = PF.TYPES[sp.type];
  const vStack = Math.max(0, sp.remaining - sp.bet);
  const seats = [
    { no: 1, cls: 'hero', top: `${sp.heroPos} · You`, main: `${fmt(sp.remaining)}<small>bb</small>`, reads: null, cards: sp.heroH.map(pfCard).join('') },
    { no: 2, cls: 'villain', top: `${sp.vPos} · Villain`, main: `${fmt(vStack)}<small>bb</small>`, reads: `<span class="ptag ${sp.type}">${T2.name}</span>`, status: `<span class="pstat act">${sp.allin ? 'All-in ' : 'Bets '}${fmt(sp.bet)}</span>`, bet: fmt(sp.bet), betBig: true }
  ];
  return renderTable({ N: 2, heroNo: 1, hu: true, seats, dealerNo: sp.heroBB ? 2 : 1, center: `<div class="board">${sp.board.map(pfCard).join('')}</div><span>Pot</span><b>${fmt(sp.pot)}bb</b>` });
}
function newPost() {
  $('#pSpot').innerHTML = '<p class="hint">Dealing…</p>'; $('#pResult').hidden = true;
  setTimeout(() => { post = PF.deal({ type: $('#pType').value, street: $('#pStreet').value }); renderPostSpot(); }, 10);
}
function renderPostSpot() {
  const sp = post; const st = PF.STREET[sp.streetN];
  const pre = sp.heroBB ? `${sp.vPos} raised, you defended the big blind` : `${sp.vPos} raised, you called on the button`;
  $('#pSpot').innerHTML = `<div class="dhead"><h2 style="margin:0">${st} decision</h2><span class="spotline">${pre}</span></div>
    <div class="rec" style="font-size:24px">${PF.TYPES[sp.type].name} ${sp.allin ? 'shoves' : 'bets'} ${fmt(sp.bet)}bb into ${fmt(sp.pot)}bb</div>
    ${postTableHTML(sp)}
    <div class="actbtns a3">
      <button class="t-fold" data-a="fold">Fold</button>
      <button class="t-call" data-a="call">Call ${fmt(sp.bet)}</button>
      <button class="t-raise" data-a="raise" ${sp.raiseOK ? '' : 'disabled'}>Raise ${fmt(sp.raiseTo)}</button>
    </div>`;
  $('#pSpot').querySelectorAll('.actbtns button').forEach(b => b.addEventListener('click', () => answerPost(b.dataset.a)));
}
function answerPost(a) {
  const sp = post; if (!sp || sp.done) return; sp.done = true;
  const ev = { call: sp.callEV, raise: sp.mix.raise > 0 ? sp.callEV : null };
  const g = gradeMix(sp.mix, { call: sp.callEV }, a);
  pStats.n++; if (g.verdict !== 'bad') { pStats.good++; pStats.streak++; pStats.best = Math.max(pStats.best, pStats.streak); } else pStats.streak = 0;
  store.set('ttt.post', pStats);
  const key = `Post-flop · ${PF.STREET[sp.streetN]} · facing ${sizeLabel(sp.bet, sp.pot)} bet · vs ${PF.TYPES[sp.type].name}`;
  addLog({ ts: Date.now(), src: 'post', hand: sp.heroH.map(PF.str).join(''), pos: 'vs ' + PF.TYPES[sp.type].name, scen: 'post', eff: sp.bet, taken: a, ...g, key });
  const by = PF.byType(sp);
  const head = g.verdict === 'good' ? `<span class="pill good">Correct</span>` : g.verdict === 'ok' ? `<span class="pill ok">Acceptable</span>` : `<span class="pill bad">Too ${g.dir}</span>`;
  const best = bestOf(sp.mix);
  const handTxt = sp.k.label + (sp.k.draw ? ' + ' + sp.k.draw.toLowerCase() : '');
  const comp = sp.br.comp.slice(0, 7);
  const box = $('#pResult'); box.hidden = false;
  box.innerHTML = `<div style="margin-bottom:10px">${head} You chose ${LABEL[a]}. Best: <b>${LABEL[best]}</b>${g.evLoss ? ` · cost ≈ ${fmt(g.evLoss, 2)}bb` : ''}</div>
    <div class="tiles t3">${['raise', 'call', 'fold'].map(k => `<div class="tile t-${k} ${k === 'raise' && !sp.raiseOK ? 'dim' : ''}"><div class="t">${LABEL[k]}</div><div class="p">${pct(sp.mix[k] || 0)}</div><div class="e">${k === 'call' ? `EV ${sp.callEV >= 0 ? '+' : ''}${fmt(sp.callEV, 2)}bb` : k === 'fold' ? 'EV 0' : sp.raiseOK ? `to ${fmt(sp.raiseTo)}bb` : 'not an option'}</div></div>`).join('')}</div>
    <div class="factors">
      <div class="factor"><span>Your hand</span><b style="font-size:16px">${handTxt}</b></div>
      <div class="factor"><span>Your equity vs bets</span><b>${pct(sp.eq, 1)}</b></div>
      <div class="factor"><span>Equity needed</span><b>${pct(sp.need, 1)}</b></div>
      <div class="factor"><span>SPR</span><b>${fmt((sp.remaining) / sp.pot)}</b></div>
    </div>
    <ul class="why">
      <li>Pot odds: call ${fmt(sp.bet)} to win ${fmt(sp.pot + sp.bet)} - you need ${pct(sp.need, 1)} equity${sp.streetN < 5 ? `. ${sp.heroBB ? 'Out of position' : 'Even in position'} you only realize part of your equity before the river, so it counts as ~${pct(sp.eq * sp.R, 1)}` : ''}.</li>
      <li>A ${PF.TYPES[sp.type].name} bets this size with ~${pct(sp.br.betPct)} of their range here, and ${pct(sp.br.bluffPct)} of those bets are bluffs.</li>
      ${sp.mix.raise > 0.3 ? `<li>You're well ahead of their betting range (${pct(sp.eq)}) - raise for value and protection.</li>` : ''}
    </ul>
    <h3>What they're betting</h3>
    <div class="sumbar">${comp.map(([k, w], i) => `<div title="${esc(k)}" style="width:${w * 100}%;background:${k.includes('bluff') ? 'var(--fold)' : 'var(--raise)'};opacity:${1 - i * 0.09}"></div>`).join('')}</div>
    <div class="legend">${comp.map(([k, w]) => `<span><i style="background:${k.includes('bluff') ? 'var(--fold)' : 'var(--raise)'}"></i>${esc(k)} <b>${pct(w)}</b></span>`).join('')}</div>
    <h3>Same spot vs other player types</h3>
    <div class="tablewrap"><table class="data"><thead><tr><th>Villain</th><th>Bluff share</th><th>Your equity</th><th>Best play</th></tr></thead><tbody>
    ${Object.entries(by).map(([t, r]) => `<tr class="${t === sp.type ? 'on' : ''}"><td><span class="ptag ${t}">${PF.TYPES[t].name}</span></td><td>${pct(r.br.bluffPct)}</td><td>${pct(r.eq)}</td><td><b>${LABEL[bestOf(r.mix)]}</b> <span class="spotline">${pct(r.mix[bestOf(r.mix)])}</span></td></tr>`).join('')}</tbody></table></div>
    <div style="margin-top:12px"><button class="btn primary" id="pNext">Next spot</button></div>`;
  $('#pNext').addEventListener('click', newPost);
  renderPostScore();
}
$('#pNew').addEventListener('click', newPost);

// ---------- math sprint ----------
function choicesAround(correct, fmtF, spread, n = 4) {
  const set = new Set([fmtF(correct)]); const out = [{ v: correct, ok: true }];
  let guard = 0;
  while (out.length < n && guard++ < 60) { const d = correct + (Math.random() < 0.5 ? -1 : 1) * spread * (1 + Math.floor(Math.random() * 3)) * (0.7 + Math.random() * 0.6); if (d <= 0) continue; const f = fmtF(d); if (set.has(f)) continue; set.add(f); out.push({ v: d, ok: false }); }
  return out.sort(() => Math.random() - 0.5).map(o => ({ txt: fmtF(o.v), ok: o.ok }));
}
function sprintQ() {
  const kind = pick(['odds', 'mdf', 'bluff', 'outsEq', 'spr', 'outs', 'outs']);
  const P = pick([4, 6, 8, 10, 12, 15, 20, 24]), f = pick([0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5]), B = +(P * f).toFixed(1);
  const pc = v => (v * 100).toFixed(0) + '%';
  if (kind === 'odds') return { q: `Pot is ${P}bb. Villain bets ${B}bb. What equity do you need to call?`, opts: choicesAround(B / (P + 2 * B), pc, 0.05), exp: `Call ÷ final pot = ${B} ÷ (${P} + ${B} + ${B}) = ${pc(B / (P + 2 * B))}.` };
  if (kind === 'mdf') return { q: `Pot is ${P}bb and you face a ${B}bb bet. What's your minimum defense frequency?`, opts: choicesAround(P / (P + B), pc, 0.06), exp: `MDF = pot ÷ (pot + bet) = ${P} ÷ ${(P + B).toFixed(1)} = ${pc(P / (P + B))}. Fold more and any two cards profit as a bluff.` };
  if (kind === 'bluff') return { q: `You bluff ${B}bb into a ${P}bb pot. How often must villain fold to break even?`, opts: choicesAround(B / (P + B), pc, 0.06), exp: `Risk ÷ (risk + reward) = ${B} ÷ ${(P + B).toFixed(1)} = ${pc(B / (P + B))}.` };
  if (kind === 'spr') { const S = pick([12, 18, 25, 30, 40, 55]), pot = pick([4.5, 6, 7, 9, 12]); return { q: `Effective stack ${S}bb, pot on the flop ${pot}bb. What's the SPR?`, opts: choicesAround(S / pot, v => v.toFixed(1), 0.8), exp: `SPR = ${S} ÷ ${pot} = ${(S / pot).toFixed(1)}. ${S / pot < 3 ? 'Low - top pair is usually committed.' : S / pot < 6 ? 'Medium - plan your sizing for a river shove.' : 'High - one pair is a bluff-catcher more often.'}` }; }
  if (kind === 'outsEq') {
    const [o, nm] = pick([[4, 'a gutshot'], [8, 'an open-ender'], [9, 'a flush draw'], [12, 'a flush draw + overcard'], [15, 'a flush draw + open-ender']]); const turn = Math.random() < 0.5;
    const eq = turn ? o / 46 : 1 - ((47 - o) * (46 - o)) / (47 * 46);
    return { q: `You have ${nm} (${o} outs) on the ${turn ? 'turn, one card to come' : 'flop, two cards to come'}. Chance to hit?`, opts: choicesAround(eq, pc, 0.06), exp: `Exact: ${pc(eq)}. Shortcut: outs × ${turn ? '2' : '4'} ≈ ${o * (turn ? 2 : 4)}%.` };
  }
  // count outs from a real hand
  for (let t = 0; t < 200; t++) {
    const d = [...Array(52).keys()].sort(() => Math.random() - 0.5); const h = d.slice(0, 2), b = d.slice(2, 5);
    const k = PF.classify(h, b); if (!k.draw || k.cat >= 1) continue;
    const outs = PF.countOuts(h, b);
    const opts = [...new Set([outs, outs + 1, outs - 1, outs + 3, outs - 3, outs + 2].filter(v => v > 0))].slice(0, 4).sort(() => Math.random() - 0.5).map(v => ({ txt: String(v), ok: v === outs }));
    return { q: `How many outs to a straight or flush?`, cards: h, board: b, opts, exp: `${k.draw}: ${outs} cards complete a straight or flush. ${outs >= 8 ? 'Strong draw - often worth playing fast.' : 'Thin draw - needs good odds or fold equity.'}` };
  }
  return sprintQ();
}
function startSprint() { sprint = { i: 0, score: 0, qs: Array.from({ length: 10 }, sprintQ), answered: false }; renderSprint(); renderPostScore(); }
function renderSprint() {
  const s = sprint; $('#pResult').hidden = true;
  if (s.i >= 10) {
    if (s.score > sBest) { sBest = s.score; store.set('ttt.sprintBest', sBest); }
    $('#pSpot').innerHTML = `<h2>Sprint done</h2><div class="rec">${s.score} / 10</div><p class="hint">${s.score >= 9 ? 'Table-ready math.' : s.score >= 7 ? 'Solid - tighten up the misses.' : 'Run it again - these need to be automatic.'}</p><button class="btn primary" id="sAgain">Another sprint</button>`;
    $('#sAgain').addEventListener('click', startSprint); renderPostScore(); return;
  }
  const q = s.qs[s.i];
  $('#pSpot').innerHTML = `<div class="dhead"><h2 style="margin:0">Question ${s.i + 1} of 10</h2><span class="spotline">Score ${s.score}</span></div>
    <div class="quiz">${q.cards ? `<div class="row" style="gap:16px;align-items:center;margin-bottom:10px"><div class="cards">${q.cards.map(pfCard).join('')}</div><div class="cards">${q.board.map(pfCard).join('')}</div></div>` : ''}
    <div class="qtext">${q.q}</div>${q.opts.map((o, j) => `<button class="opt" data-j="${j}">${o.txt}</button>`).join('')}<div id="qexp" class="hint" style="margin-top:10px"></div></div>`;
  $('#pSpot').querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => {
    if (s.answered) return; s.answered = true; const o = q.opts[+b.dataset.j];
    if (o.ok) s.score++;
    $('#pSpot').querySelectorAll('.opt').forEach((x, j) => { if (q.opts[j].ok) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); });
    $('#qexp').innerHTML = `${o.ok ? '<span class="pill good">Right</span>' : '<span class="pill bad">Not quite</span>'} ${q.exp} <button class="btn sm primary" id="qNext" style="margin-left:8px">${s.i === 9 ? 'Finish' : 'Next'}</button>`;
    $('#qNext').addEventListener('click', () => { s.i++; s.answered = false; renderSprint(); renderPostScore(); });
    renderPostScore();
  }));
}
$('#sNew').addEventListener('click', startSprint);

// ================= LEAKS =================
function renderLeaks() {
  const n = LOG.length, bad = LOG.filter(l => l.verdict === 'bad');
  const loose = bad.filter(l => l.dir === 'loose').length, tight = bad.filter(l => l.dir === 'tight').length;
  const evl = bad.reduce((s, l) => s + (l.evLoss || 0), 0);
  $('#lKpis').innerHTML = kpiHTML([['Decisions graded', n], ['Accuracy', n ? pct((n - bad.length) / n) : '–'], ['Mistakes', bad.length], ['EV lost (computed)', fmt(evl, 1) + 'bb']]);
  $('#lMeter').innerHTML = bad.length ? `<div class="meter"><div style="width:${loose / bad.length * 100}%;background:var(--raise)"></div><div style="width:${tight / bad.length * 100}%;background:var(--fold)"></div></div>
    <div class="legend"><span><i style="background:var(--raise)"></i>Too loose <b>${loose}</b> (${pct(loose / bad.length)})</span><span><i style="background:var(--fold)"></i>Too tight <b>${tight}</b> (${pct(tight / bad.length)})</span></div>`
    : `<div class="empty">No mistakes logged yet. Grade hands or run drills and this shows which way you lean.</div>`;
  const groups = {};
  LOG.forEach(l => { const g = groups[l.key] ||= { key: l.key, n: 0, loose: 0, tight: 0, ev: 0, evN: 0, ex: [] }; g.n++; if (l.verdict === 'bad') { g[l.dir]++; if (l.evLoss != null) { g.ev += l.evLoss; g.evN++; } if (g.ex.length < 4) g.ex.push(`${l.hand} ${LABEL[l.taken].toLowerCase()}`); } });
  const rows = Object.values(groups).filter(g => g.loose + g.tight > 0).sort((a, b) => (b.loose + b.tight) - (a.loose + a.tight) || b.ev - a.ev).slice(0, 12);
  $('#lTable').innerHTML = rows.length ? `<table class="data"><thead><tr><th>Spot</th><th>Leak</th><th>Mistakes</th><th>Error rate</th><th>EV lost</th><th>Examples</th></tr></thead><tbody>${rows.map(g => {
    const dir = g.loose >= g.tight ? 'loose' : 'tight';
    return `<tr><td>${esc(g.key)}</td><td><span class="pill ${dir === 'loose' ? 'bad' : 'ok'}">Too ${dir}</span></td><td>${g.loose + g.tight}</td><td>${pct((g.loose + g.tight) / g.n)} of ${g.n}</td><td>${g.evN ? fmt(g.ev, 2) + 'bb' : '–'}</td><td class="spotline">${esc(g.ex.join(', '))}</td></tr>`;
  }).join('')}</tbody></table>` : `<div class="empty">Leaks show up here once you've graded hands.</div>`;
  const recent = LOG.slice(-40).reverse();
  const src = { hand: 'Hand', drill: 'Pre-flop drill', post: 'Post-flop drill' };
  $('#lHands').innerHTML = recent.length ? `<table class="data"><thead><tr><th>When</th><th>Source</th><th>Spot</th><th>Hand</th><th>You</th><th>Best</th><th>Result</th><th>Note</th></tr></thead><tbody>${recent.map(l => `<tr><td class="spotline">${new Date(l.ts).toLocaleDateString()}</td><td>${src[l.src] || l.src}</td><td>${SCEN[l.scen]} · ${esc(l.pos)}${l.scen === 'post' ? '' : ` · ${fmt(l.eff)}bb`}</td><td><b>${esc(l.hand)}</b></td><td>${LABEL[l.taken]}</td><td>${LABEL[l.best]}</td><td><span class="pill ${l.verdict}">${l.verdict === 'good' ? 'Good' : l.verdict === 'ok' ? 'Mix' : 'Too ' + l.dir}</span></td><td>${esc(l.note || '')}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">No hands logged yet.</div>`;
}
$('#exportBtn').addEventListener('click', async () => {
  const txt = JSON.stringify(LOG); $('#io').value = txt;
  try { await navigator.clipboard.writeText(txt); $('#ioMsg').textContent = `Copied ${LOG.length} entries.`; }
  catch (e) { $('#io').select(); $('#ioMsg').textContent = 'Copy blocked here - the log is selected in the box, copy it manually.'; }
});
$('#importBtn').addEventListener('click', () => {
  try { const arr = JSON.parse($('#io').value); if (!Array.isArray(arr)) throw 0; const seen = new Set(LOG.map(l => l.ts + l.hand)); arr.forEach(l => { if (!seen.has(l.ts + l.hand)) LOG.push(l); }); store.set('mttcoach.log', LOG); $('#ioMsg').textContent = `Imported. Log now has ${LOG.length} entries.`; renderLeaks(); }
  catch (e) { $('#ioMsg').textContent = "That doesn't look like a copied log. Paste the full text from Copy log."; }
});
let clearArmed = false;
$('#clearBtn').addEventListener('click', () => {
  if (!clearArmed) { clearArmed = true; $('#clearBtn').textContent = 'Tap again to clear'; setTimeout(() => { clearArmed = false; $('#clearBtn').textContent = 'Clear log'; }, 3000); return; }
  LOG = []; store.set('mttcoach.log', LOG); clearArmed = false; $('#clearBtn').textContent = 'Clear log'; renderLeaks();
});

// ================= TOOLS =================
function renderMath() {
  const pot = +$('#mPot').value || 0, bet = +$('#mBet').value || 0, stack = +$('#mStack').value || 0;
  const need = bet / (pot + 2 * bet), mdf = pot / (pot + bet), be = bet / (pot + bet), spr = pot ? stack / pot : 0;
  const tip = spr < 2 ? 'SPR under 2: top pair or better is usually committed. Get it in rather than folding.' : spr < 5 ? 'SPR 2-5: one-pair hands play for stacks only on safe boards; plan sizing so the river shove is natural.' : 'SPR 5+: one pair is a bluff-catcher more often; pot control with medium hands, build the pot with the nuts.';
  $('#mOut').innerHTML = `<h2>Readout</h2><div class="factors">${[['Bet size', pct(pot ? bet / pot : 0) + ' pot'], ['Equity to call', pct(need, 1)], ['Min defense (MDF)', pct(mdf, 1)], ['Bluff must work', pct(be, 1)], ['SPR', fmt(spr, 1)]].map(([a, b]) => `<div class="factor"><span>${a}</span><b>${b}</b></div>`).join('')}</div>
   <ul class="why"><li>Calling needs ${pct(need, 1)} equity at the river (more on earlier streets out of position).</li><li>Facing this bet, defend at least ${pct(mdf, 0)} of your range or a bluff with any two cards profits.</li><li>Your own bluff of this size needs folds ${pct(be, 0)} of the time.</li><li>${tip}</li></ul>`;
}
['#mPot', '#mBet', '#mStack'].forEach(s => $(s).addEventListener('input', renderMath));
$('#typeGuide').innerHTML = ['nit', 'fish', 'tag', 'lag'].map(k => `<div class="typecard"><h4><span class="ptag ${k}" style="font-size:14px">${TYPE[k].name}</span></h4><div class="spotline">VPIP ${TYPE[k].vpip} · PFR ${TYPE[k].pfr}</div><p>${TYPE_GUIDE[k][0]}</p><p><b>How to beat them:</b> ${TYPE_GUIDE[k][1]}</p></div>`).join('');

// ================= TABS =================
function showTab(t) {
  $$('nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  ['review', 'prep', 'drill', 'post', 'leaks', 'tools'].forEach(v => $('#view-' + v).hidden = v !== t);
  if (t === 'review') { mountEditor($('#editorReview')); $('#editorPrep').innerHTML = ''; buildVillain(); drawReviewTable(); runReview(); }
  if (t === 'prep') { mountEditor($('#editorPrep')); $('#editorReview').innerHTML = ''; drawPrepTable(); schedulePlan(); }
  if (t === 'leaks') renderLeaks();
  if (t === 'drill') { if (!drill) newDrill(); renderDrillScore(); }
  if (t === 'post') { if (postMode === 'dec' && !post) newPost(); renderPostScore(); }
  if (t === 'tools') renderMath();
  store.set('mttcoach.tab', t);
}
$$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => {
  if (!$('#view-review').hidden) drawReviewTable();
  if (!$('#view-prep').hidden) drawPrepTable();
  if (!$('#view-drill').hidden && drill) { const done = drill.done; renderDrillSpot(); drill.done = done; }
  if (!$('#view-post').hidden && post && postMode === 'dec') { const done = post.done; renderPostSpot(); post.done = done; }
}, 200); });
const startTab = location.hash.replace('#', '') || store.get('mttcoach.tab', 'review');
showTab(['review', 'prep', 'drill', 'post', 'leaks', 'tools'].includes(startTab) ? startTab : 'review');
