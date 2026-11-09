// UI controller: menu, input, panels, turn flow.
import { Game, REVOLT_AT, RIOT_AT, INSURRECTION_AT } from './game.js';
import { runAI, field, bestStep } from './ai.js';
import { Renderer } from './render.js';
import { MAP_SIZES, MAP_TYPES } from './mapgen.js';
import { ROOTS } from './culture.js';
import { PRICE } from './trade.js';
import {
  TERRAIN, SPECIALTY, SPECIALTY_KEYS, KIN_DIST, AFFINITY, UNITS, IMPROVEMENTS, BUILDINGS, WONDERS, TECHS, RESOURCES, TEMPERAMENTS, SUBSIDIES, SENSITIVITY,
  STRATEGIC, GOOD_KEYS, GOOD_DOUBLER, RECIPES, LUXURIES, GROUPS, goodName, impYield, GRAND,
} from './data.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'tyrrainy-save-v1';

let game = null, R = null;
let sel = null; // {kind:'unit'|'city'|'tile', id/idx}
let busy = false;
let watchMode = false;

// ------------------------------------------------------------ menu
function initMenu() {
  for (const [k, v] of Object.entries(MAP_SIZES)) $('optSize').add(new Option(v.label, k, false, k === 'medium'));
  for (const [k, v] of Object.entries(MAP_TYPES)) $('optType').add(new Option(v.label, k));
  for (let n = 2; n <= 10; n++) $('optPlayers').add(new Option(n + ' tribes', n, false, n === 6));
  for (let n = 1; n <= 4; n++) $('optHumans').add(new Option(String(n), n));
  try { if (localStorage.getItem(SAVE_KEY)) $('btnContinue').classList.remove('hidden'); } catch { }
  $('btnStart').onclick = () => startNew(false);
  $('btnWatch').onclick = () => startNew(true);
  $('btnContinue').onclick = () => {
    try {
      const g = Game.deserialize(localStorage.getItem(SAVE_KEY));
      watchMode = false;
      boot(g);
    } catch (e) { console.error(e); toast('Save could not be loaded'); }
  };
  $('btnHow').onclick = showHelp;
}

function startNew(watch) {
  watchMode = watch;
  const opts = {
    size: $('optSize').value,
    mapType: $('optType').value,
    wrap: $('optWrap').value !== 'flat',
    players: +$('optPlayers').value,
    humans: watch ? 0 : Math.min(+$('optHumans').value, +$('optPlayers').value),
    turnLimit: +$('optTurns').value,
    rebelControl: watch ? 'ai' : $('optRebels').value,
    techUpkeep: $('optUpkeep').value !== 'off',
    seed: $('optSeed').value.trim() || undefined,
  };
  const g = Game.create(opts);
  boot(g);
}

function boot(g) {
  game = g;
  $('menu').classList.add('hidden');
  for (const id of ['topbar', 'log', 'minimap', 'btnEnd', 'btnNext']) $(id).classList.remove('hidden');
  if (!R) {
    R = new Renderer($('map'), game);
    initInput();
    requestAnimationFrame(loop);
  } else { R.game = game; }
  R.revealAll = watchMode;
  game.listeners = [onEvent];
  $('log').innerHTML = '';
  $('log').style.visibility = 'hidden';
  sel = null;
  beginTurnUI();
}

// ------------------------------------------------------------ main loop
let lastMini = 0;
function loop(t) {
  if (R && game && R.dirty) {
    R.draw();
    if (t - lastMini > 250) { R.drawMinimap($('minimap')); lastMini = t; }
  }
  requestAnimationFrame(loop);
}

function onEvent(type, d) {
  if (!R) return;
  const viewer = R.viewer;
  const visible = (i) => watchMode || (i != null && game.players[viewer]._vis?.[i]);
  if (type === 'log') {
    if (d.pid === viewer || visible(d.idx) || (d.idx == null && d.pid != null && game.hasMet(viewer, d.pid)) || d.idx == null && /learned|fallen|wins|rally|coalition/.test(d.msg) && (d.pid === viewer || /fallen|wins|rally|coalition/.test(d.msg))) addLog(d.msg, d.pid, d.idx);
  } else if (type === 'attack') {
    if (visible(d.to) || visible(d.from)) {
      R.addAnim({ type: 'shot', from: d.from, to: d.to, dur: 300 });
      R.addAnim({ type: 'text', idx: d.to, text: '-' + d.dmg, color: '#ff7060', dur: 1100 });
      R.addAnim({ type: 'flash', idx: d.to, dur: 350 });
      if (d.ret) R.addAnim({ type: 'text', idx: d.from, text: '-' + d.ret, color: '#ffb060', dur: 1100 });
    }
  } else if (type === 'move') {
    if (visible(d.to) || visible(d.from)) R.addAnim({ type: 'move', uid: d.u.id, from: d.from, dur: 180 });
  } else if (type === 'levelup') {
    if (d.owner === viewer) R.addAnim({ type: 'text', idx: d.idx, text: 'Level ' + d.level + '!', color: '#9f9', dur: 1500 });
  } else if (type === 'win') {
    setTimeout(showWin, 400);
  } else if (type === 'diplo') {
    if (d.b === viewer && d.type === 'war') toast(`${game.players[d.a].name} has declared war on you!`);
  } else if (type === 'contact') {
    if (d.a === viewer && game.players[viewer].human) toast(`You have met the ${game.players[d.b].name}. Open Diplomacy (D) to deal with them.`);
  } else if (type === 'razeChoice') {
    if (game.players[d.pid].human && d.pid === R.viewer) setTimeout(() => showRazeChoice(d.city), 250);
  } else if (type === 'revolt') {
    if (d.old === viewer) toast(`${d.city.name} has revolted and joined the ${game.players[d.city.owner].name}!`);
  } else if (type === 'rebellion') {
    if (d.from === viewer) toast(`Rebellion! The ${game.players[d.pid].name} rise in ${d.city.name}.`);
  } else if (type === 'adopt') {
    if (game.players[d.from].human) setTimeout(() => toast(`Your tribe has fallen — you now lead the ${game.players[d.to].name}!`), 50);
  } else if (type === 'coalition') {
    toast(d.leader === viewer ? `The other tribes are uniting against you!` : `The tribes rally against ${game.players[d.leader].name}.`);
  } else if (type === 'wonder') {
    toast(`${game.players[d.city.owner].name} completed the ${WONDERS[d.w].name}!`);
  } else if (type === 'improve') {
    if (game.tiles[d.idx].owner === viewer && game.players[viewer].human) R.addAnim({ type: 'text', idx: d.idx, text: '+pop', color: '#9f9', dur: 900 });
  }
  R.dirty = true;
}

