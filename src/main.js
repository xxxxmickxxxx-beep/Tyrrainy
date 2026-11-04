// UI controller: menu, input, panels, turn flow.
import { Game, REVOLT_AT, RIOT_AT, INSURRECTION_AT } from './game.js';
import { runAI, field, bestStep } from './ai.js';
import { Renderer } from './render.js';
import { MAP_SIZES, MAP_TYPES } from './mapgen.js';
import {
  TERRAIN, SPECIALTY, SPECIALTY_KEYS, KIN_DIST, AFFINITY, UNITS, IMPROVEMENTS, BUILDINGS, WONDERS, TECHS, RESOURCES, TEMPERAMENTS,
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
    players: +$('optPlayers').value,
    humans: watch ? 0 : Math.min(+$('optHumans').value, +$('optPlayers').value),
    turnLimit: +$('optTurns').value,
    rebelControl: watch ? 'ai' : $('optRebels').value,
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
    if (d.pid === viewer || visible(d.idx) || d.idx == null && /learned|fallen|wins|rally|coalition/.test(d.msg) && (d.pid === viewer || /fallen|wins|rally|coalition/.test(d.msg))) addLog(d.msg, d.pid, d.idx);
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

function focusTurn(pl) {
  sel = null;
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
  $('btnTribes').onclick = showTribes;
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
  political: () => 'Tribe colours. Grey: unclaimed land.',
  culture: () => '<b>Solid</b>: a tribe\'s own people. <b>Thick stripes</b>: a people (base colour) ruled by another tribe (stripe colour). <b>Thin dark lines</b>: own people on foreign or alien land.',
  specialty: () => Object.values(SPECIALTY).map(s => `<span class="sw" style="background:${s.color}"></span>${s.name}`).join('') + '<br><span class="dim">Unclaimed land is shown dimmed in the type a city founded there would get.</span>',
  unrest: () => [['#4caf50', 'Content'], ['#c8c840', 'Calming'], ['#f09030', 'Restless'], ['#e04030', 'Rioting'], ['#901818', 'Insurrection']].map(([c, n]) => `<span class="sw" style="background:${c}"></span>${n}`).join('') + '<br><span class="dim">Blue lines: tax relief. Only your own cities are shown.</span>',
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

function updateTopbar() {
  const pl = game.players[R.viewer];
  $('tribeChip').style.background = pl.color;
  $('tribeChip').style.borderColor = pl.color2 || '#111';
  $('tribeName').textContent = pl.name;
  $('tribeHome').textContent = SPECIALTY[pl.home].name + ' people';
  $('tribeHome').style.background = SPECIALTY[pl.home].color;
  $('tribeHome').style.color = '#111';
  $('gold').textContent = pl.gold;
  const up = game.upkeep(pl.id);
  $('income').textContent = `(+${game.income(pl.id)}${up ? `, upkeep ${up}` : ''})`;
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
    h += `<div class="row"><span>Income</span><b>+${game.cityIncome(c)} gold</b></div>`;
    const occ = game.occupation(c);
    if (occ.lost) h += `<div class="desc" style="color:#ff8a70">${occ.lost} worked tile${occ.lost > 1 ? 's are' : ' is'} occupied or damaged: −${occ.lost} gold.${occ.occupied ? ' Enemies on your land also raise unrest and may pillage.' : ''}</div>`;
    if (c.culture != null && c.culture !== c.owner && game.players[c.culture]) h += `<div class="desc">Its people are still <b style="color:${game.players[c.culture].color}">${esc(game.players[c.culture].name)}</b> at heart.</div>`;
    h += moodBlock(c, mine && myTurn());
  }
  if (mine && myTurn()) {
    h += `<h4>Train ${c.trainedTurn === game.turn ? '<span class="dim">(done this turn)</span>' : ''}</h4><div class="opts">`;
    for (const k of game.trainable(c)) {
      const U = UNITS[k];
      const chk = game.canTrain(c, k);
      const cost = game.unitCost(c, k);
      h += `<button data-act="train" data-k="${k}" class="${U.unique ? 'unique' : ''}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${U.name} ◉${cost}<small>${U.atk}/${U.def} hp${U.hp} mv${U.mv}${U.rng > 1 ? ' r' + U.rng : ''}</small></button>`;
    }
    h += `</div>`;
    const lockedUnique = SPECIALTY[c.specialty].unit;
    if (!game.trainable(c).includes(lockedUnique)) h += `<div class="desc">Unique: ${UNITS[lockedUnique].name} — needs ${TECHS[UNITS[lockedUnique].tech]?.name}.</div>`;
    h += `<h4>Buildings</h4><div class="opts">`;
    for (const b of game.buildable(c)) {
      const B = BUILDINGS[b];
      const chk = game.canBuild(c, b);
      h += `<button data-act="build" data-k="${b}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${B.name} ◉${B.cost}<small>${B.desc}</small></button>`;
    }
    h += `</div>`;
    const ws = Object.keys(WONDERS).filter(w => WONDERS[w].special === c.specialty);
    for (const w of ws) {
      const W = WONDERS[w];
      const chk = game.canBuildWonder(c, w);
      const owner = game.wonderOwner(w);
      h += `<h4>Wonder</h4><button data-act="wonder" data-k="${w}" ${chk.ok ? '' : 'disabled'} style="width:100%;text-align:left">${W.name} ◉${W.cost}<br><small>${W.desc}${chk.ok ? '' : ' — ' + esc(chk.why)}</small></button>`;
    }
    if (c.buildings.length) h += `<div class="desc">Built: ${c.buildings.map(b => BUILDINGS[b].name).join(', ')}</div>`;
    if (c.wonders?.length) h += `<div class="desc">Wonders: <b>${c.wonders.map(w => WONDERS[w].name).join(', ')}</b></div>`;
    // workable tiles summary
    const work = [];
    for (const t of game.cityTiles(c)) for (const k of game.improvementsFor(c.owner, t)) work.push(k);
    if (work.length) h += `<div class="desc">Tip: click tiles in this city's border to build improvements (${[...new Set(work)].map(k => IMPROVEMENTS[k].name).join(', ')}).</div>`;
  } else if (c.buildings.length) h += `<div class="desc">Buildings: ${c.buildings.map(b => BUILDINGS[b].name).join(', ')}</div>`;
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
  const fmt = (arr, sign) => arr.map(([n, v]) => `${esc(n)} ${sign}${v}`).join(', ');
  if (un.pressure.length) h += `<div class="desc">Pressure: ${fmt(un.pressure, '+')}</div>`;
  if (un.calm.length) h += `<div class="desc">Compliance: ${fmt(un.calm, '−')}</div>`;
  if (state[2]) h += `<div class="desc"><b>${state[0]}:</b> ${state[2]}</div>`;
  if (un.net > 0) h += `<div class="desc">Restless: withholds ${un.net} gold per turn. Riots at ${RIOT_AT}, insurrection at ${INSURRECTION_AT}, revolt at ${REVOLT_AT}${c.capital ? ' (capitals never revolt)' : ''}.</div>`;
  if (canAct && (un.net > 0 || cur > 0 || c.taxRelief)) {
    const chk = game.canPlacate(c);
    const risk = Math.round(game.festivalRisk(c) * 100);
    h += `<div class="opts" style="margin-top:6px"><button data-act="placate" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">Hold festival ◉${game.placateCost(c)}<small>Resets unrest, −2 for 5 turns. <b style="color:${risk >= 30 ? '#ff8060' : '#e0d060'}">${risk}% riot risk</b></small></button>`;
    h += `<button data-act="relief">${c.taxRelief ? 'End tax relief' : 'Grant tax relief'}<small>${c.taxRelief ? 'City pays no gold while active' : 'City pays no gold, −2 pressure'}</small></button></div>`;
    if (c.festivals) h += `<div class="desc">${c.festivals} recent festival${c.festivals > 1 ? 's' : ''} without lasting peace: each makes the next likelier to backfire (+3 unrest and +2 pressure for 4 turns). Trust returns after 6 content turns, and each compliance building restores 2 festivals' worth.</div>`;
  } else if (c.taxRelief) h += `<div class="desc">Tax relief in effect.</div>`;
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
  if (tl.damaged) {
    h += `<div class="desc" style="color:#ff8a70">This ${IMPROVEMENTS[tl.imp].name} is damaged and yields nothing. Another round of pillage will destroy it, and the city will lose the pop it gave.</div>`;
    if (tl.owner === pid && myTurn()) {
      const chk = game.canRepair(pid, i);
      h += `<button data-act="repair" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">Repair ◉${game.repairCost(i)}</button>`;
    }
  }
  if (tl.owner === pid && myTurn()) {
    const opts = game.improvementsFor(pid, i);
    if (opts.length) {
      h += `<h4>Improve</h4><div class="opts">`;
      for (const k of opts) {
        const I = IMPROVEMENTS[k];
        const chk = game.canImprove(pid, i, k);
        h += `<button data-act="improve" data-k="${k}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.why || '')}">${I.name} ◉${I.cost}<small>+${game.improvePop(i, k)} pop${I.tech && !game.has(pid, I.tech) ? ' · needs ' + TECHS[I.tech].name : ''}</small></button>`;
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
  } else if (d.act === 'relief') {
    const c = game.cityById(sel.id);
    res = game.setTaxRelief(c, !c.taxRelief);
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
  let h = `<h2>Technology <span class="dim">— ◉ ${pl.gold} gold. Cost grows with your number of cities.</span></h2><div class="techtree">`;
  for (let tier = 1; tier <= 4; tier++) {
    h += `<div class="col"><h4>Tier ${tier}</h4>`;
    for (const [k, T] of Object.entries(TECHS)) {
      if (T.tier !== tier) continue;
      const known = pl.techs.includes(k);
      const avail = !known && T.req.every(r => pl.techs.includes(r));
      const cost = game.techPrice(pid, k);
      h += `<div class="tech ${known ? 'known' : avail ? 'avail' : 'locked'}" data-tech="${k}"><b>${T.name}</b>${known ? ' ✓' : `<span class="cost">◉${cost}</span>`}<br>${T.desc}${T.req.length ? `<br><span class="dim">needs ${T.req.map(r => TECHS[r].name).join(', ')}</span>` : ''}</div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;
  openModal(h);
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
    h += `<tr style="opacity:${p.alive ? 1 : 0.45}"><td>${chip(p)}</td><td>${met ? esc(p.name) : '<i>Unknown tribe</i>'}${p.human ? ' (human)' : ''}${p.alive ? '' : ' — fallen'}</td><td>${q(homeName)}</td><td>${temper}</td><td>${q(cs)}</td><td>${q(p.peak || 0)}</td><td>${q('T' + (p.founded ?? 1))}</td><td>${p.fell != null ? q('T' + p.fell) : ''}</td><td>${p.alive ? q(game.score(p.id)) : '-'}</td><td>${q(p.techs.length)}</td><td>${q(p.kills)}</td></tr>`;
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

// ------------------------------------------------------------ histomap
// Streams of relative power through time, stacked side by side like the classic
// "Histomap": time runs downward, width is each tribe's share of world power.
// Rebellions are drawn next to the tribe they broke from.
function histomapOrder() {
  const kids = {}, order = [];
  for (const p of game.players) if (p.rebel && p.rebelFrom != null) (kids[p.rebelFrom] ||= []).push(p.id);
  const visit = (id) => { order.push(id); for (const k of kids[id] || []) visit(k); };
  for (const p of game.players) if (!(p.rebel && p.rebelFrom != null)) visit(p.id);
  return order;
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
  return `<canvas id="histo" style="width:100%;height:480px;border-radius:8px"></canvas><p class="dim">Time flows downward. Each stream's width is that tribe's share of world power (cities, city levels, armies). Rebellions appear beside the tribe they rose against.</p>`;
}

function showHistomap(fromWin) {
  openModal(`<h2>The Histomap of this world</h2>${histomapHTML()}<p><button id="btnHistoBack">Back</button></p>`);
  requestAnimationFrame(() => drawHistomap($('histo')));
  $('btnHistoBack').onclick = () => (fromWin ? showWin() : showTribes());
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
  <h3>Unrest</h3>
  <p>Every city feels <b>pressure</b>:</p>
  <ul><li>a sprawling realm (+1 per 2 cities past 4);</li>
  <li>foreign or alien culture;</li>
  <li>recent conquest;</li>
  <li>crowding (level 4+);</li>
  <li>riots in nearby cities of yours.</li></ul>
  <p><b>Compliance</b> pushes back: capital, homeland, a garrison unit, Courthouse (−1), Amphitheater (−2), Shrine (−2), tax relief (−2, but the city pays no gold), or a festival (−2 for 5 turns).</p>
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
  <h3>Building limits</h3><p>Each city can complete one building or wonder per turn, and none while a hostile unit stands next to it. A captured city left with no buildings, whether stripped in the sack or never built up, may be razed: 50% at level 1, falling to 10% for large cities.</p>
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
window.tyrrainy = { get game() { return game; }, get renderer() { return R; }, runAI };