function addLog(msg, pid, idx) {
  const el = document.createElement('div');
  const col = pid != null && game.players[pid] ? game.players[pid].color : '#ccc';
  el.innerHTML = `<span class="dim">T${game.turn}</span> <span style="color:${col}">●</span> ${esc(msg)}`;
  if (idx != null) el.onclick = () => { R.centerOn(idx); };
  const log = $('log');
  log.appendChild(el);
  log.style.visibility = 'visible';
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function cultureChip(cul) { return `<span class="chip" style="background:${cul.color};border-color:${cul.color2 || '#111'}"></span>`; }
function peopleLine(c) {
  const cul = game.cultures?.[c.culture];
  if (!cul) return '';
  const R = game.players[c.owner].culture;
  const label = game.peopleLabel(c);
  let note = '';
  if (!game.related(cul.id, R)) note = ` — a subject people, ${game.players[c.owner].name} rule. Unrest bites harder until they integrate.`;
  else if (cul.id !== R) note = ` — a regional offshoot of ${esc(game.cultures[game.cultureFamily(cul.id)].name)}. Slightly more sensitive to unrest.`;
  return `<div class="row"><span>People</span><span>${cultureChip(cul)}<b>${esc(label)}</b></span></div>${note ? `<div class="desc">${note}</div>` : ''}`;
}

// Construction costs labor (⚒) from the working city; a shortfall can be hurried with gold.
function workLabel(cost, chk) {
  const w = chk?.work || chk || {};
  if (w.hurried) return `⚒${cost} <span style="color:#f0c040">(hurry ◉${w.gold})</span>`;
  if (w.hurryGold && !w.ok) return `⚒${cost} <span class="dim">(◉${w.hurryGold})</span>`;
  return `⚒${cost}`;
}

function chip(p) { return `<span class="chip" style="background:${p.color};border-color:${p.color2 || '#111'}"></span>`; }

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let toastT = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ------------------------------------------------------------ turn flow
let lastHuman = -1;
function beginTurnUI() {
  if (game.winner) { refreshAll(); return; }
  const pl = game.players[game.current];
  if (!pl.alive) { game.endTurn(); beginTurnUI(); return; }
  if (!pl.human) { runAITurns(); return; }
  const humans = game.players.filter(p => p.human && p.alive).length;
  R.viewer = pl.id;
  game.updateVision(pl.id);
  if (humans > 1 && lastHuman !== pl.id) {
    $('passTitle').textContent = `${pl.name}'s turn`;
    $('passTitle').style.color = pl.color;
    $('pass').classList.remove('hidden');
    $('btnPass').onclick = () => { $('pass').classList.add('hidden'); focusTurn(pl); };
  } else focusTurn(pl);
  lastHuman = pl.id;
  try { localStorage.setItem(SAVE_KEY, game.serialize()); } catch { }
}

function stepGoto(u) {
  if (u.goto == null || u.mvLeft <= 0) return;
  if (u.idx === u.goto) { u.goto = null; return; }
  if (game.zocSet(u.owner).has(u.idx)) { u.goto = null; return; } // enemy adjacent: stop and let the player decide
  const dist = field(game, u.goto, u, new Map());
  const step = bestStep(game, u, dist, false);
  if (step == null) { u.goto = null; return; }
  game.moveUnit(u, step);
  if (u.idx === u.goto) u.goto = null;
}

function forgetOptions(pid) {
  return game.forgettable(pid).map(t => ({ t, up: game.techUpkeepOf(pid, t), use: game.techUse(pid, t) })).sort((a, b) => a.use - b.use || b.up - a.up);
}
function showForget(pl) {
  const opts = forgetOptions(pl.id);
  const left = 3 - (game.turn - pl.mustForget.since);
  let h = `<h2>Learning is in decline</h2><p>Your scholars can't sustain everything ${esc(pl.name)} knows. Choose one technology to let go. Only knowledge nothing else depends on can be dropped. What you've already built keeps working; you just can't make new things that need it. A forgotten tech is cheaper to relearn (50%, or 25% if a trade partner knows it). ${left > 0 ? `If you don't choose within ${left} turn${left > 1 ? 's' : ''}, the least-used one fades on its own.` : ''}</p><div class="opts" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">`;
  for (const o of opts) h += `<button data-forget="${o.t}">${TECHS[o.t].name}<small>saves ${o.up.toFixed(1)} ✦/turn · ${o.use ? 'in use' : 'unused'}</small></button>`;
  h += `</div><p><button id="btnLater">Decide later</button></p>`;
  openModal(h);
  $('modalBody').querySelectorAll('[data-forget]').forEach(b => b.onclick = () => { game.forgetTech(pl.id, b.dataset.forget, true); closeModal(); refreshAll(); setTimeout(() => showOffers(pl), 50); });
  $('btnLater').onclick = () => { closeModal(); setTimeout(() => showOffers(pl), 50); };
}

function showOffers(pl) {
  const o = (game.offers || []).find(x => x.to === pl.id);
  if (!o) return;
  const from = game.players[o.from];
  const what = { peace: 'peace', alliance: 'an alliance', route: 'a trade route', vassal: 'terms: submit as their tributary', protect: 'to become your tributary in exchange for protection' }[o.type];
  let extra = '';
  if (o.type === 'vassal') extra = `<p>You would keep your cities and people, but pay ${Math.round(25)}% of your gold income and your surplus goods as tribute, and follow their wars and peace. Refusing means the war goes on.</p>`;
  if (o.type === 'protect') extra = `<p>They would pay you tribute and follow your wars. You would join their current wars: ${game.warsOf(o.from).map(e => esc(game.players[e].name)).join(', ') || 'none'}.</p>`;
  if (o.type === 'route') {
    const gn = game.routeGain(pl.id, o.from);
    extra = `<p>Right now you could buy about ${gn.buy} and sell about ${gn.sell} units of goods per turn along it. Upkeep and tolls depend on its length and path.</p>`;
  }
  openModal(`<h2>${chip(from)} ${esc(from.name)} offer ${what}</h2>${extra}<p><button class="primary" id="btnAcc">Accept</button> <button id="btnDec">Decline</button></p>`);
  const done = (yes) => { $('btnAcc').onclick = $('btnDec').onclick = null; const r = game.answerOffer(o, yes); if (!r.ok) toast(r.why); closeModal(); refreshAll(); setTimeout(() => showOffers(pl), 50); };
  $('btnAcc').onclick = () => done(true);
  $('btnDec').onclick = () => done(false);
}

function focusTurn(pl) {
  sel = null;
  setTimeout(() => { if (pl.mustForget) showForget(pl); else showOffers(pl); }, 300);
  for (const u of game.units.filter(u => u.owner === pl.id && u.goto != null)) stepGoto(u);
  const cap = game.cities.find(c => c.owner === pl.id && c.capital) || game.cities.find(c => c.owner === pl.id);
  if (game.turn === 1 || !R._centered?.[pl.id]) {
    if (cap) R.centerOn(cap.idx);
    R._centered = R._centered || {}; R._centered[pl.id] = true;
  }
  if (game.turn === 1 && game.players.filter(p => p.human).length >= 1) {
    const home = SPECIALTY[pl.home];
    toast(`You lead the ${pl.name}, a ${home.name} people. Cities on ${home.name.toLowerCase()} land thrive for you.`);
  }
  refreshAll();
}

function runAITurns() {
  busy = true;
  refreshAll();
  const step = () => {
    if (game.winner) { busy = false; refreshAll(); return; }
    const pl = game.players[game.current];
    if (pl.human && pl.alive) { busy = false; beginTurnUI(); return; }
    if (watchMode) R.viewer = pl.id;
    try { runAI(game, pl.id); } catch (e) { console.error('AI error', e); }
    game.endTurn();
    R.dirty = true;
    if (watchMode) updateTopbar();
    setTimeout(step, watchMode ? 120 : 15);
  };
  setTimeout(step, 30);
}

function endTurn() {
  if (busy || !game || game.winner) return;
  if (!game.players[game.current].human) return;
  sel = null; R.highlights.clear(); R.selected = null;
  game.endTurn();
  beginTurnUI();
}

// ------------------------------------------------------------ input
function initInput() {
  const cv = $('map');
  const pointers = new Map();
  let drag = null, pinch = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), size: R.size };
      drag = null;
    } else drag = { x: e.clientX, y: e.clientY, cx: R.camX, cy: R.camY, moved: false, button: e.button };
  });
  cv.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      R.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.size * d / pinch.d) / R.size);
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) { R.camX = drag.cx - dx; R.camY = drag.cy - dy; R.clampCam(); R.dirty = true; }
    } else if (game) {
      const t = R.screenToTile(e.clientX, e.clientY);
      if (t !== R.hover) { R.hover = t; R.hoverLabel = hoverLabel(t); R.dirty = true; }
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && pointers.size === 0) {
      if (drag.button === 2) { deselect(); }
      else onTileClick(R.screenToTile(e.clientX, e.clientY));
    }
    if (pointers.size === 0) drag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { e.preventDefault(); R.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  window.addEventListener('resize', () => { R.resize(); });
  $('minimap').addEventListener('pointerdown', (e) => {
    const r = $('minimap').getBoundingClientRect();
    const [ww, wh] = R.worldSize();
    R.camX = (e.clientX - r.left) / r.width * ww - R.vw / 2;
    R.camY = (e.clientY - r.top) / r.height * wh - R.vh / 2;
    R.clampCam(); R.dirty = true;
  });
  window.addEventListener('keydown', (e) => {
    if (!game || e.target.tagName === 'INPUT') return;
    if (!$('modal').classList.contains('hidden')) { if (e.key === 'Escape') closeModal(); return; }
    const pan = 60;
    if (e.key === 'Enter' || e.key === 'e' || e.key === 'E') endTurn();
    else if (e.key === ' ') { e.preventDefault(); nextUnit(); }
    else if (e.key === 'Escape') deselect();
    else if (e.key === 't' || e.key === 'T') showTech();
    else if (e.key === 'd' || e.key === 'D') showDiplomacy();
    else if (e.key === 'g' || e.key === 'G') showGoods();
    else if (e.key === 'p' || e.key === 'P') showChains();
    else if (e.key === 'l' || e.key === 'L') { $('mapLabels').checked = !$('mapLabels').checked; R.showLabels = $('mapLabels').checked; R.dirty = true; }
    else if (e.key === 'm' || e.key === 'M') { const o = [...$('mapMode').options].map(x => x.value); setMapMode(o[(o.indexOf(R.mapMode) + 1) % o.length]); }
    else if (e.key === 's' || e.key === 'S') { const u = selUnit(); if (u && u.type === 'settler') doSettle(u); }
    else if (e.key === 'ArrowLeft') { R.camX -= pan; R.dirty = true; }
    else if (e.key === 'ArrowRight') { R.camX += pan; R.dirty = true; }
    else if (e.key === 'ArrowUp') { R.camY -= pan; R.dirty = true; }
    else if (e.key === 'ArrowDown') { R.camY += pan; R.dirty = true; }
    else if (e.key === '+' || e.key === '=') R.zoomAt(R.vw / 2, R.vh / 2, 1.15);
    else if (e.key === '-') R.zoomAt(R.vw / 2, R.vh / 2, 1 / 1.15);
  });
  $('btnEnd').onclick = endTurn;
  $('btnNext').onclick = nextUnit;
  $('btnTech').onclick = showTech;
  $('mapMode').onchange = () => setMapMode($('mapMode').value);
  $('mapLabels').onchange = () => { R.showLabels = $('mapLabels').checked; R.dirty = true; };
  $('btnTribes').onclick = showTribes;
  $('btnDiplo').onclick = showDiplomacy;
  $('goodsBar').onclick = showGoods;
  $('knowStat').onclick = showTech;
  $('btnHelp').onclick = showHelp;
  $('btnMenu').onclick = showLeave;
  $('modalClose').onclick = closeModal;
  $('modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
}

function hoverLabel(t) {
  const u = selUnit();
  if (t == null || !u || !myTurn() || u.owner !== R.viewer) return null;
  if (R.highlights.get(t) === 'attack') {
    const d = game.unitAt(t);
    if (!d) return null;
    const { dmg, ret } = game.combatPreview(u, d);
    return dmg >= d.hp ? `Attack: kills ${UNITS[d.type].name}` : `Attack: deal ${dmg} (${d.hp}→${d.hp - dmg})\nTake ${ret}${ret >= u.hp ? ' — DIES' : ''}`;
  }
  if (!R.highlights.has(t) && game.players[R.viewer].explored[t] && t !== u.idx) return 'Click: set move order';
  return null;
}

const LEGENDS = {
  trade: () => GOOD_KEYS.map(k => `<span class="sw" style="background:${STRATEGIC[k].color};border-radius:6px"></span>${STRATEGIC[k].name}`).join('') + '<br><span class="dim">Dots mark producing deposits. Dashed lines are trade routes in both partners\' colours. <b style="color:#ff3a2a">!</b> raided last turn, <b>×</b> blocked.</span>',
  political: () => 'Tribe colours. Stripes: a tributary, striped in its overlord\'s colour. Grey: unclaimed land.',
  culture: () => 'Each colour is a people. Offshoots share a hue family with the people they split from. <b>Solid</b>: a tribe\'s own people or a regional offshoot. <b>Thick stripes</b>: a people (base colour) ruled by another tribe (stripe colour). <b>Thin dark lines</b>: own people on foreign or alien land.',
  specialty: () => Object.values(SPECIALTY).map(s => `<span class="sw" style="background:${s.color}"></span>${s.name}`).join('') + '<br><span class="dim">Unclaimed land is shown dimmed in the type a city founded there would get.</span>',
  unrest: () => [['#4caf50', 'Content'], ['#c8c840', 'Calming'], ['#f09030', 'Restless'], ['#e04030', 'Rioting'], ['#901818', 'Insurrection']].map(([c, n]) => `<span class="sw" style="background:${c}"></span>${n}`).join('') + '<br><span class="dim">Blue lines: subsidies (denser = higher tier). Only your own cities are shown.</span>',
};
function setMapMode(m) {
  R.mapMode = m;
  $('mapMode').value = m;
  const L = LEGENDS[m];
  $('legend').classList.toggle('hidden', !L);
  if (L) $('legend').innerHTML = L();
  R.dirty = true; lastMini = 0;
}

function myTurn() { return game && !busy && !game.winner && game.players[game.current].human && game.current === R.viewer; }
function selUnit() { return sel?.kind === 'unit' ? game.unitById(sel.id) : null; }

function deselect() { sel = null; R.selected = null; R.highlights.clear(); R.gotoMarks = null; R.hoverLabel = null; refreshPanel(); R.dirty = true; }

function onTileClick(i) {
  if (i == null || !game) return;
  const pid = R.viewer;
  const pl = game.players[pid];
  if (!watchMode && !pl.explored[i]) { deselect(); return; }
  const u = selUnit();
  if (u && myTurn() && u.owner === pid) {
    const h = R.highlights.get(i);
    if (h === 'attack') {
      const res = game.attack(u, i);
      afterAction(u, res);
      return;
    }
    if (h === 'move' || h === 'capture') {
      u.goto = null;
      const res = game.moveUnit(u, i);
      afterAction(u, res);
      return;
    }
    if (!h && i !== u.idx && !game.unitAt(i) && sel.kind === 'unit') {
      const dist = field(game, i, u, new Map());
      if (dist[u.idx] !== Infinity) {
        u.goto = i;
        stepGoto(u);
        toast('Move order set — the unit will continue next turns');
        afterAction(u, { ok: true });
        return;
      }
      toast('No path there');
    }
  }
  // selection cycling: unit -> city -> tile
  const unit = game.unitAt(i);
  const city = game.cityAt(i);
  const unitVisible = unit && (watchMode || (game.visibleTo(pid, i) && !game.isHiddenFrom(unit, pid)));
  if (sel && sel.idx === i) {
    if (sel.kind === 'unit' && city) return select({ kind: 'city', id: city.id, idx: i });
    if (sel.kind === 'unit' || sel.kind === 'city') return select({ kind: 'tile', idx: i });
    if (sel.kind === 'tile' && unitVisible) return select({ kind: 'unit', id: unit.id, idx: i });
    if (sel.kind === 'tile' && city) return select({ kind: 'city', id: city.id, idx: i });
  }
  if (unitVisible) return select({ kind: 'unit', id: unit.id, idx: i });
  if (city) return select({ kind: 'city', id: city.id, idx: i });
  select({ kind: 'tile', idx: i });
}

function afterAction(u, res) {
  if (!res.ok) { toast(res.why || 'Not possible'); return; }
  // units that are done for the turn are deselected automatically
  const spent = game.units.includes(u) && u.mvLeft <= 0 && game.attackTargets(u).length === 0 && !(u.type === 'settler' && game.canSettle(u).ok);
  if (game.units.includes(u) && !spent) select({ kind: 'unit', id: u.id, idx: u.idx });
  else deselect();
  refreshAll();
  if (game.winner) showWin();
}

function select(s) {
  sel = s;
  R.selected = s.idx;
  R.highlights.clear();
  if (s.kind === 'unit') {
    const u = game.unitById(s.id);
    if (u && u.owner === R.viewer && myTurn()) {
      for (const [i] of game.reachable(u)) {
        const c = game.cityAt(i);
        R.highlights.set(i, c && c.owner !== u.owner ? 'capture' : 'move');
      }
      for (const t of game.attackTargets(u)) R.highlights.set(t, 'attack');
      if (u.type === 'settler') {
        for (const t of game.within(u.idx, 4)) if (!R.highlights.has(t) && game.players[u.owner].explored[t] && game.canFoundAt(u.owner, t).ok) R.highlights.set(t, 'site');
      }
    }
  }
  R.gotoMarks = null;
  if (s.kind === 'unit') { const u = game.unitById(s.id); if (u && u.goto != null) R.gotoMarks = [u.goto]; }
  refreshPanel();
  R.dirty = true;
}

function nextUnit() {
  if (!myTurn()) return;
  const mine = game.units.filter(u => u.owner === R.viewer && u.goto == null && (u.mvLeft > 0 || game.attackTargets(u).length > 0));
  if (!mine.length) { toast('All units have acted'); return; }
  const cur = selUnit();
  let k = cur ? mine.indexOf(cur) + 1 : 0;
  const u = mine[k % mine.length];
  R.centerOn(u.idx);
  select({ kind: 'unit', id: u.id, idx: u.idx });
}

function doSettle(u) {
  const r = game.settle(u);
  if (!r.ok) { toast(r.why); return; }
  select({ kind: 'city', id: r.city.id, idx: r.city.idx });
  refreshAll();
}

// ------------------------------------------------------------ panels
function refreshAll() { updateTopbar(); refreshPanel(); R.dirty = true; }

function goodsBarHTML(pid) {
  const pl = game.players[pid];
  const st = game.stock(pid), prod = pl.lastProd || game.production(pid), need = game.supplyNeed(pid), un = pl.unsupplied || {};
  return GOOD_KEYS.filter(k => st[k] || prod[k] || pl.lastMade?.[k] || game.goodDemand(pid, k) || un[k]).map(k => {
    const ate = k === 'food' ? (pl.lastEaten || 0) : (pl.lastLux?.[k] || 0);
    const net = (prod[k] || 0) + (pl.lastMade?.[k] || 0) - (pl.lastUsed?.[k] || 0) - (need[k] || 0) - ate;
    return `<span class="g ${un[k] ? 'short' : ''}" title="${STRATEGIC[k].name}: ${st[k]} in stock, ${net >= 0 ? '+' : ''}${net} per turn"><i style="background:${STRATEGIC[k].color}"></i>${STRATEGIC[k].short} <b>${st[k]}</b><span class="dim">${net >= 0 ? '+' : ''}${net}</span></span>`;
  }).join('');
}

function updateTopbar() {
  const pl = game.players[R.viewer];
  $('goodsBar').innerHTML = goodsBarHTML(pl.id);
  $('know').textContent = Math.floor(pl.knowledge || 0);
  const kNet = (pl.lastKnowledge ?? game.knowledgeRate(pl.id).total) - game.techUpkeep(pl.id);
  $('knowRate').textContent = `(${kNet >= 0 ? '+' : ''}${kNet.toFixed(1)}${pl.decline > 0 ? `, decline ${Math.round(pl.decline)}/10` : ''}${pl.darkAge ? ', DARK AGE' : ''})`;
  $('knowRate').style.color = pl.darkAge || pl.decline > 0 ? '#ff8a70' : '';
  $('tribeChip').style.background = pl.color;
  $('tribeChip').style.borderColor = pl.color2 || '#111';
  $('tribeName').textContent = pl.name;
  $('tribeHome').textContent = SPECIALTY[pl.home].name + ' people';
  $('tribeHome').style.background = SPECIALTY[pl.home].color;
  $('tribeHome').style.color = '#111';
  $('gold').textContent = pl.gold;
  const up = game.upkeep(pl.id);
  const sub = game.subsidyCost(pl.id), inc = game.income(pl.id);
  $('income').textContent = `(${inc >= 0 ? '+' : ''}${inc}${up ? `, upkeep ${up}` : ''}${sub ? `, subsidies ${sub}` : ''})`;
  $('turn').textContent = game.turn;
  $('turnLimit').textContent = game.settings.turnLimit ? ` / ${game.settings.turnLimit}` : '';
  $('score').textContent = game.score(pl.id);
  $('ucount').textContent = `${game.unitCount(pl.id)}/${game.unitCap(pl.id)}`;
  const mine = myTurn();
  $('btnEnd').disabled = !mine;
  $('btnEnd').textContent = busy ? 'Other tribes moving…' : game.winner ? 'Game over' : 'End Turn';
  const idle = mine && game.units.some(u => u.owner === R.viewer && (u.mvLeft > 0 && !u.acted));
  $('btnEnd').classList.toggle('ready', mine && !idle);
}

function affBadge(a) { const A = AFFINITY[a]; return `<span class="aff" style="background:${A.color}">${A.name}</span>`; }

function refreshPanel() {
  const P = $('panel');
  if (!sel || !game) { P.classList.add('hidden'); return; }
  P.classList.remove('hidden');
  let html = '';
  if (sel.kind === 'unit') {
    const u = game.unitById(sel.id);
    if (!u) { P.classList.add('hidden'); return; }
    html = unitPanel(u);
  } else if (sel.kind === 'city') {
    const c = game.cityById(sel.id);
    if (!c) { P.classList.add('hidden'); return; }
    html = cityPanel(c);
  } else html = tilePanel(sel.idx);
  P.innerHTML = html;
  P.querySelectorAll('[data-act]').forEach(b => b.onclick = () => panelAction(b.dataset));
}

function unitPanel(u) {
  const U = UNITS[u.type];
  const S = game.stats(u);
  const pl = game.players[u.owner];
  let h = `<h3 style="color:${pl.color}">${U.name}${u.vet ? ' ★' : ''}${game.embarked(u) ? ' (embarked)' : ''}</h3>`;
  h += `<div class="dim">${esc(pl.name)}</div>`;
  h += `<div class="statline">HP ${u.hp}/${game.maxHp(u)} · ATK ${S.atk} · DEF ${S.def} · MV ${S.mv} · RNG ${S.rng}</div>`;
  if (U.needs) h += `<div class="desc">Supply: ${Object.keys(U.needs).map(k => goodName(k).toLowerCase()).join(' & ')} (every ${4} such units use 1 per turn).${game.unsupplied(u) ? ' <b style="color:#ff8060">Unsupplied: −25% attack, −15% defense, no healing.</b>' : ''}</div>`;
  const traits = (U.traits || []).filter(t => t !== 'settler');
  if (traits.length) h += `<div class="desc">Traits: ${traits.map(traitName).join(', ')}</div>`;
  if (U.unique) h += `<div class="desc">Unique to ${SPECIALTY[U.unique].name} cities.</div>`;
  if (u.owner === R.viewer && myTurn()) {
    h += `<div class="desc">Moves left: ${u.mvLeft} ${u.attacked ? '· has attacked' : ''}</div>`;
    if (u.type === 'settler') {
      const chk = game.canSettle(u);
      const spec = game.specialtyAt(u.idx);
      const kd = Math.min(3, KIN_DIST[pl.home][spec]);
      h += `<h4>Found city here</h4><div class="desc">Would become a <b>${SPECIALTY[spec].name}</b> city (${SPECIALTY[spec].title}) — ${affBadge(kd)}<br>${SPECIALTY[spec].desc}</div>`;
      h += `<button class="primary" data-act="settle" ${chk.ok ? '' : 'disabled'}>Found city <kbd>S</kbd></button> ${chk.ok ? '' : `<span class="dim">${esc(chk.why)}</span>`}`;
      h += `<div class="desc">Green dashed hexes nearby are valid sites.</div>`;
    }
    const ups = game.upgradeOptions(u);
    if (ups.length) {
      h += `<h4>Upgrade</h4><div class="opts">`;
      for (const to of ups) {
        const chk = game.canUpgrade(u, to);
        const T = UNITS[to];
        h += `<button data-act="upgrade" data-k="${to}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${T.name} ${workLabel(game.upgradeCost(u, to), chk)}<small>${T.atk}/${T.def} hp${T.hp}${T.needs ? ` <span class="needs">· ${game.goodsText(T.needs)}</span>` : ''}${chk.ok ? '' : ' · ' + esc(chk.why)}</small></button>`;
      }
      h += `</div>`;
    }
    h += `<div style="margin-top:10px"><button data-act="disband">Disband</button>${u.goto != null ? ' <button data-act="cancelgoto">Cancel move order</button>' : ''}</div>`;
  }
  // combat preview against hovered enemy handled by tooltip; show tile info too
  h += tileSummary(u.idx);
  return h;
}

function traitName(t) {
  return ({ mounted: 'Mounted', skirmish: 'Skirmisher (moves after attacking)', forestwalk: 'Forest-walker (+40% atk from forest)', marshwalk: 'Marsh-walker', desertwalk: 'Dune-runner', mountainwalk: 'Mountaineer', hillwalk: 'Hill-walker', stealth: 'Hidden in marsh (+40% ambush)', naval: 'Naval', antimount: 'Anti-cavalry (x2 def vs mounted)' })[t] || t;
}

function cityPanel(c) {
  const pl = game.players[c.owner];
  const spec = SPECIALTY[c.specialty];
  const mine = c.owner === R.viewer;
  const aff = game.affinity(c);
  let h = `<h3 style="color:${pl.color}">${esc(c.name)}${c.capital ? ' ★' : ''}</h3>`;
  h += `<div class="dim">${esc(pl.name)} · Level ${c.level} · pop ${c.pop}/${c.level + 1}</div>`;
  h += `<div class="desc"><span class="aff" style="background:${spec.color}">${spec.name}</span> <b>${spec.title}</b> — ${spec.desc}</div>`;
  if (mine || watchMode) {
    h += `<div class="row"><span>Culture</span>${affBadge(aff)}</div>`;
    const A = AFFINITY[aff];
    const base = KIN_DIST[pl.home][c.specialty];
    let affNote = aff === 0 ? 'Your people\'s homeland: +1 gold, cheaper unique units.' :
      aff === 1 ? 'Familiar land. No penalties.' :
        `${A.gold} gold, unique units +${A.unitCost} cost${aff >= 3 ? ', cannot build specialty building' : ''}.`;
    if (base >= 2 && aff > 1) {
      const need = c.buildings.includes('temple') ? 5 : 10;
      affNote += ` Integrates in ${need - (c.held % need)} turns.`;
    }
    h += `<div class="desc">${affNote}</div>`;
    h += `<div class="row"><span>Labor</span><span><b>⚒ ${Math.floor(c.labor || 0)}</b>/${game.laborCap(c)} <span class="dim">+${game.laborRate(c)}/turn${c.hunger > 0.3 ? ' (halved by hunger)' : ''}</span></span></div>`;
    h += `<div class="row"><span>Income</span><b>+${game.cityIncome(c)} gold</b></div>`;
    const fd = game.foodDemand(c);
    if (fd) h += `<div class="row"><span>Food</span><span>eats ${fd}/turn${c.hunger > 0 ? ` · <b style="color:${c.hunger > 0.3 ? '#ff7050' : '#e0c050'}">${Math.round(c.hunger * 100)}% unfed${c.hunger > 0.3 ? ', not growing' : ''}</b>` : ' · fed'}</span></div>`;
    if (c.level >= 4) h += `<div class="row"><span>Luxuries</span><span>${c.lux?.length ? c.lux.map(k => STRATEGIC[k].name).join(', ') : '<span class="dim">none</span>'}</span></div>`;
    const cp = game.cityProduction(c);
    if (Object.keys(cp).length) h += `<div class="row"><span>Goods</span><span>${Object.entries(cp).map(([k, n]) => `+${n} ${STRATEGIC[k].name.toLowerCase()}`).join(', ')}</span></div>`;
    if (!game.isConnected(c)) h += `<div class="desc" style="color:#ff9a60"><b>Cut off from the capital.</b> Its goods can't reach your stockpile, and it can't use the stockpile to train or build. Clear the enemies or hostile land between them.</div>`;
    const occ = game.occupation(c);
    if (occ.lost) h += `<div class="desc" style="color:#ff8a70">${occ.lost} worked tile${occ.lost > 1 ? 's are' : ' is'} occupied or damaged: −${occ.lost} gold.${occ.occupied ? ' Enemies on your land also raise unrest and may pillage.' : ''}</div>`;
    h += peopleLine(c);
    h += moodBlock(c, mine && myTurn());
  }
  if (mine && myTurn()) {
    const wd = game.worksDone(c);
    h += `<h4>Train${wd ? ` <span class="dim">(${wd} project${wd > 1 ? 's' : ''} done here this turn: hurrying costs ×${game.hurryMult(c)})</span>` : ''}</h4><div class="opts">`;
    for (const k of game.trainable(c)) {
      const U = UNITS[k];
      const chk = game.canTrain(c, k);
      const cost = game.unitCost(c, k);
      h += `<button data-act="train" data-k="${k}" class="${U.unique ? 'unique' : ''}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${U.name} ${workLabel(cost, chk)}<small>${U.atk}/${U.def} hp${U.hp} mv${U.mv}${U.rng > 1 ? ' r' + U.rng : ''}${U.needs ? ` <span class="needs">· ${game.goodsText(U.needs)}</span>` : ''}</small></button>`;
    }
    h += `</div>`;
    const lockedUnique = SPECIALTY[c.specialty].unit;
    if (!game.trainable(c).includes(lockedUnique)) h += `<div class="desc">Unique: ${UNITS[lockedUnique].name} — needs ${TECHS[UNITS[lockedUnique].tech]?.name}.</div>`;
    h += `<h4>Buildings</h4><div class="opts">`;
    for (const b of game.buildable(c)) {
      const B = BUILDINGS[b];
      const chk = game.canBuild(c, b);
      h += `<button data-act="build" data-k="${b}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${B.name} ${workLabel(B.cost, chk)}${B.needs ? ` <span class="needs">+ ${game.goodsText(B.needs)}</span>` : ''}<small>${B.desc}</small></button>`;
    }
    h += `</div>`;
    const ws = Object.keys(WONDERS).filter(w => WONDERS[w].special === c.specialty);
    for (const w of ws) {
      const W = WONDERS[w];
      const chk = game.canBuildWonder(c, w);
      const owner = game.wonderOwner(w);
      h += `<h4>Wonder</h4><button data-act="wonder" data-k="${w}" ${chk.ok ? '' : 'disabled'} style="width:100%;text-align:left">${W.name} ${workLabel(W.cost, chk)}${W.needs ? ` <span class="needs">+ ${game.goodsText(W.needs)}</span>` : ''}<br><small>${W.desc}${chk.ok ? '' : ' — ' + esc(chk.why)}</small></button>`;
    }
    // repeatable projects
    const plan = game.roadPlan(c);
    const sc = game.canScholars(c), dr = game.canDrill(c), pg = game.canPlacate(c, 'labor');
    h += `<h4>Projects</h4><div class="opts">`;
    h += `<button data-act="extendroads" ${plan ? '' : 'disabled'} title="${plan ? '' : 'Joined by road to its neighbours'}">Extend roads ${plan ? workLabel(game.roadCost(plan.next), game.canBuildRoad(c.owner, plan.next)) : ''}<small>${plan ? `toward ${esc(plan.target.name)}, ${plan.left} tile${plan.left > 1 ? 's' : ''} to go` : 'connected to nearby cities'}</small></button>`;
    h += `<button data-act="scholars" ${sc.ok ? '' : 'disabled'} title="${esc(sc.why || '')}">Scholars ⚒${sc.labor || 4}<small>turn labor into ${sc.gain || 1} knowledge (4 : 1)</small></button>`;
    h += `<button data-act="games" ${pg.ok ? '' : 'disabled'} title="${esc(pg.why || '')}">Public games ${workLabel(game.placateCost(c), pg.work || pg)}<small>a festival paid in labor (${Math.round(game.festivalRisk(c) * 100)}% riot risk)</small></button>`;
    h += `<button data-act="drill" ${dr.ok ? '' : 'disabled'} title="${esc(dr.why || '')}">Drill garrison ${workLabel(8, dr)}<small>the unit here becomes a veteran</small></button>`;
    h += `</div>`;
    h += grandBlock(c);
    if (c.buildings.length) h += `<div class="desc">Built: ${c.buildings.map(b => BUILDINGS[b].name).join(', ')}</div>`;
    if (c.wonders?.length) h += `<div class="desc">Wonders: <b>${c.wonders.map(w => WONDERS[w].name).join(', ')}</b></div>`;
    // workable tiles summary
    const work = [];
    for (const t of game.cityTiles(c)) for (const k of game.improvementsFor(c.owner, t)) work.push(k);
    if (work.length) h += `<div class="desc">Tip: click tiles in this city's border to build improvements (${[...new Set(work)].map(k => IMPROVEMENTS[k].name).join(', ')}).</div>`;
  } else if (c.buildings.length) h += `<div class="desc">Buildings: ${c.buildings.map(b => BUILDINGS[b].name).join(', ')}</div>`;
  return h;
}

// Grand projects: once per tribe, begun at a site, fed by every connected city's labor
function grandBlock(c) {
  const pid = c.owner;
  let h = '';
  const rows = [];
  for (const [k, G] of Object.entries(GRAND)) {
    const gp = game.players[pid].grandWork?.[k];
    const here = c.grand?.includes(k);
    if (here) { rows.push(`<div class="desc"><b>${G.name}</b> stands here. <small>${G.desc}</small></div>`); continue; }
    if (game.hasGrand(pid, k)) continue;
    if (gp && game.cityById(gp.site)?.owner === pid) {
      const site = game.cityById(gp.site), chk = game.canContribute(c, k);
      const pct = Math.round(gp.progress / G.labor * 100);
      rows.push(`<button data-act="grandgive" data-k="${k}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${G.name} at ${esc(site.name)}: ${gp.progress}/${G.labor} ⚒<div style="height:5px;background:#2a3646;border-radius:3px;margin:3px 0"><div style="height:5px;width:${pct}%;background:#f0c060;border-radius:3px"></div></div><small>Give up to ${Math.min(Math.floor(c.labor || 0), game.grandRoom(gp, site))} of this city's labor (the site takes ${game.grandIntake(site)} a turn). ${G.desc}</small></button>`);
      continue;
    }
    if (!game.has(pid, G.tech)) continue;
    const chk = game.canStartGrand(c, k);
    rows.push(`<button data-act="grandstart" data-k="${k}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">Begin ${G.name} ⚒${G.labor} <span class="needs">+ ${game.goodsText(G.needs)}</span><small>${G.desc} Goods paid now; connected cities give labor. Whoever holds this city holds it.</small></button>`);
  }
  if (rows.length) h += `<h4>Grand projects</h4><div class="opts">${rows.join('')}</div>`;
  return h;
}

function moodBlock(c, canAct) {
  const un = game.unrest(c);
  const cur = c.unrest || 0;
  const STATES = {
    insurrection: ['Insurrection', '#ff3030', `Rioting, and insurgents may take up arms nearby. Revolt at ${REVOLT_AT}.`],
    rioting: ['Rioting', '#ff6040', 'No training or construction except compliance buildings. Riots spread +1 pressure to your cities within 3 tiles.'],
    restless: ['Restless', '#ffa040', ''],
    calming: ['Calming', '#e0d060', ''],
    content: ['Content', '#7ddc6a', ''],
  };
  const state = STATES[game.moodState(c)];
  let h = `<h4>Mood</h4><div class="row"><span><span class="aff" style="background:${state[1]}">${state[0]}</span></span><span>unrest ${cur}/${REVOLT_AT} ${un.net > 0 ? `<b style="color:#ff8060">+${un.net}/turn</b>` : un.net < 0 || cur ? `<span class="dim">−${Math.max(1, -un.net)}/turn</span>` : ''}</span></div>`;
  h += `<div style="height:6px;background:#2a3646;border-radius:3px;margin:4px 0"><div style="height:6px;width:${Math.min(100, cur / REVOLT_AT * 100)}%;background:${state[1]};border-radius:3px"></div></div>`;
  const fmt = (arr, sign) => arr.map(([n, v]) => `${esc(n)} ${v < 0 ? (sign === '+' ? '−' : '+') : sign}${Math.abs(v)}`).join(', ');
  if (un.pressure.length) h += `<div class="desc">Pressure: ${fmt(un.pressure, '+')}</div>`;
  if (un.calm.length) h += `<div class="desc">Compliance: ${fmt(un.calm, '−')}</div>`;
  if (state[2]) h += `<div class="desc"><b>${state[0]}:</b> ${state[2]}</div>`;
  if (un.net > 0) h += `<div class="desc">Restless: withholds ${un.net} gold per turn. Riots at ${RIOT_AT}, insurrection at ${INSURRECTION_AT}, revolt at ${REVOLT_AT}${c.capital ? ' (capitals never revolt)' : ''}.</div>`;
  if (canAct && (un.net > 0 || cur > 0 || c.subsidy)) {
    const chk = game.canPlacate(c);
    const risk = Math.round(game.festivalRisk(c) * 100);
    h += `<div class="opts" style="margin-top:6px"><button data-act="placate" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">Hold festival ◉${game.placateCost(c)}<small>Resets unrest, −2 for 5 turns. <b style="color:${risk >= 30 ? '#ff8060' : '#e0d060'}">${risk}% riot risk</b></small></button>`;
    h += `</div><h4>Subsidy</h4><div class="opts">`;
    SUBSIDIES.forEach((S, k) => {
      const cur = (c.subsidy || 0) === k;
      h += `<button data-act="subsidy" data-k="${k}" style="${cur ? 'border-color:#f0c060;background:#3a3420' : ''}">${S.name}${cur ? ' ✓' : ''}<small>${k ? `−${S.calm} pressure` : 'No calm bought'}${S.cost ? `, ${S.cost} gold/turn` : ''}${k ? ', no taxes' : ''}</small></button>`;
    });
    if (c.festivals) h += `<div class="desc">${c.festivals} recent festival${c.festivals > 1 ? 's' : ''} without lasting peace: each makes the next likelier to backfire (+3 unrest and +2 pressure for 4 turns). Trust returns after 6 content turns, and each compliance building restores 2 festivals' worth.</div>`;
    h += `</div>`;
  } else if (c.subsidy) h += `<div class="desc">${SUBSIDIES[c.subsidy].name} in effect.</div>`;
  return h;
}

function tileSummary(i) {
  const tl = game.tiles[i];
  const T = TERRAIN[tl.t];
  let h = `<h4>Tile</h4><div class="row"><span>${T.name}${tl.river ? ' + River' : ''}</span><span class="dim">def x${T.def}</span></div>`;
  if (tl.res) h += `<div class="row"><span>Resource</span><span>${RESOURCES[tl.res].name}</span></div>`;
  if (tl.imp) h += `<div class="row"><span>Improvement</span><span>${IMPROVEMENTS[tl.imp].name}</span></div>`;
  if (tl.ruin) h += `<div class="desc">Ancient ruins — move a unit here to explore.</div>`;
  if (tl.owner >= 0) h += `<div class="row"><span>Territory</span><span style="color:${game.players[tl.owner].color}">${esc(game.players[tl.owner].name)}</span></div>`;
  return h;
}

function tilePanel(i) {
  const pid = R.viewer;
  const tl = game.tiles[i];
  let h = `<h3>${TERRAIN[tl.t].name}</h3>` + tileSummary(i);
  if (!TERRAIN[tl.t].water && tl.city < 0) {
    const spec = game.specialtyAt(i);
    const kd = Math.min(3, KIN_DIST[game.players[pid].home][spec]);
    h += `<div class="desc">A city here would be <b>${SPECIALTY[spec].name}</b> ${affBadge(kd)}</div>`;
  }
  if (myTurn() && !TERRAIN[tl.t].water && !game.isRoad(i) && (tl.owner === pid || tl.owner < 0)) {
    const chk = game.canBuildRoad(pid, i);
    if (chk.ok || tl.owner === pid) h += `<h4>Road</h4><button data-act="road" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">Build road ${workLabel(game.roadCost(i), chk)}<small>${chk.ok ? `paid by ${esc(chk.city.name)}; road-to-road moves cost ½ for anyone, and trade routes along roads are cheaper` : esc(chk.why)}</small></button>`;
  } else if (game.tiles[i].road) h += `<div class="desc">A road runs here.</div>`;
  if (tl.damaged) {
    h += `<div class="desc" style="color:#ff8a70">This ${IMPROVEMENTS[tl.imp].name} is damaged and yields nothing. Another round of pillage will destroy it, and the city will lose the pop it gave.</div>`;
    if (tl.owner === pid && myTurn()) {
      const chk = game.canRepair(pid, i);
      h += `<button data-act="repair" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">Repair ${workLabel(game.repairCost(i), chk)}</button>`;
    }
  }
  if (tl.owner === pid && myTurn()) {
    const opts = game.improvementsFor(pid, i);
    if (opts.length) {
      h += `<h4>Improve</h4><div class="opts">`;
      for (const k of opts) {
        const I = IMPROVEMENTS[k];
        const chk = game.canImprove(pid, i, k);
        h += `<button data-act="improve" data-k="${k}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${I.name} ${workLabel(I.cost, chk)}<small>+${game.improvePop(i, k)} pop${impYield(k, game.tiles[i].res) ? `, +1 ${STRATEGIC[impYield(k, game.tiles[i].res)].name.toLowerCase()}/turn` : ''}${I.tech && !game.has(pid, I.tech) ? ' · needs ' + TECHS[I.tech].name : ''}</small></button>`;
      }
      h += `</div>`;
    }
  }
  return h;
}

function panelAction(d) {
  if (!myTurn()) return;
  let res = { ok: true };
  if (d.act === 'settle') { doSettle(selUnit()); return; }
  if (d.act === 'disband') { const u = selUnit(); if (u && confirm('Disband this unit?')) { game.disband(u); deselect(); refreshAll(); } return; }
  if (d.act === 'road') { const r = game.buildRoad(R.viewer, sel.idx); if (!r.ok) toast(r.why); refreshAll(); return; }
  if (d.act === 'extendroads') { const r = game.extendRoads(game.cityById(sel.id)); if (!r.ok) toast(r.why); refreshAll(); return; }
  if (d.act === 'scholars') { const r = game.scholars(game.cityById(sel.id)); toast(r.ok ? `+${r.gain} knowledge` : r.why); refreshAll(); return; }
  if (d.act === 'grandstart') { const r = game.startGrand(game.cityById(sel.id), d.k); if (!r.ok) toast(r.why); refreshAll(); return; }
  if (d.act === 'grandgive') { const r = game.contribute(game.cityById(sel.id), d.k); toast(r.ok ? `${r.given} labor given` : r.why); refreshAll(); return; }
  if (d.act === 'drill') { const r = game.drill(game.cityById(sel.id)); if (!r.ok) toast(r.why); refreshAll(); return; }
  if (d.act === 'games') { const r = game.placate(game.cityById(sel.id), 'labor'); toast(r.ok ? (r.backfired ? 'The games turned into a riot!' : 'Public games held: unrest quelled') : r.why); refreshAll(); return; }
  if (d.act === 'upgrade') { const u = selUnit(); const r = game.upgrade(u, d.k); if (!r.ok) toast(r.why); else select({ kind: 'unit', id: u.id, idx: u.idx }); refreshAll(); return; }
  if (d.act === 'cancelgoto') { const u = selUnit(); if (u) u.goto = null; select(sel); return; }
  if (d.act === 'train') {
    const c = game.cityById(sel.id);
    res = game.train(c, d.k);
  } else if (d.act === 'build') {
    res = game.build(game.cityById(sel.id), d.k);
  } else if (d.act === 'placate') {
    res = game.placate(game.cityById(sel.id));
    if (res.ok) toast(res.backfired ? 'The festival turned into a riot!' : 'Festival held: unrest quelled');
  } else if (d.act === 'repair') {
    res = game.repair(R.viewer, sel.idx);
  } else if (d.act === 'subsidy') {
    res = game.setSubsidy(game.cityById(sel.id), +d.k);
  } else if (d.act === 'wonder') {
    res = game.buildWonder(game.cityById(sel.id), d.k);
  } else if (d.act === 'improve') {
    res = game.improve(R.viewer, sel.idx, d.k);
  }
  if (!res.ok) toast(res.why);
  refreshAll();
}

// ------------------------------------------------------------ modals
function openModal(html) { $('modalBody').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }

function showTech() {
  if (!game) return;
  const pid = R.viewer;
  const pl = game.players[pid];
  const kr = game.knowledgeRate(pid);
  let h = `<h2>Technology <span class="dim">— ✦ ${Math.floor(pl.knowledge || 0)} knowledge, +${kr.total.toFixed(1)}/turn. Costs grow with tier and with your number of cities.</span></h2>`;
  if (game.upkeepOn()) {
    const up = game.techUpkeep(pid);
    h += `<p class="dim">Upkeep: <b>−${up.toFixed(1)} ✦/turn</b> for what you know (tiers cost 1/2/3/4; halved if a trade partner, vassal or overlord knows the tech, −25% more if any tribe at peace with you does). Stock is capped at ${Math.floor(game.knowledgeCap(pid))}. When it runs dry, <b>decline</b> builds${pl.decline ? ` (now ${Math.round(pl.decline)}/10)` : ''}; at 10 a technology is lost.${pl.darkAge ? ` <b style="color:#ff8a70">${esc(pl.name)} is in a Dark Age (since turn ${pl.darkAge.since}).</b>` : ''}</p>`;
  }
  h += `<p class="dim">Knowledge comes from: ${kr.parts.map(([n, v]) => `${esc(n)} ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`).join(', ') || 'nothing yet'}. Research no longer costs gold. Trade routes carry ideas, more so between unrelated peoples.</p><div class="techtree">`;
  for (let tier = 1; tier <= 4; tier++) {
    h += `<div class="col"><h4>Tier ${tier}</h4>`;
    for (const [k, T] of Object.entries(TECHS)) {
      if (T.tier !== tier) continue;
      const known = pl.techs.includes(k);
      const avail = !known && T.req.every(r => pl.techs.includes(r));
      const cost = game.techPrice(pid, k);
      h += `<div class="tech ${known ? 'known' : avail ? 'avail' : 'locked'}" data-tech="${k}"><b>${T.name}</b>${known ? ` ✓${game.upkeepOn() ? ` <span class="dim">−${game.techUpkeepOf(pid, k).toFixed(1)}/turn</span>${game.forgettable(pid).includes(k) ? ` <button data-forgetk="${k}" style="padding:0 5px;font-size:11px;float:right">Forget</button>` : ''}` : ''}` : `<span class="cost">✦${cost}</span>${pl.forgotten?.includes(k) ? ' <span class="dim">(forgotten)</span>' : ''}`}<br>${T.desc}${T.req.length ? `<br><span class="dim">needs ${T.req.map(r => TECHS[r].name).join(', ')}</span>` : ''}</div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;
  openModal(h);
  $('modalBody').querySelectorAll('[data-forgetk]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (!myTurn()) return;
    if (!confirm(`Let the knowledge of ${TECHS[b.dataset.forgetk].name} fade to save upkeep?`)) return;
    const r = game.forgetTech(pid, b.dataset.forgetk); if (!r.ok) toast(r.why); refreshAll(); showTech();
  });
  $('modalBody').querySelectorAll('.tech.avail').forEach(el => el.onclick = () => {
    if (!myTurn()) { toast('Not your turn'); return; }
    const r = game.research(pid, el.dataset.tech);
    if (!r.ok) toast(r.why);
    else { toast('Learned ' + TECHS[el.dataset.tech].name); refreshAll(); showTech(); }
  });
}

let tribeSort = { key: 'score', dir: -1 };
const TRIBE_COLS = [
  { key: 'name', label: 'Tribe', val: (p) => p.name, txt: true },
  { key: 'home', label: 'Homeland', val: (p) => p.home || '', txt: true },
  { key: 'temper', label: 'Temperament', val: (p) => p.temper?.key || '', txt: true },
  { key: 'cities', label: 'Cities', val: (p) => game.cities.filter(c => c.owner === p.id).length },
  { key: 'peak', label: 'Peak', val: (p) => p.peak || 0 },
  { key: 'founded', label: 'Founded', val: (p) => p.founded ?? 1 },
  { key: 'fell', label: 'Fell', val: (p) => p.fell ?? Infinity },
  { key: 'score', label: 'Score', val: (p) => p.alive ? game.score(p.id) : -1 },
  { key: 'techs', label: 'Techs', val: (p) => p.techs.length },
  { key: 'kills', label: 'Kills', val: (p) => p.kills },
];

function showTribes() {
  const viewer = game.players[R.viewer];
  const isMet = (p) => watchMode || p.id === viewer.id || game.cities.some(c => c.owner === p.id && viewer.explored[c.idx]) || !p.alive && p.metBy?.includes(viewer.id);
  for (const p of game.players) if (p.alive && isMet(p)) { p.metBy = p.metBy || []; if (!p.metBy.includes(viewer.id)) p.metBy.push(viewer.id); }
  const rows = game.players.filter(p => !p.rebel || p.heldCity);
  const col = TRIBE_COLS.find(c => c.key === tribeSort.key) || TRIBE_COLS[7];
  rows.sort((a, b) => {
    const ma = isMet(a), mb = isMet(b);
    if (ma !== mb) return ma ? -1 : 1; // unknown tribes last
    const va = col.val(a), vb = col.val(b);
    const c = col.txt ? String(va).localeCompare(String(vb)) : (va === vb ? 0 : va < vb ? -1 : 1);
    return c * tribeSort.dir;
  });
  let h = `<h2>Tribes <button id="btnHisto" style="float:right;margin-right:40px;font-size:13px">Histomap</button></h2><p class="dim">Click a column to sort.</p><table class="tribes"><tr><th></th>`;
  for (const c of TRIBE_COLS) h += `<th class="sortable ${c.key === tribeSort.key ? 'sorted' : ''}" data-sort="${c.key}">${c.label}${c.key === tribeSort.key ? (tribeSort.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`;
  h += `</tr>`;
  for (const p of rows) {
    const met = isMet(p);
    const cs = game.cities.filter(c => c.owner === p.id).length;
    const T = p.temper;
    let temper = p.human ? '—' : met && T ? `<span title="${esc(TEMPERAMENTS[T.key].desc)}">${TEMPERAMENTS[T.key].name}</span>` : '?';
    if (met && T && p.alive) {
      if (T.joined >= 0) temper += ` <span class="tag" style="background:${game.players[T.joined].color};color:#111">vs ${esc(game.players[T.joined].name)}</span>`;
      if ((T.grudges[viewer.id] || 0) >= 15) temper += ` <span class="tag" style="background:#803030">grudge vs you</span>`;
    }
    let homeName = p.home ? SPECIALTY[p.home].name : '—';
    if (p.rebel && p.rebelFrom != null) homeName += ` <span class="dim">(rose against ${esc(game.players[p.rebelFrom].name)})</span>`;
    const q = (v) => met ? v : '?';
    h += `<tr style="opacity:${p.alive ? 1 : 0.45}"><td>${chip(p)}</td><td>${met ? esc(p.name) : '<i>Unknown tribe</i>'}${p.human ? ' (human)' : ''}${p.alive ? '' : p.absorbedBy != null ? ' — absorbed' : ' — fallen'}${p.alive && game.overlordOf(p.id) != null ? ` <span class="dim">(vassal of ${esc(game.players[game.overlordOf(p.id)].name)})</span>` : ''}</td><td>${q(homeName)}</td><td>${temper}</td><td>${q(cs)}</td><td>${q(p.peak || 0)}</td><td>${q('T' + (p.founded ?? 1))}</td><td>${p.fell != null ? q('T' + p.fell) : ''}</td><td>${p.alive ? q(game.score(p.id)) : '-'}</td><td>${q(p.techs.length)}</td><td>${q(p.kills)}</td></tr>`;
  }
  h += `</table>`;
  const dom = game.dominance();
  if (game.coalition >= 0) {
    const mem = game.coalitionMembers();
    h += `<p><b style="color:${game.players[game.coalition].color}">Coalition</b> against <b>${esc(game.players[game.coalition].name)}</b>${game.coalition === viewer.id ? ' — that is you' : ''} (dominance ${(dom.d * 100) | 0}%). Members: ${mem.map(id => esc(game.players[id].name)).join(', ') || '—'}.</p>`;
  } else h += `<p class="dim">No coalition. Only a single runaway power, clearly ahead of the runner-up and the field, draws one. Otherwise tribes guard against their nearest major threat.</p>`;
  if (!viewer.human || true) {
    const thr = game.threats(viewer.id);
    const near = Object.entries(thr.by).filter(([id]) => watchMode || game.cities.some(c => c.owner === +id && viewer.explored[c.idx])).sort((a, b) => b[1].threat - a[1].threat).slice(0, 3);
    if (near.length) h += `<p class="dim">Biggest threats to you: ${near.map(([id, x]) => `${esc(game.players[id].name)} (border ${x.border}, ${x.dmin < 99 ? x.dmin + ' tiles' : 'far'}, ${x.rp.toFixed(1)}× your power)`).join('; ')}.</p>`;
  }
  // peoples of the known world
  const known = game.liveCultures().filter(cul => watchMode || game.cities.some(c => c.culture === cul.id && viewer.explored[c.idx]) || cul.id === viewer.culture);
  if (known.length) {
    h += `<h3>Peoples</h3><p class="dim">Peoples are separate from realms. Offshoots keep their parent's word for "people".</p><table class="tribes"><tr><th></th><th>People</th><th>Word for "people"</th><th>Descended from</th><th>Cities</th><th>Ruled by</th></tr>`;
    const rows = known.map(cul => ({ cul, n: game.cities.filter(c => c.culture === cul.id).length })).sort((a, b) => b.n - a.n);
    for (const { cul, n } of rows) {
      const lang = (ROOTS.find(r => r[0] === cul.root) || [])[1];
      const rulers = [...new Set(game.cities.filter(c => c.culture === cul.id).map(c => game.players[c.owner].name))];
      const parent = cul.parent != null ? game.cultures[cul.parent] : null;
      h += `<tr><td>${cultureChip(cul)}</td><td>${esc(cul.name)}</td><td>${cul.root ? `<i>${cul.root}</i> <span class="dim">(${lang || '?'})</span>` : '—'}</td><td>${parent ? esc(parent.name) : '<span class="dim">founding people</span>'}</td><td>${n}</td><td>${rulers.map(esc).join(', ') || '—'}</td></tr>`;
    }
    h += `</table>`;
  }
  const trad = game.traditions(viewer.id);
  h += `<h3>Traditions</h3><p class="dim">Own 3+ Homeland/Kin cities of one land type and every one of your cities can train its unique unit (+1 cost).</p><p>${trad.length ? trad.map(s => `<b>${SPECIALTY[s].name}</b> → ${UNITS[SPECIALTY[s].unit].name}`).join(', ') : 'None yet.'}</p>`;
  h += `<h3>Cultural kinship</h3><p class="dim">How easily a ${SPECIALTY[viewer.home].name} people runs cities on each land type:</p><table class="spectable">`;
  for (const s of SPECIALTY_KEYS) {
    const d = Math.min(3, KIN_DIST[viewer.home][s]);
    h += `<tr><td><b>${SPECIALTY[s].name}</b> <span class="dim">${SPECIALTY[s].title}</span></td><td>${affBadge(d)}</td><td>${SPECIALTY[s].desc} Unique: ${UNITS[SPECIALTY[s].unit].name}, ${BUILDINGS[SPECIALTY[s].building].name}.</td></tr>`;
  }
  h += `</table>`;
  openModal(h);
  $('modalBody').querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.sort;
    if (tribeSort.key === k) tribeSort.dir *= -1;
    else tribeSort = { key: k, dir: TRIBE_COLS.find(c => c.key === k).txt || k === 'founded' || k === 'fell' ? 1 : -1 };
    const sc = $('modalBody').parentElement.scrollTop;
    showTribes();
    $('modalBody').parentElement.scrollTop = sc;
  });
  $('btnHisto').onclick = () => showHistomap(false);
}

// ------------------------------------------------------------ diplomacy
function relBadge(st, r, me) {
  if (st === 'vassal') return r.vassal === me ? `<span class="aff" style="background:#c8a0e8">Your overlord</span>` : `<span class="aff" style="background:#b080e0">Your vassal</span>`;
  const C = { war: ['War', '#e04030'], truce: ['Truce', '#e0a050'], peace: ['Peace', '#7ddc6a'], alliance: ['Alliance', '#5fa8e8'] }[st];
  return `<span class="aff" style="background:${C[1]}">${C[0]}${st === 'truce' ? ' ' + (r.until - game.turn) : ''}</span>`;
}
function libertyHTML(v) {
  const r = game.vassalRel(v);
  if (!r) return '';
  const terms = game.libertyTerms(v).map(([n, x]) => `${esc(n)} ${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 10) / 10)}`).join(', ');
  const col = r.liberty >= 75 ? '#ff7050' : r.liberty >= 40 ? '#e0c050' : '#7ddc6a';
  let h = `<br><span class="dim">liberty desire</span> <b style="color:${col}">${Math.round(r.liberty)}/100</b> <span class="dim">(${terms} per turn)</span>`;
  const goods = Object.entries(r.lastTribute?.goods || {}).map(([k, n]) => `${n} ${STRATEGIC[k].name.toLowerCase()}`).join(', ');
  h += `<br><span class="dim">tribute: ${r.lastGold || 0} gold${goods ? ', ' + goods : ''}${r.lastTribute?.raided != null ? ' (raided!)' : r.lastTribute?.blocked ? ' (goods route blocked)' : ''}</span>`;
  return h;
}
function showDiplomacy() {
  if (!game) return;
  const me = game.players[R.viewer];
  const mine = myTurn();
  let h = `<h2>Diplomacy</h2><p class="dim">Units cannot attack or enter the land of tribes you are not at war with (allies may pass). Peace starts with a ${10}-turn truce. Breaking peace angers the victim and everyone who knows you; allies of the victim join the war.</p>`;
  const others = game.contenders().filter(p => p.id !== me.id && game.hasMet(me.id, p.id));
  if (!others.length) h += `<p>You have not met any other tribe yet.</p>`;
  else {
    h += `<table class="tribes"><tr><th></th><th>Tribe</th><th>Relation</th><th>Attitude</th><th>Trade route</th><th>Actions</th></tr>`;
    for (const p of others) {
      const r = game.relation(me.id, p.id);
      const hz = p.temper ? game.hostility(p.id, me.id) : null;
      const fav = p.temper?.favor?.[me.id];
      const att0 = hz == null ? '—' : hz < 1.3 ? '<span style="color:#7ddc6a">Friendly</span>' : hz < 1.9 ? '<span style="color:#e0d060">Wary</span>' : '<span style="color:#ff7060">Hostile</span>';
      const att = att0 + (fav >= 5 ? ` <span class="dim">(favour ${Math.round(fav)})</span>` : '');
      const acts = [];
      const iAmVassal = game.isVassal(me.id);
      if (mine && r.state === 'vassal') {
        if (r.overlord === me.id) { acts.push(['annex', 'Annex', !game.canAnnex(me.id, p.id).ok, game.canAnnex(me.id, p.id).why]); acts.push(['release', 'Release']); }
        else acts.push(['independence', 'Declare independence']);
      } else if (mine && iAmVassal) {
        if (!game.routeBetween(me.id, p.id) && r.state !== 'war') acts.push(['route', 'Open route', !game.canOpenRoute(me.id, p.id).ok]);
      } else if (mine) {
        if (r.state === 'war') { acts.push(['peace', 'Offer peace']); acts.push(['vassal', 'Demand submission', !game.offerCheck(me.id, p.id, 'vassal').ok]); }
        else {
          if (!game.isVassal(p.id) && !game.vassalsOf(me.id).length) acts.push(['protect', 'Seek protection', !game.offerCheck(me.id, p.id, 'protect').ok]);
          acts.push(['war', 'Declare war', !game.canDeclareWar(me.id, p.id).ok]);
          if (r.state === 'alliance') acts.push(['endally', 'End alliance']);
          else acts.push(['alliance', 'Propose alliance']);
          if (game.routeBetween(me.id, p.id)) acts.push(['endroute', 'Close route']);
          else acts.push(['route', 'Open route', !game.canOpenRoute(me.id, p.id).ok]);
        }
        acts.push(['transit', game.transitClosed(me.id, p.id) ? 'Open our land' : 'Close our land']);
        for (const amt of [25, 100]) acts.push(['gift' + amt, `Gift ◉${amt}`, me.gold < amt, 'Gold buys goodwill: it eases their grudges against you and softens their stance for a while']);
      }
      let route = '<span class="dim">—</span>';
      const rt = game.routeBetween(me.id, p.id);
      if (rt) {
        const inc = rt.a === me.id ? rt.last?.ba : rt.last?.ab, out = rt.a === me.id ? rt.last?.ab : rt.last?.ba;
        const fmtG = (o) => Object.entries(o || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${STRATEGIC[k].name.toLowerCase()}`).join(', ') || 'nothing';
        route = rt.last?.blocked ? '<span style="color:#ff9a60">blocked</span>' : rt.last?.raided != null ? `<span style="color:#ff6050">raided by ${esc(game.players[rt.last.raided].name)}</span>` : `in: ${fmtG(inc)}<br>out: ${fmtG(out)}`;
        if ((rt.idle || 0) >= 3) route += `<br><span style="color:#e0a050">idle ${rt.idle} turns: costs ${game.routeUpkeep(rt.path.length - 1)} gold/turn for nothing</span>`;
        route += `<br><span class="dim">${rt.path.length - 1} tiles${rt.transit?.length ? ', via ' + rt.transit.map(t => esc(game.players[t].name)).join(', ') : ''}</span>`;
      } else if (!game.atWar(me.id, p.id)) { const gn = game.routeGain(me.id, p.id); route = `<span class="dim">could buy ${gn.buy}, sell ${gn.sell}</span>`; }
      if (game.transitClosed(me.id, p.id)) route += '<br><span class="dim">our land is closed to them</span>';
      const lordOfP = game.overlordOf(p.id);
      const vNote = r.state === 'vassal' ? libertyHTML(r.vassal) : lordOfP != null ? `<br><span class="dim">vassal of ${esc(game.players[lordOfP].name)}</span>` : '';
      h += `<tr><td>${chip(p)}</td><td>${esc(p.name)}${p.human ? ' (human)' : ''}${vNote}</td><td>${relBadge(r.state, r, me.id)}</td><td>${att}</td><td style="font-size:12px">${route}</td><td>${acts.map(([k, l, dis, why]) => `<button data-dip="${k}" data-pid="${p.id}" ${dis ? 'disabled' : ''} title="${esc(why || '')}" style="padding:3px 7px;font-size:12px">${l}</button>`).join(' ')}</td></tr>`;
    }
    h += `</table>`;
  }
  h += `<p class="dim"><b>Tributaries</b>: demand submission from a beaten enemy, or seek protection from a stronger neighbour. A vassal keeps its cities and people, pays 25% of its gold income plus surplus goods along a tribute route, and follows its overlord's wars. Liberty desire grows with distance, cultural difference and the overlord's weakness; at 100 the vassal breaks free. An overlord may annex kindred vassals, or any vassal after 30 quiet turns.</p>`;
  h += `<p class="dim"><b>Trade routes</b> (${game.routesOf(me.id).length}/${game.routeLimit(me.id)}) run between your nearest connected cities. Each turn up to ${3} goods flow each way from surplus to deficit (you keep a reserve of 4 + 3× your army's supply). Buyers pay a price per unit (${Object.entries(PRICE).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${STRATEGIC[k].name.toLowerCase()} ${v}`).join(', ')}), plus 1 per unit to every tribe whose land the route crosses. Routes cost upkeep by length. An enemy unit standing on a route seizes its shipment. A route can't pass through land closed to either partner. See the <b>Trade</b> map mode and your goods (G).</p>`;
  openModal(h);
  $('modalBody').querySelectorAll('[data-dip]').forEach(b => b.onclick = () => {
    const k = b.dataset.dip, o = +b.dataset.pid;
    let res;
    if (k === 'war') { if (!confirm(`Declare war on the ${game.players[o].name}?`)) return; res = game.declareWar(me.id, o); }
    else if (k === 'endally') res = game.breakAlliance(me.id, o);
    else if (k === 'endroute') res = game.closeRoute(me.id, o);
    else if (k.startsWith('gift')) { res = game.giveGold(me.id, o, +k.slice(4)); if (res.ok) toast(`Sent ${res.amount} gold.`); }
    else if (k === 'annex') { if (!confirm(`Absorb the ${game.players[o].name} into your realm?`)) return; res = game.annexVassal(me.id, o); }
    else if (k === 'release') res = game.releaseVassal(me.id, o);
    else if (k === 'independence') { if (!confirm(`Throw off ${game.players[o].name}'s rule? This means war.`)) return; res = game.declareIndependence(me.id); }
    else if (k === 'transit') { game.setTransit(me.id, o, !game.transitClosed(me.id, o)); res = { ok: true }; }
    else {
      res = game.offer(me.id, o, k);
      if (res.ok) toast(res.pending ? 'Offer sent; they will answer on their turn.' : res.accepted ? `The ${game.players[o].name} accept!` : `The ${game.players[o].name} decline.`);
    }
    if (res && !res.ok) toast(res.why);
    refreshAll(); showDiplomacy();
  });
}

// ------------------------------------------------------------ goods
function showGoods() {
  if (!game) return;
  const pid = R.viewer, pl = game.players[pid];
  const st = game.stock(pid), prod = game.production(pid), need = { ...game.supplyNeed(pid) }, lost = game.stranded(pid), cap = game.stockCap(pid);
  for (const gk of Object.keys(GROUPS)) if (need[gk]) { const m = game.preferredMember(pid, gk); need[m] = (need[m] || 0) + need[gk]; }
  let h = `<h2>Strategic goods <button id="btnChains" style="float:right;margin-right:40px;font-size:13px">Production chains (P)</button></h2><p class="dim">Goods come from deposits worked by improvements (at most 2 of a good per city, doubled by its specialty building) and flow into one national stockpile (cap ${cap}: 8 + 2 per city), but only from cities connected to your capital. They are spent to train advanced units and raise buildings, and every 4 units that needed a good keep consuming 1 per turn as supply. Cities of level 3+ <b>eat</b> food (level − 2 each). Hungry cities stop growing and grow restless, and cut-off cities eat only what they grow. Cities of level 4+ take one of each <b>luxury</b> (cloth, spice), largest first, and each calms them by 1. Cities of level 6+ with none grumble.</p>`;
  h += `<table class="tribes"><tr><th>Good</th><th>Stock</th><th>Produced</th><th>Made / used</th><th>Army supply</th><th>Cities eat</th><th>Stranded</th><th>Comes from</th><th>Used by</th></tr>`;
  for (const k of GOOD_KEYS) {
    const G = STRATEGIC[k];
    const inGroup = Object.entries(GROUPS).filter(([, ms]) => ms.includes(k)).map(([gk]) => gk);
    const users = [...Object.entries(UNITS).filter(([, U]) => U.needs?.[k] || inGroup.some(gk => U.needs?.[gk])).map(([, U]) => U.name + (U.needs?.[k] ? '' : '*')), ...Object.entries(BUILDINGS).filter(([, B]) => B.needs?.[k]).map(([, B]) => B.name), ...Object.entries(RECIPES).filter(([, R]) => R.inputs[k]).map(([p]) => '→ ' + STRATEGIC[p].name)];
    if (k === 'food') users.unshift('cities of level 3+ (level − 2 each)');
    if (LUXURIES.includes(k)) users.unshift('cities of level 4+ (1 each, −1 unrest)');
    const srcCities = game.cities.filter(c => c.owner === pid && game.cityProduction(c)[k]).map(c => `${esc(c.name)}${game.isConnected(c) ? '' : ' ⚠'}`);
    h += `<tr><td><i style="display:inline-block;width:10px;height:10px;background:${G.color};border:1px solid #111;margin-right:5px"></i><b>${G.name}</b></td><td>${st[k]}</td><td>+${prod[k]}</td><td>${pl.lastMade?.[k] ? '+' + pl.lastMade[k] : pl.lastUsed?.[k] ? '−' + pl.lastUsed[k] : '—'}</td><td>${need[k] ? '−' + need[k] : '—'}${pl.unsupplied?.[k] ? ' <b style="color:#ff8060">short!</b>' : ''}</td><td>${k === 'food' ? `−${pl.lastEaten || 0} <span class="dim">of ${game.goodDemand(pid, 'food') - (need.food || 0)} wanted</span>` : LUXURIES.includes(k) ? `−${pl.lastLux?.[k] || 0} <span class="dim">of ${game.cities.filter(c => c.owner === pid && c.level >= 4).length} wanted</span>` : '—'}</td><td>${lost[k] ? `<span style="color:#ff9a60">${lost[k]} lost</span>` : '—'}</td><td class="dim">${srcCities.join(', ') || G.from}</td><td class="dim">${users.join(', ')}</td></tr>`;
  }
  const flows = {};
  for (const r of game.routesOf(pid)) {
    const inc = r.a === pid ? r.last?.ba : r.last?.ab, out = r.a === pid ? r.last?.ab : r.last?.ba;
    for (const [k, n] of Object.entries(inc || {})) (flows[k] ||= { in: 0, out: 0 }).in += n;
    for (const [k, n] of Object.entries(out || {})) (flows[k] ||= { in: 0, out: 0 }).out += n;
  }
  h += `</table><p class="dim">* uses any metal: iron first, then bronze.${game.has(pid, 'ironworking') ? '' : ' Iron ore deposits yield nothing until you know Iron Working.'}</p><p>Last turn's trade: ${GOOD_KEYS.filter(k => flows[k]).map(k => `${STRATEGIC[k].name} +${flows[k].in}/−${flows[k].out}`).join(', ') || 'none'}.</p><p class="dim">⚠ = cut off from the capital. Specialty buildings double goods in their city: ${Object.entries(GOOD_DOUBLER).map(([b, ks]) => `${BUILDINGS[b].name} → ${ks.map(k => STRATEGIC[k].name.toLowerCase()).join(' & ')}`).join(', ')}.</p>
  <h3>Production chains</h3>${Object.entries(RECIPES).map(([prod, R]) => `<p><b>${STRATEGIC[prod].name}</b> = ${Object.entries(R.inputs).map(([k, q]) => `${q} ${STRATEGIC[k].name.toLowerCase()}`).join(' + ')}, made at a ${BUILDINGS[R.building].name} (up to ${R.rate}/turn each, in connected cities). Your capacity: ${game.workshops(pid)[prod] || 0}/turn. Last turn: made ${pl.lastMade?.[prod] || 0}. Raw inputs are only kept in reserve if you have a workshop to feed; otherwise they are sold along trade routes.</p>`).join('')}`;
  openModal(h);
  $('btnChains').onclick = showChains;
}

// ------------------------------------------------------------ production chains
// A live diagram built from the data: raw goods -> workshops -> products -> what consumes them.
// Edge width shows last turn's flow; red outlines mark shortages.
function chainModel(pid) {
  const pl = game.players[pid];
  const produced = new Set(Object.keys(RECIPES));
  const raw = GOOD_KEYS.filter(k => !produced.has(k));
  const shops = Object.entries(RECIPES).map(([prod, R]) => ({ id: 'w:' + prod, prod, R }));
  const prods = Object.keys(RECIPES);
  // consumers, grouped by the good (or group) they need
  const cons = [], edges = [];
  const sn = game.supplyNeed(pid);
  const unitsBy = {};
  for (const U of Object.values(UNITS)) for (const k of Object.keys(U.needs || {})) (unitsBy[k] ||= []).push(U.name);
  for (const [k, names] of Object.entries(unitsBy)) {
    const id = 'u:' + k;
    cons.push({ id, title: `Units needing ${GROUPS[k] ? 'metal' : STRATEGIC[k].name.toLowerCase()}`, sub: `${pl.unsupplied?.[k] ? 'SHORT · ' : ''}supply ${sn[k] || 0}/turn · ${names.join(', ')}`, short: !!pl.unsupplied?.[k] });
    const from = GROUPS[k] || [k];
    for (const m of from) edges.push({ from: 'g:' + m, to: id, flow: GROUPS[k] ? (game.preferredMember(pid, k) === m ? sn[k] || 0 : 0) : sn[k] || 0, color: STRATEGIC[m].color, alt: GROUPS[k] && game.preferredMember(pid, k) !== m });
  }
  const bldBy = {};
  for (const B of [...Object.values(BUILDINGS), ...Object.values(WONDERS)]) for (const k of Object.keys(B.needs || {})) (bldBy[k] ||= []).push(B.name);
  if (Object.keys(bldBy).length) {
    cons.push({ id: 'b', title: 'Construction', sub: 'one-off costs: ' + Object.keys(bldBy).map(k => STRATEGIC[k].name.toLowerCase()).join(', ') });
    for (const k of Object.keys(bldBy)) edges.push({ from: 'g:' + k, to: 'b', flow: 0, color: STRATEGIC[k].color, dashed: true });
  }
  const fd = game.goodDemand(pid, 'food') - (sn.food || 0);
  const hungry = game.cities.filter(c => c.owner === pid && c.hunger > 0.3).length;
  cons.push({ id: 'c:food', title: 'Cities: food', sub: `eat ${pl.lastEaten || 0} of ${fd} wanted${hungry ? ` — ${hungry} hungry` : ''}`, short: hungry > 0 });
  edges.push({ from: 'g:food', to: 'c:food', flow: pl.lastEaten || 0, color: STRATEGIC.food.color });
  const big = game.cities.filter(c => c.owner === pid && c.level >= 4).length;
  const served = game.cities.filter(c => c.owner === pid && c.lux?.length).length;
  cons.push({ id: 'c:lux', title: 'Cities: luxuries', sub: `${served} of ${big} large cities served` });
  for (const k of LUXURIES) edges.push({ from: 'g:' + k, to: 'c:lux', flow: pl.lastLux?.[k] || 0, color: STRATEGIC[k].color });
  for (const sp of shops) {
    for (const k of Object.keys(sp.R.inputs)) edges.push({ from: 'g:' + k, to: sp.id, flow: pl.lastUsed?.[k] || 0, color: STRATEGIC[k].color });
    edges.push({ from: sp.id, to: 'g:' + sp.prod, flow: pl.lastMade?.[sp.prod] || 0, color: STRATEGIC[sp.prod].color });
  }
  return { raw, shops, prods, cons, edges };
}

function fit(t, n) { n = Math.floor(n); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

function showChains() {
  if (!game) return;
  const pid = R.viewer, pl = game.players[pid];
  const M = chainModel(pid);
  const st = game.stock(pid), prod = pl.lastProd || {};
  const flows = {};
  for (const r of game.routesOf(pid)) {
    const inc = r.a === pid ? r.last?.ba : r.last?.ab, out = r.a === pid ? r.last?.ab : r.last?.ba;
    for (const [k, n] of Object.entries(inc || {})) (flows[k] ||= { in: 0, out: 0 }).in += n;
    for (const [k, n] of Object.entries(out || {})) (flows[k] ||= { in: 0, out: 0 }).out += n;
  }
  const W = 1040, NH = 50, GAP = 10, X = [10, 300, 520, 770], NW = [210, 170, 190, 260];
  const pos = {};
  const place = (col, ids) => ids.forEach((id, k) => { pos[id] = { x: X[col], y: 40 + k * (NH + GAP), w: NW[col] }; });
  place(0, M.raw.map(k => 'g:' + k));
  // workshops and products line up with their first input
  const used = new Set();
  M.shops.forEach((sp, k) => {
    const firstIn = Object.keys(sp.R.inputs)[0];
    let y = pos['g:' + firstIn]?.y ?? 40 + k * (NH + GAP);
    while (used.has(y)) y += NH + GAP;
    used.add(y);
    pos[sp.id] = { x: X[1], y, w: NW[1] };
    pos['g:' + sp.prod] = { x: X[2], y, w: NW[2] };
  });
  place(3, M.cons.map(c => c.id));
  const H = Math.max(...Object.values(pos).map(p => p.y)) + NH + 20;
  const goodNode = (k) => {
    const G = STRATEGIC[k], f = flows[k];
    const net = (prod[k] || 0) + (pl.lastMade?.[k] || 0);
    const short = pl.unsupplied?.[k] || (game.goodDemand(pid, k) > net && st[k] < game.goodDemand(pid, k));
    return { title: G.name, sub: `stock ${st[k]} · +${net}/turn${f ? ` · trade +${f.in}/−${f.out}` : ''}`, color: G.color, short };
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#0e1620;border-radius:8px;font-family:system-ui,sans-serif">`;
  svg += [['Raw goods', 0], ['Workshops', 1], ['Products', 2], ['Uses', 3]].map(([t, c]) => `<text x="${X[c]}" y="22" fill="#8a96a8" font-size="13" font-weight="700">${t}</text>`).join('');
  // edges under nodes
  for (const e of M.edges) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) continue;
    const x1 = a.x + a.w, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
    const w = e.flow ? 2 + Math.min(9, e.flow * 1.3) : 1.5;
    svg += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${e.color}" stroke-width="${w}" stroke-opacity="${e.flow ? 0.85 : 0.35}" ${e.dashed || e.alt ? 'stroke-dasharray="5 4"' : ''}/>`;
    if (e.flow) svg += `<text x="${mx}" y="${(y1 + y2) / 2 - 4}" fill="#e8e6df" font-size="11" text-anchor="middle" stroke="#0e1620" stroke-width="3" paint-order="stroke">${e.flow}</text>`;
  }
  const node = (id, n) => {
    const p = pos[id];
    if (!p) return '';
    return `<g><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${NH}" rx="7" fill="#1a2635" stroke="${n.short ? '#ff5a40' : '#3a4a60'}" stroke-width="${n.short ? 2.5 : 1}"/>`
      + (n.color ? `<rect x="${p.x}" y="${p.y}" width="7" height="${NH}" rx="3" fill="${n.color}"/>` : '')
      + `<text x="${p.x + 14}" y="${p.y + 20}" fill="#fff" font-size="13" font-weight="700">${esc(fit(n.title, (p.w - 20) / 7.8))}</text>`
      + `<text x="${p.x + 14}" y="${p.y + 38}" fill="${n.short ? '#ff9a80' : '#9aa6b8'}" font-size="11"><title>${esc(n.sub)}</title>${esc(fit(n.sub, (p.w - 20) / 5.9))}</text></g>`;
  };
  for (const k of M.raw) svg += node('g:' + k, goodNode(k));
  for (const sp of M.shops) {
    const n = game.cities.filter(c => c.owner === pid && c.buildings.includes(sp.R.building)).length;
    const cap = game.workshops(pid)[sp.prod] || 0;
    svg += node(sp.id, { title: BUILDINGS[sp.R.building].name, sub: `${n} built · capacity ${cap}/turn`, short: n > 0 && !cap });
    svg += node('g:' + sp.prod, goodNode(sp.prod));
  }
  for (const c of M.cons) svg += node(c.id, c);
  svg += `</svg>`;
  let h = `<h2>Production chains <span class="dim">— ${esc(pl.name)}, last turn</span></h2>`;
  h += `<p class="dim">Lines run from raw goods through workshops to what uses them; thickness and numbers show last turn's flow. Dashed lines are one-off costs or a fallback (bronze stands in for iron). Red outlines mark shortages. Trade figures are what moved along your routes.</p>${svg}`;
  h += `<p><button id="btnBackGoods">Goods table (G)</button></p>`;
  openModal(h);
  $('btnBackGoods').onclick = showGoods;
}

// ------------------------------------------------------------ histomap
// Streams of relative power through time, stacked side by side like the classic
// "Histomap": time runs downward, width is each tribe's share of world power.
// Rebellions are drawn next to the tribe they broke from.
function histomapOrder() {
  const kids = {}, order = [];
  // rebellions sit beside the tribe they rose against; tributaries beside their usual overlord
  const lordCount = {};
  for (const row of game.history || []) for (const [v, o] of Object.entries(row.lord || {})) ((lordCount[v] ||= {})[o] = (lordCount[v][o] || 0) + 1);
  const parentOf = {};
  for (const p of game.players) {
    if (p.rebel && p.rebelFrom != null) parentOf[p.id] = p.rebelFrom;
    else if (lordCount[p.id]) parentOf[p.id] = +Object.entries(lordCount[p.id]).sort((a, b) => b[1] - a[1])[0][0];
  }
  // avoid cycles (a vassal that later ruled its overlord)
  for (const id of Object.keys(parentOf)) { let x = parentOf[id], guard = 0; while (x != null && guard++ < 50) { if (x == id) { delete parentOf[id]; break; } x = parentOf[x]; } }
  for (const [c, par] of Object.entries(parentOf)) (kids[par] ||= []).push(+c);
  const visit = (id) => { order.push(id); for (const k of kids[id] || []) visit(k); };
  for (const p of game.players) if (parentOf[p.id] == null) visit(p.id);
  return order;
}

function histoHatch(ctx, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  x.strokeStyle = color; x.lineWidth = 2.4;
  x.beginPath(); for (const o of [-8, 0, 8]) { x.moveTo(o, 8); x.lineTo(o + 8, 0); } x.stroke();
  return ctx.createPattern(c, 'repeat');
}

function drawHistomap(cv) {
  const hist = game.history || [];
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 900, H = Math.max(420, Math.min(900, hist.length * 9 + 60));
  cv.style.height = H + 'px';
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0e1620'; ctx.fillRect(0, 0, W, H);
  if (hist.length < 2) { ctx.fillStyle = '#ccc'; ctx.font = '14px sans-serif'; ctx.fillText('Not enough history yet.', 20, 30); return; }
  const L = 46, T = 12, PW = W - L - 10, PH = H - T - 12;
  const order = histomapOrder();
  const y = (k) => T + (k / (hist.length - 1)) * PH;
  const edges = {}; // id -> [[left,right] per row]
  hist.forEach((row, k) => {
    const total = Object.values(row.pw).reduce((a, b) => a + b, 0) || 1;
    let x = L;
    for (const id of order) {
      const w = (row.pw[id] || 0) / total * PW;
      (edges[id] ||= [])[k] = [x, x + w];
      x += w;
    }
  });
  // streams
  for (const id of order) {
    const e = edges[id];
    if (!e || !e.some(([a, b]) => b - a > 0.01)) continue;
    ctx.beginPath();
    e.forEach(([a], k) => k ? ctx.lineTo(a, y(k)) : ctx.moveTo(a, y(k)));
    for (let k = e.length - 1; k >= 0; k--) ctx.lineTo(e[k][1], y(k));
    ctx.closePath();
    ctx.fillStyle = game.players[id].color; ctx.fill();
    ctx.strokeStyle = game.players[id].color2 || 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  // dark ages: a grey veil over the stream
  for (let k = 0; k < hist.length - 1; k++) {
    for (const id of hist[k].dark || []) {
      const e = edges[id];
      if (!e || !e[k] || !e[k + 1]) continue;
      ctx.beginPath();
      ctx.moveTo(e[k][0], y(k)); ctx.lineTo(e[k][1], y(k)); ctx.lineTo(e[k + 1][1], y(k + 1)); ctx.lineTo(e[k + 1][0], y(k + 1));
      ctx.closePath();
      ctx.fillStyle = 'rgba(20,24,30,0.55)'; ctx.fill();
    }
  }
  // tributary periods: the vassal's stream is striped in its overlord's colour
  for (let k = 0; k < hist.length - 1; k++) {
    for (const [v, o] of Object.entries(hist[k].lord || {})) {
      const e = edges[v];
      if (!e || !e[k] || !e[k + 1] || !game.players[o]) continue;
      ctx.beginPath();
      ctx.moveTo(e[k][0], y(k)); ctx.lineTo(e[k][1], y(k)); ctx.lineTo(e[k + 1][1], y(k + 1)); ctx.lineTo(e[k + 1][0], y(k + 1));
      ctx.closePath();
      ctx.fillStyle = histoHatch(ctx, game.players[o].color); ctx.fill();
    }
  }
  // time axis
  ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  const step = hist.length > 120 ? 20 : 10;
  hist.forEach((row, k) => {
    if (row.t % step !== 0 && k !== 0) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(L, y(k)); ctx.lineTo(L + PW, y(k)); ctx.stroke();
    ctx.fillStyle = '#aab'; ctx.fillText('T' + row.t, L - 6, y(k) + 4);
  });
  // labels at each stream's widest point
  ctx.textAlign = 'center';
  for (const id of order) {
    const e = edges[id];
    if (!e) continue;
    let bk = 0, bw = 0;
    e.forEach(([a, b], k) => { if (b - a > bw) { bw = b - a; bk = k; } });
    const name = game.players[id].name;
    const fs = Math.min(15, Math.max(9, bw / (name.length * 0.62)));
    if (bw < name.length * 9 * 0.62 * 0.9) continue;
    const [a, b] = e[bk];
    const ky = Math.min(Math.max(y(bk), T + 14), T + PH - 8);
    const c = game.players[id].color;
    const lum = parseInt(c.slice(1, 3), 16) * 0.3 + parseInt(c.slice(3, 5), 16) * 0.59 + parseInt(c.slice(5, 7), 16) * 0.11;
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.fillStyle = lum > 140 ? '#111' : '#fff';
    ctx.fillText(name.toUpperCase(), (a + b) / 2, ky);
  }
}

function histomapHTML() {
  return `<canvas id="histo" style="width:100%;height:480px;border-radius:8px"></canvas><p class="dim">Time flows downward. Each stream's width is that tribe's share of world power (cities, city levels, armies). Rebellions appear beside the tribe they rose against, and tributaries beside their overlord. A stream striped in another tribe's colour was that tribe's vassal at the time; a darkened stretch is a Dark Age.</p>`;
}

function showHistomap(fromWin) {
  openModal(`<h2>The Histomap of this world</h2>${histomapHTML()}<p><button id="btnHistoBack">Back</button></p>`);
  requestAnimationFrame(() => drawHistomap($('histo')));
  $('btnHistoBack').onclick = () => (fromWin ? showWin() : showTribes());
}

function showRazeChoice(c) {
  if (!game.cities.includes(c)) return;
  const adv = game.razeAdvice(c, c.owner);
  const people = game.cultures?.[c.culture] || null;
  let h = `<h2>${esc(c.name)} has fallen to you</h2>`;
  h += `<p>Level ${c.level} ${SPECIALTY[c.specialty].name} city${people ? `, home to the <b style="color:${people.color}">${esc(people.name)}</b>` : ''}. ${c.buildings.length ? 'Surviving buildings: ' + c.buildings.map(b => BUILDINGS[b].name).join(', ') + '.' : 'Nothing of note survived the sack.'}</p>`;
  h += `<p class="dim">Advisors: ${adv.reasons.map(esc).join(' · ')}.</p>`;
  h += `<p><b>${adv.raze ? 'Your advisors favour razing it.' : 'Your advisors favour keeping it.'}</b> Razing frees the land and spares you its unrest, but its people${people && people.alive ? ` and the ${esc(people.name)}` : ''} will not forget.</p>`;
  h += `<p><button id="btnKeep" class="${adv.raze ? '' : 'primary'}">Keep the city</button> <button id="btnRaze" class="${adv.raze ? 'primary' : ''}" style="${adv.raze ? '' : 'background:#5a2020'}">Raze it</button></p>`;
  openModal(h);
  $('btnKeep').onclick = () => { game.keepCity(c); closeModal(); };
  $('btnRaze').onclick = () => { const r = game.razeByChoice(c); if (!r.ok) toast(r.why); closeModal(); deselect(); refreshAll(); };
}

function showLeave() {
  if (!game) { $('menu').classList.remove('hidden'); return; }
  openModal(`<h2>Leave this game?</h2><p class="dim">The game is saved. You can continue it from the main menu.</p>${histomapHTML()}<p><button class="primary" id="btnLeave">Main menu</button> <button id="btnStay">Back to game</button></p>`);
  requestAnimationFrame(() => drawHistomap($('histo')));
  $('btnStay').onclick = closeModal;
  $('btnLeave').onclick = () => {
    closeModal();
    try { if (localStorage.getItem(SAVE_KEY)) $('btnContinue').classList.remove('hidden'); } catch { }
    $('menu').classList.remove('hidden');
    $('menu').onclick = (e) => { if (e.target.id === 'menu') $('menu').classList.add('hidden'); };
  };
}

function showHelp() {
  let h = `<div class="help"><h2>How to play Tyrrainy</h2>
  <p>Lead a tribe across a hex world. There are no fixed factions: <b>every city takes its specialty from the land it is founded on</b> — plains, hilltop, coastal, riverside, forest, desert, steppe, marsh or mountain. Each specialty has its own bonus, unique unit and unique building.</p>
  <h3>Homeland & culture</h3>
  <p>Your tribe has a homeland (the land your capital started on). Cities on that land are <b>Homeland</b> (+1 gold, cheaper uniques). Similar lands are <b>Kin</b>. Distant lands are <b>Foreign</b> (−1 gold, uniques +2) or <b>Alien</b> (−2 gold, no specialty building). Foreign cities slowly integrate (every 10 turns, 5 with a Shrine) and the Assimilation tech softens penalties. Your units also move freely across your homeland terrain.</p>
  <p><b>Traditions:</b> own three Homeland/Kin cities of one land type and all your cities may train that land's unique unit.</p>
  <h3>Economy</h3>
  <ul><li>Gold comes from cities every turn. Spend it on units, techs, buildings and tile improvements.</li>
  <li>Click a tile inside your borders to build an improvement (farm, mine, lumber camp…). Improvements add pop; when pop fills the bar, the city levels up and earns more. Level 4 cities expand their borders.</li>
  <li>Train <b>Settlers</b> to found new cities — choose the land wisely. Settlers get pricier with every city.</li>
  <li>Your unit cap is the sum of (city level + 1). Each city feeds 2 units for free; every extra unit costs 1 gold of upkeep per turn.</li></ul>
  <h3>Labor</h3>
  <p>Every city has its own <b>labor</b> (⚒): 2 + its level per turn, +1 for the capital, +1 with its specialty building, halved while hungry, and it stores up to 4 turns' worth. Units, buildings and wonders cost the city's labor, tile improvements and repairs cost the labor of the city that works the tile, and nothing is built with gold any more. A city may complete as many projects in a turn as its labor allows. If it's short, you can <b>hurry</b> the work: each missing labor point costs 3 gold, and each project already completed in that city this turn makes hurrying 50% dearer. The button shows the price. So big, developed cities build armies and wonders, frontier towns develop slowly unless you pay, and losing a core city costs you making power, not just taxes.</p>
  <h3>Upgrades</h3><p>A unit standing in one of your cities can be re-equipped as a later type (Warrior → Swordsman → Legionary, Defender → Legionary, Rider → Knight, Slinger → Archer). It costs the difference in labor (at least 2) from that city plus the new type's goods, keeps veteran status and its share of health, and uses the unit's turn.</p>
  <h3>Roads & projects</h3>
  <p><b>Roads</b>: any land tile in your territory, or next to your road network, can carry a road, paid in labor (2, or 3 in rough land, 4 on mountains) by your nearest city. Moving from road to road costs half a move for <i>anyone</i>, enemies included, and trade routes along roads are cheaper to run. A city's <b>Extend roads</b> project builds the next stretch toward its nearest unconnected neighbour.</p>
  <p>Other <b>projects</b> soak up spare labor: <b>Scholars</b> turn labor into knowledge (4 : 1), <b>Public games</b> are a festival paid in labor rather than gold, and <b>Drill</b> makes the city's garrison veteran.</p>
  <h3>Grand projects</h3>
  <p>Once you know the right technology, a connected city can <b>begin</b> a grand project, paying its goods up front. Every city connected to the site then gives labor until it's done (use the project's button in each city), but the site can only take in 10 + 2×its level a turn, so a grand project always takes several turns. Its effect belongs to <i>whoever holds the site</i>: lose the city and you lose the project, or a half-built one; take an enemy's and it's yours.</p>
  <ul><li><b>Great Library</b> (Philosophy): +25% knowledge, tech upkeep −25%.</li>
  <li><b>Royal Road</b> (Pathfinding): road moves cost ⅓, trade route upkeep halved, +1 trade route.</li>
  <li><b>Grand Arsenal</b> (Iron Working): units cost 1 less labor, upgrades half price, lighter army supply.</li>
  <li><b>Imperial Granaries</b> (Engineering): every city eats 1 less food.</li></ul>
  <h3>Knowledge</h3>
  <p>Research is paid in <b>knowledge</b> (✦), not gold. Each city gives 0.5 + 0.5 per level, the capital +1, each Shrine and Market +2, and each active trade route +1 (+2 with an unrelated people: ideas travel with goods). Philosophy adds 25%. Vassals pass a quarter of theirs to their overlord. Tech costs rise with tier and with your number of cities.</p>
  <h3>Technology upkeep & dark ages</h3>
  <p>(Game option, on by default.) Everything you know costs knowledge every turn: 1, 2, 3 or 4 per tech by tier. Upkeep halves if a trade partner, vassal or overlord also knows it, and drops a further 25% if any tribe at peace with you does: <b>contact keeps ideas alive, isolation is expensive</b>. Your knowledge stock is the buffer. When it runs dry, decline builds; at 10 you must let a technology go, and you choose which. Only knowledge nothing else depends on can be lost, so the most advanced goes first. What you've built keeps working. Forgotten techs are cheaper to relearn. Two losses within 10 turns bring on a <b>Dark Age</b>, which lifts after 15 turns without further losses. You may also let a tech fade on purpose from the tech screen.</p>
  <h3>Unrest</h3>
  <p>Every city feels <b>pressure</b>:</p>
  <ul><li>a sprawling realm (+1 per 2 cities past 4);</li>
  <li>foreign or alien culture;</li>
  <li>recent conquest;</li>
  <li>crowding (level 4+);</li>
  <li>riots in nearby cities of yours.</li></ul>
  <p>Generic pressures (sprawl, crowding, conquest, enemies, nearby riots) are scaled by <b>cultural sensitivity</b>: ×0.6 in homeland cities, ×0.85 in kin cities, ×1.2 in foreign ones, ×1.5 in alien ones, and +0.25 more when the city's people are another tribe's.</p>
  <p><b>Compliance</b> pushes back: capital, homeland, a garrison unit, Courthouse (−1), Amphitheater (−2), Shrine (−2), a festival (−2 for 5 turns), or a subsidy. Every subsidy tier stops the city's taxes: Tax relief (−2), Grain dole (−4, 2 gold/turn), Patronage (−6, 5 gold/turn). If the treasury runs dry, costly subsidies lapse.</p>
  <p>Festivals are a gamble. Each one held without fixing the cause raises the chance the next turns into a riot. Contentment and compliance buildings restore trust.</p>
  <p>When pressure wins, unrest builds:</p>
  <ul><li><b>Restless</b>: the city withholds gold.</li>
  <li><b>Rioting</b> (${RIOT_AT}): no training or construction except compliance buildings, and the riots spread pressure to your nearby cities.</li>
  <li><b>Insurrection</b> (${INSURRECTION_AT}): insurgents may take up arms.</li>
  <li><b>Revolt</b> (${REVOLT_AT}): the garrison defects and the city founds a rebellion, or joins a nearby kindred one.</li></ul>
  <h3>Balance of power</h3>
  <p>AI tribes weigh three forces when choosing whom to fight:</p>
  <ul><li><b>Threat</b>: neighbours that are close, share a long border, have armies near their cities, or are stronger.</li>
  <li><b>Grudges</b>: whoever hurt them recently.</li>
  <li><b>Containment</b>: only when a single runaway power is clearly ahead of both the runner-up and the field.</li></ul>
  <p>Containment fades with distance and with how pressing a tribe's own threats are. A far-off tribe beset by neighbours won't march across the world.</p>
  <p>Each AI has a <b>temperament</b> that sets the weights, not rules:</p>
  <ul><li><i>Balancers</i> care most about containment.</li>
  <li><i>Opportunists</i> prey on the weak.</li>
  <li><i>Vengeful</i> tribes chase grudges.</li>
  <li><i>Steadfast</i> tribes are slow to commit and slow to quit.</li>
  <li><i>Appeasers</i> avoid provoking the leader, until it threatens them directly.</li></ul>
  <p>Tribes whose containment pull is strong enough call themselves a <b>coalition</b>, and they go easy on each other.</p>
  <h3>Rebellions</h3>
  <p>Revolts and insurrections give birth to new tribes, which take their turn after everyone else.</p>
  <ul><li>A rebellion takes the <b>homeland of the city it rises in</b>, so it faces the same culture penalties as everyone else.</li>
  <li>It inherits its parent's techs and holds a grudge against it.</li>
  <li>Kindred rebellions within 5 tiles merge.</li>
  <li>An uprising that never takes a city melts away once the unrest feeding it dies down.</li></ul>
  <p>Depending on game options, you can take over a rebellion when your tribe falls, or every rebellion can be a human seat.</p>
  <h3>War damage</h3>
  <p>Enemy units standing on a city's tiles cut it off: each occupied or damaged worked tile costs that city 1 gold, and enemies on its land raise unrest. A unit that spends a turn on an enemy improvement may <b>damage</b> it, then <b>destroy</b> it. Destroying it removes the pop it gave, so cities can shrink. Repair damaged improvements from the tile panel. Attacks on a city's garrison may wreck buildings, and a captured city loses each building with 35% chance. A city stripped of all its buildings in the sack may be <b>razed</b>, leaving ruins.</p>
  <h3>Building limits</h3><p>Each city can complete one building or wonder per turn, and none while a hostile unit stands next to it. When a city is captured, it may be razed:</p>
  <p>If the city survives the sack, you choose whether to keep it or raze it. Advisors weigh its expected unrest and its worth. Razing a city angers its people and its former rulers. The AI razes cities likely to be restless and unproductive, but never its own people's.</p>
  <ul><li>holding a wonder: 5%;</li>
  <li>buildings that survive the sack: never;</li>
  <li>stripped of every building it had: 50% at level 1, down to 10% for large cities;</li>
  <li>never built anything: 33% at level 1, down to 18% for large cities.</li></ul><p></p>
  <h3>Peoples</h3>
  <p>Every realm is built on a <b>people</b>. A founding people is named after its capital and its own word for "people", e.g. <i>Mardu</i> + <i>jana</i> gives <b>Mardujana</b>. Distant cities held for a long time may grow a regional identity, named after a major local city (<b>Eskjana</b>) or their land (<b>Hilljana</b>). Offshoots keep the family's word and a related colour, and count as kin.</p>
  <p>A conquered people goes by its own name joined to its ruler's, e.g. <b>Esko-Mardujana</b>. If it breaks free after long rule, it keeps the mark (<b>Mardu-Eskjana</b>). Names never stack beyond two parts, and only the latest influence is kept. Subject peoples feel unrest more strongly (+0.25 sensitivity) and regional offshoots slightly (+0.1). Revolts follow these lines: a rebellion takes its city's identity. Labels (<b>L</b>) name regions on every map mode except terrain.</p>
  <h3>Diplomacy</h3>
  <p>Tribes are at <b>war</b> until they make peace. Peace begins with a 10-turn <b>truce</b>. Units can't attack or enter the land of tribes they aren't at war with; allies share vision, may pass through each other's land, and defend each other when attacked. Declaring war on a partner earns grudges from the victim and from everyone who knows you. AI tribes use their temperament and their view of you to decide on war, peace, trade and alliances. Open <b>Diplomacy (D)</b> to deal with tribes you have met. Offers between humans wait for the other player's turn.</p>
  <h3>Gold</h3>
  <p>Gold is liquidity and influence. It comes from taxes (lighter than before), selling goods, tolls and tribute. It pays for army upkeep, subsidies, festivals, route upkeep and goods purchases, and it <b>hurries</b> construction. It also buys goodwill: a <b>gift</b> eases the recipient's grudges against you and builds favour that softens its stance for a while. A losing AI may sweeten a peace offer with gold, and an appeaser may court a dominant neighbour.</p>
  <h3>Tributaries</h3>
  <p>Instead of conquering a beaten enemy, <b>demand its submission</b>, or ask a stronger neighbour for <b>protection</b> when you are outmatched. A tributary keeps its cities, its people and its own unrest. It pays its overlord 25% of its gold income, ships surplus goods the overlord lacks along a raidable tribute route, and follows its overlord's wars and peace; the two share vision and passage. <b>Liberty desire</b> builds from distance, a foreign overlord, tribute and an overlord too weak to inspire awe, and eases with kinship and shared enemies. At 100 the vassal breaks free. An overlord can release a vassal, or <b>annex</b> it peacefully if their peoples are related, or after 30 turns of low liberty desire. An overlord whose only remaining rivals are its own vassals wins by conquest.</p>
  <h3>Strategic goods</h3>
  <p>Copper, tin, horses, timber and stone come from <b>deposits</b>: a Mine on a copper or tin deposit (the two metals lie in different regions), a Pasture on a horse herd, a Lumber Camp in a forest, a Quarry on hills. Each yields 1 per turn into your national stockpile, but only if its city is <b>connected</b> to your capital through land that isn't hostile or blocked by enemies. Advanced units and many buildings <b>require</b> goods, e.g. a Swordsman needs 1 bronze and Walls need 2 stone. Basic units and buildings never do. Armies also need <b>supply</b>: every 4 units that needed a good consume 1 of it per turn. Unsupplied units fight weaker and don't heal. Deposits are scarce and regional, so they're worth settling, conquering, raiding and protecting. <b>Bronze</b> is made from 1 copper + 1 tin at a Bronze Workshop, and trades at a markup. Press <b>G</b> for details, or <b>P</b> for the production-chain diagram.</p>
  <h3>The iron age</h3>
  <p><b>Iron Working</b> makes iron ore minable: it's common between the copper and tin regions, and lies in marsh bogs (Bog Iron Pit). A <b>Bloomery</b> smelts 1 iron ore with 1 timber (charcoal) into 1 iron. Every unit that needed bronze now takes any <b>metal</b>, iron first, so tin loses its grip and forests gain one. Iron alone arms the <b>Legionary</b>.</p>
  <h3>Food & luxuries</h3>
  <p><b>Food</b> comes from Farms, Irrigation, Fisheries, Whaling and Reed Beds: up to 4 per city, doubled by a Granary. Cities of level 3+ eat (level − 2) food a turn from the national stockpile. Hungry cities stop leveling up and gain unrest. A city cut off from the capital eats only what it grows, so <b>sieges starve cities</b>.</p>
  <p><b>Luxuries</b>: wool from Pastures on sheep becomes <b>cloth</b> at a Weaver, and <b>spice</b> comes from Plantations on rare spice deposits (doubled by a Caravanserai). Each city of level 4+ takes one of each, and each calms it by 1. Cities of level 6+ with none grumble. Luxuries are scarce and regional, so they're worth trading for.</p>
  <h3>Trade routes</h3>
  <p>Open a <b>trade route</b> with a tribe at peace from the Diplomacy screen. It's a real path between your nearest connected cities, by sea once both of you know Sailing. Each turn goods flow automatically from surplus to deficit, up to 3 each way. Buyers pay the seller, plus a toll to every tribe whose land is crossed, so middlemen profit. Any tribe can close its land to another's trade. <b>Enemy units standing on a route seize its shipments</b>: raid your enemies' supply lines and guard your own. AI tribes take up arms against those who attack their suppliers, and covet cities that sit on goods they lack.</p>
  <h3>Map modes</h3><p>Press <b>M</b> or use the Map menu: Terrain, Political (tribe colours only), Culture (stripes mark peoples under foreign rule), Specialty (and what unclaimed land would become), and Unrest.</p>
  <h3>War</h3>
  <ul><li>Select a unit: white hexes = move, red = attack, gold = capture an undefended enemy city.</li>
  <li>Damage depends on attack vs. defense, health and terrain. Defenders in cities, hills, forests and mountains are tougher. Survivors in range strike back.</li>
  <li>Units next to an enemy are stopped (zone of control). Units that rest heal.</li>
  <li>Sailing lets units embark onto shallows; Navigation unlocks oceans. Coastal cities build Corsairs.</li></ul>
  <h3>Wonders</h3><p>Each land type has one wonder in the world. A level 5 city of that type can build it — first come, first served.</p>
  <h3>Winning</h3><p>Be the last tribe standing, or have the highest score when the turn limit ends.</p>
  <h3>Controls</h3><p>Drag to pan, wheel/pinch to zoom, click to select. <b>Space</b> next unit, <b>Enter</b> end turn, <b>T</b> tech, <b>S</b> settle, <b>Esc</b> deselect, right-click deselect. Click a unit's tile again to see the city/tile beneath.</p>
  <h3>Specialties</h3><table class="spectable">`;
  for (const s of SPECIALTY_KEYS) {
    const S = SPECIALTY[s], U = UNITS[S.unit];
    const W = Object.values(WONDERS).find(w => w.special === s);
    h += `<tr><td><b style="color:${S.color}">${S.name}</b><br><span class="dim">${S.title}</span></td><td>${S.desc}<br><b>${U.name}</b> (${U.atk}/${U.def}, mv ${U.mv}${U.rng > 1 ? ', range ' + U.rng : ''}) · <b>${BUILDINGS[S.building].name}</b>: ${BUILDINGS[S.building].desc}<br>Wonder: <b>${W.name}</b> — ${W.desc}</td></tr>`;
  }
  h += `</table><p class="dim">City type rule: hills → Hilltop, mountains → Mountain, river → Riverside, 2+ water neighbours → Coastal, otherwise the terrain itself.</p></div>`;
  openModal(h);
}

function showWin() {
  if (!game.winner) return;
  const w = game.players[game.winner.pid];
  let h = `<h2 style="color:${w.color}">${esc(w.name)} wins by ${game.winner.how}!</h2><p>Turn ${game.turn}.</p><table class="tribes"><tr><th></th><th>Tribe</th><th>Score</th></tr>`;
  for (const r of game.ranking()) {
    const p = game.players[r.id];
    h += `<tr><td>${chip(p)}</td><td>${esc(p.name)}${p.human ? ' (human)' : ''}</td><td>${p.alive ? r.score : 'fallen'}</td></tr>`;
  }
  h += `</table>${histomapHTML()}<p><button class="primary" id="btnAgain">New game</button> <button id="btnReveal">Reveal map</button></p>`;
  openModal(h);
  requestAnimationFrame(() => drawHistomap($('histo')));
  $('btnAgain').onclick = () => { closeModal(); $('menu').classList.remove('hidden'); };
  $('btnReveal').onclick = () => { R.revealAll = true; R.dirty = true; closeModal(); };
  try { localStorage.removeItem(SAVE_KEY); } catch { }
}

initMenu();
// debug hook
window.tyrrainy = { get game() { return game; }, get renderer() { return R; }, runAI, select: (s) => { select(s); refreshAll(); } };
