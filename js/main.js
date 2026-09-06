import {
  ALLIANCE_OF, COLOR_LABELS, COLOR_ORDER, FIELD_UNITS, NATIONS, SIDES, STRATEGIC_BOMBING_RESULTS,
  UNIT_META, nationsFor, unitIdsFor,
} from './data/rules-data.js';
import {
  ZONES, addCasualties, adjustZone, applyCasualtyStress, createPressureState, spendToCancel,
} from './modules/pressure.js';
import {
  autoAssign, cancelGroup, createBattle, diceCountFor, forceAdvantage, isDisadvantaged,
  prepareStage, rollNextBatch,
} from './modules/engine.js';
import { rollDice } from './modules/dice.js';

const $ = (sel) => document.querySelector(sel);

let state = load() || createBattle('land');
let currentCell = null;     // { side, nation, unit }
let selectedDieId = null;   // 手动阶段选中的待分配骰子
let viewMode = 'battle';
let pressure = loadPressure() || createPressureState();

function clone(v) { return structuredClone(v); }

function load() {
  try {
    const raw = localStorage.getItem('warroom.quickbattle.v1');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function save() {
  try { localStorage.setItem('warroom.quickbattle.v1', JSON.stringify(state)); } catch (e) {}
}
function loadPressure() {
  try {
    const raw = localStorage.getItem('warroom.pressure.v1');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function savePressure() {
  try { localStorage.setItem('warroom.pressure.v1', JSON.stringify(pressure)); } catch (e) {}
}

function init() {
  bindHeader();
  bindAdvantages();
  bindSettings();
  bindPhaseBar();
  bindGridDelegation();
  bindKeyAndWheel();
  document.querySelectorAll('#view-switch [data-view]').forEach((btn) => {
    btn.addEventListener('click', () => { viewMode = btn.dataset.view; renderView(); });
  });
  renderView();
}

// ---------- 事件绑定 ----------
function bindHeader() {
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'new-battle') newBattle(state.battlefield);
      else if (action === 'reroll') reroll();
      else if (action === 'revert-settle') revertSettle();
      else if (action === 'submit-casualties') submitCasualties();
      else if (action === 'toggle-log') toggleLog();
      else if (action === 'toggle-settings') openSettings();
      else if (action === 'close-settings') $('#settings-panel').close();
    });
  });
  document.querySelectorAll('[data-field]').forEach((btn) => {
    btn.addEventListener('click', () => {
      newBattle(btn.dataset.field);
    });
  });
  $('#primary-action').addEventListener('click', onPrimaryAction);
}

function bindAdvantages() {
  $('#axis-force').addEventListener('change', (e) => {
    state.sides.axis.advantages.force = e.target.checked;
    state.sides.axis.advantages.forceManual = true;
    save(); render();
  });
  $('#allied-force').addEventListener('change', (e) => {
    state.sides.allied.advantages.force = e.target.checked;
    state.sides.allied.advantages.forceManual = true;
    save(); render();
  });
  $('#axis-port').addEventListener('change', (e) => {
    state.sides.axis.advantages.port = e.target.checked; save(); render();
  });
  $('#allied-port').addEventListener('change', (e) => {
    state.sides.allied.advantages.port = e.target.checked; save(); render();
  });
}

function bindSettings() {
  $('#set-roll-order').addEventListener('change', (e) => { state.settings.rollOrder = e.target.value; save(); });
  $('#set-nation-priority').addEventListener('change', (e) => { state.settings.nationPriority = e.target.value; save(); });
  $('#set-target-nation').addEventListener('change', (e) => { state.settings.targetNation = e.target.value || null; save(); });
}

function bindPhaseBar() {
  document.querySelectorAll('#phase-bar [data-phase]').forEach((btn) => {
    btn.addEventListener('click', () => gotoPhase(btn.dataset.phase));
  });
}

function bindGridDelegation() {
  document.querySelectorAll('.grid-area').forEach((area) => {
    const side = area.closest('.side').dataset.side;
    area.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const { nation, unit } = cell.dataset;
      onCellClick(side, nation, unit);
    });
    area.addEventListener('contextmenu', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      e.preventDefault();
      const { nation, unit } = cell.dataset;
      if (state.phase === 'deploy') adjustUnit(side, nation, unit, -1);
      else if (state.phase === 'settle') adjustDestroyed(side, nation, unit, -1);
    });
    area.addEventListener('wheel', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      if (state.phase !== 'deploy' && state.phase !== 'settle') return;
      e.preventDefault();
      const { nation, unit } = cell.dataset;
      const delta = e.deltaY < 0 ? 1 : -1;
      if (state.phase === 'deploy') adjustUnit(side, nation, unit, delta);
      else if (state.phase === 'settle') adjustDestroyed(side, nation, unit, delta);
    });
  });
}

function bindKeyAndWheel() {
  document.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9' && currentCell && state.phase === 'deploy') {
      setUnit(currentCell.side, currentCell.nation, currentCell.unit, Number(e.key));
      advanceCell();
      save(); render();
    }
    if (e.key === 'Escape') { selectedDieId = null; render(); }
  });
}

// ---------- 状态操作 ----------
function newBattle(battlefield) {
  state = createBattle(battlefield);
  currentCell = null;
  selectedDieId = null;
  try { localStorage.removeItem('warroom.quickbattle.v1'); } catch (e) {}
  save(); render();
}

function reroll() {
  if (state.phase === 'deploy') return;
  restoreStageStartDestroyed();
  prepareStage(state);
  state.phase = 'roll';
  selectedDieId = null;
  save(); render();
}

function gotoPhase(phase) {
  if (phase === 'deploy') {
    state.phase = 'deploy';
  } else if (phase === 'roll') {
    if (state.phase === 'deploy') return;
    prepareStage(state);
    state.phase = 'roll';
  } else if (phase === 'assign') {
    if (state.phase === 'deploy') return;
    reassignStage();
    state.phase = 'manual';
  } else if (phase === 'manual') {
    if (state.phase === 'deploy') return;
    state.phase = 'manual';
  } else if (phase === 'settle') {
    if (state.phase === 'deploy' || state.phase === 'roll') return;
    state.phase = 'settle';
  }
  selectedDieId = null;
  save(); render();
}

function onPrimaryAction() {
  if (state.phase === 'deploy') startAirStage();
  else if (state.phase === 'roll') rollCurrentBatches();
  else if (state.phase === 'manual' && state.stage === 'air') finishAirManual();
  else if (state.phase === 'manual' && state.stage === 'surface') settle();
  else if (state.phase === 'settle') newBattle(state.battlefield);
}

function startAirStage() {
  snapshotStageStart();
  prepareStage(state);
  state.stage = 'air';
  state.phase = 'roll';
  log('空战阶段开始');
  save(); render();
}

function rollCurrentBatches() {
  const order = rollOrderSides();
  let rolled = 0;
  for (const side of order) {
    const r = rollNextBatch(state, side);
    if (r) { rolled += 1; log(sideName(side) + ' 第 ' + (r.batchIndex + 1) + ' 批：' + r.size + ' 骰，命中组 ' + r.groups.length + '，作废 ' + r.missIds.length); }
  }
  const allDone = SIDES.every((s) => state.sides[s].batchesRolled >= state.sides[s].batchPlan.length);
  if (allDone) {
    state.phase = 'manual';
    log('本阶段掷骰完成，进入手动调整');
  }
  save(); render();
}

function finishAirManual() {
  if (state.battlefield === 'land' && survivingStrategicBombers() > 0) {
    performStrategicBombing();
  }
  startSurfaceStage();
}

function startSurfaceStage() {
  snapshotStageStart();
  prepareStage(state);
  state.stage = 'surface';
  state.phase = 'roll';
  log(state.battlefield === 'land' ? '陆面阶段开始' : '海面阶段开始');
  save(); render();
}

function settle() {
  state.settleSnapshot = {
    destroyed: clone({ axis: state.sides.axis.destroyed, allied: state.sides.allied.destroyed }),
    escapedSubs: { axis: state.sides.axis.escapedSubs, allied: state.sides.allied.escapedSubs },
  };
  state.phase = 'settle';
  log('结算完成');
  save(); render();
}

function revertSettle() {
  if (!state.settleSnapshot) return;
  for (const side of SIDES) {
    state.sides[side].destroyed = clone(state.settleSnapshot.destroyed[side]);
    state.sides[side].escapedSubs = state.settleSnapshot.escapedSubs[side];
  }
  log('已回退结算修改');
  save(); render();
}

function snapshotStageStart() {
  for (const side of SIDES) {
    state.sides[side].destroyedAtStageStart = clone(state.sides[side].destroyed);
  }
}

function restoreStageStartDestroyed() {
  for (const side of SIDES) {
    const s = state.sides[side];
    if (s.destroyedAtStageStart) s.destroyed = clone(s.destroyedAtStageStart);
  }
}

function reassignStage() {
  // 回到本阶段开始时的击毁计数，再按批次重新自动分配
  restoreStageStartDestroyed();
  for (const side of SIDES) {
    const s = state.sides[side];
    s.groups = [];
    for (const d of s.dice) { d.status = 'pending'; d.groupId = null; }
    const maxBatch = Math.max(-1, ...s.dice.map((d) => d.batch));
    for (let b = 0; b <= maxBatch; b += 1) {
      const ids = s.dice.filter((d) => d.batch === b).map((d) => d.id);
      if (ids.length) autoAssign(state, side, ids);
    }
  }
}

function survivingStrategicBombers() {
  let total = 0;
  for (const side of SIDES) {
    for (const n of nationsFor(state.battlefield)) {
      if (ALLIANCE_OF[n.id] !== side) continue;
      const s = state.sides[side];
      total += Math.max(0, (s.deployed[n.id].bomber_strategic || 0) - (s.destroyed[n.id].bomber_strategic || 0));
    }
  }
  return total;
}

function performStrategicBombing() {
  state.strategicBombing = {};
  for (const side of SIDES) {
    let count = 0;
    for (const n of nationsFor(state.battlefield)) {
      if (ALLIANCE_OF[n.id] !== side) continue;
      const s = state.sides[side];
      count += Math.max(0, (s.deployed[n.id].bomber_strategic || 0) - (s.destroyed[n.id].bomber_strategic || 0));
    }
    const dice = [];
    for (let i = 0; i < count * 4; i += 1) {
      dice.push(rollStrategicDie());
    }
    state.strategicBombing[side] = dice;
    if (dice.length) {
      log(sideName(side) + ' 战略轰炸 ' + dice.length + ' 骰：' + dice.map((c) => COLOR_LABELS[c]).join('·'));
      dice.forEach((c) => log('  ' + COLOR_LABELS[c] + ' → ' + STRATEGIC_BOMBING_RESULTS[c]));
    }
  }
  save(); render();
}

// 简单策略骰：直接按 D12 面权重掷
function rollStrategicDie() { return rollDice(1)[0]; }

function onCellClick(side, nation, unit) {
  if (state.phase === 'deploy') {
    adjustUnit(side, nation, unit, 1);
    setCurrentCell(side, nation, unit);
    save(); render();
  } else if (state.phase === 'manual') {
    const die = selectedDie();
    if (die) {
      // 改绑：本版先以“取消命中 + 重新自动分配”实现；单骰改绑下一版接入
      return;
    }
    // 点击被击毁的格子 = 取消最近一个指向该格子的命中组
    cancelLastGroupOn(side, nation, unit);
    save(); render();
  } else if (state.phase === 'settle') {
    adjustDestroyed(side, nation, unit, 1);
  } else if (state.phase === 'roll') {
    // 掷骰阶段点击单元格：忽略
  }
}

function selectedDie() {
  if (!selectedDieId) return null;
  for (const side of SIDES) {
    const d = state.sides[side].dice.find((x) => x.id === selectedDieId);
    if (d) return { side, die: d };
  }
  return null;
}

function adjustDestroyed(side, nation, unit, delta) {
  if (state.phase !== 'settle') return;
  const s = state.sides[side];
  if (!s.deployed[nation] || !(unit in s.deployed[nation])) return;
  const deployed = s.deployed[nation][unit] || 0;
  const next = Math.min(deployed, Math.max(0, (s.destroyed[nation][unit] || 0) + delta));
  s.destroyed[nation][unit] = next;
  save(); render();
}

function adjustUnit(side, nation, unit, delta) {
  if (state.phase !== 'deploy') return;
  const s = state.sides[side];
  if (!s.deployed[nation] || !(unit in s.deployed[nation])) return;
  const next = Math.max(0, (s.deployed[nation][unit] || 0) + delta);
  s.deployed[nation][unit] = next;
  setCurrentCell(side, nation, unit);
}

function setUnit(side, nation, unit, value) {
  const s = state.sides[side];
  if (!s.deployed[nation] || !(unit in s.deployed[nation])) return;
  s.deployed[nation][unit] = value;
  setCurrentCell(side, nation, unit);
}

function setCurrentCell(side, nation, unit) {
  currentCell = { side, nation, unit };
}

function advanceCell() {
  if (!currentCell) return;
  const side = currentCell.side;
  const units = unitIdsFor(state.battlefield);
  const nations = nationsFor(state.battlefield).filter((n) => ALLIANCE_OF[n.id] === side);
  const ui = units.indexOf(currentCell.unit);
  const ni = nations.findIndex((n) => n.id === currentCell.nation);
  // 国家列从左到右；同一国家列内单位从上到下
  let nextUnit = ui + 1;
  let nextNation = ni;
  if (nextUnit >= units.length) { nextUnit = 0; nextNation = ni + 1; }
  if (nextNation >= nations.length) nextNation = 0;
  currentCell = { side, nation: nations[nextNation].id, unit: units[nextUnit] };
}

function cancelLastGroupOn(side, nation, unit) {
  const enemy = side === 'axis' ? 'allied' : 'axis';
  const groups = state.sides[enemy].groups.filter((g) => g.targetNation === nation && g.targetUnit === unit);
  if (!groups.length) return;
  const last = groups[groups.length - 1];
  cancelGroup(state, enemy, last.id);
  log('取消命中：' + nationName(nation) + ' ' + UNIT_META[unit].name);
}

// ---------- 渲染 ----------
function render() {
  renderStage();
  renderPhaseBar();
  renderPrimaryAction();
  renderSettingsPanel();
  for (const side of SIDES) renderSide(side);
  renderLog();
  save();
}

function renderStage() {
  $('#stage-label').textContent = state.stage === 'air' ? '空战阶段' : (state.battlefield === 'land' ? '陆面阶段' : '海面阶段');
  $('#battlefield-label').textContent = state.battlefield === 'land' ? '陆战' : '海战';
  document.querySelectorAll('#battlefield-switch [data-field]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.field === state.battlefield);
  });
}

function renderPhaseBar() {
  const order = ['deploy', 'roll', 'assign', 'manual', 'settle'];
  const reached = phaseReached();
  document.querySelectorAll('#phase-bar [data-phase]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.phase === state.phase);
    b.classList.toggle('is-reached', reached.includes(b.dataset.phase));
  });
}

function phaseReached() {
  // 简化：当前阶段之前的阶段都可点
  const map = { deploy: 0, roll: 1, assign: 2, manual: 3, settle: 4 };
  const cur = map[state.phase] ?? 0;
  return Object.keys(map).filter((p) => map[p] <= cur);
}

function renderPrimaryAction() {
  const btn = $('#primary-action');
  const revert = $('#revert-settle');
  const submit = $('#submit-casualties');
  if (state.phase === 'deploy') btn.textContent = '进入空战阶段';
  else if (state.phase === 'roll') btn.textContent = '掷下一批';
  else if (state.phase === 'manual' && state.stage === 'air') btn.textContent = (state.battlefield === 'land' ? '进入陆面阶段' : '进入海面阶段');
  else if (state.phase === 'manual' && state.stage === 'surface') btn.textContent = '结算';
  else if (state.phase === 'settle') btn.textContent = '开始新战斗';
  if (revert) revert.hidden = state.phase !== 'settle';
  if (submit) submit.hidden = !(state.phase === 'settle' && !state.casualtiesSubmitted);
}

function renderView() {
  $('#battle-view').hidden = viewMode !== 'battle';
  $('#pressure-view').hidden = viewMode !== 'pressure';
  document.querySelectorAll('#view-switch [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === viewMode));
  if (viewMode === 'pressure') renderPressure();
  else render();
}

function submitCasualties() {
  const casualties = {};
  for (const side of SIDES) {
    for (const n of nationsFor(state.battlefield)) {
      if (ALLIANCE_OF[n.id] !== side) continue;
      const s = state.sides[side];
      for (const uid of unitIdsFor(state.battlefield)) {
        const d = s.destroyed[n.id] ? (s.destroyed[n.id][uid] || 0) : 0;
        if (d > 0) {
          casualties[n.id] = casualties[n.id] || {};
          casualties[n.id][uid] = (casualties[n.id][uid] || 0) + d;
        }
      }
    }
  }
  addCasualties(pressure, casualties);
  state.casualtiesSubmitted = true;
  savePressure();
  save();
  log('已提交战损到本回合总计');
  render();
}

function renderPressure() {
  const box = $('#pressure-view');
  if (!box) return;
  let html = '<div class="pressure-banner">压力系统 DEMO · 占位换算（1 伤亡点 = 1 压力，阈值 = 5）待替换为实体士气板数据</div>';
  html += '<div class="pressure-columns">';
  html += renderPressureColumn('轴心', NATIONS.filter((n) => n.alliance === 'axis'));
  html += renderPressureColumn('同盟', NATIONS.filter((n) => n.alliance === 'allied'));
  html += '</div>';
  html += renderRoundCasualties();
  box.innerHTML = html;
  bindPressureEvents(box);
}

function renderPressureColumn(title, nations) {
  let h = '<div class="p-column"><h3>' + title + '</h3>';
  for (const n of nations) {
    const p = pressure.nations[n.id];
    h += '<div class="p-card"><div class="p-head"><img src="./assets/' + n.flag + '" alt="">' + n.name + '</div>';
    h += pRow('压力', p.stress, n.id, 'stress');
    h += pRow('勋章', p.medals, n.id, 'medals');
    h += pRow('民用', p.civilianGoods, n.id, 'civilianGoods');
    h += '<div class="p-row"><span>Zone</span><b>' + ZONES[p.zone] + '</b><button class="mini" data-pn="' + n.id + '" data-act="zone-">−</button><button class="mini" data-pn="' + n.id + '" data-act="zone+">+</button></div>';
    h += '<div class="p-actions"><button class="btn small" data-pn="' + n.id + '" data-act="spend-medal">勋章抵消1</button><button class="btn small" data-pn="' + n.id + '" data-act="spend-civil">民用抵消1</button></div>';
    h += '</div>';
  }
  h += '</div>';
  return h;
}

function pRow(label, value, nationId, key) {
  return '<div class="p-row"><span>' + label + '</span><b>' + value + '</b><button class="mini" data-pn="' + nationId + '" data-act="' + key + '-">−</button><button class="mini" data-pn="' + nationId + '" data-act="' + key + '+">+</button></div>';
}

function renderRoundCasualties() {
  let h = '<div class="p-casualties"><h3>本回合总计损失单位</h3>';
  let any = false;
  for (const side of ['axis', 'allied']) {
    h += '<h4>' + (side === 'axis' ? '轴心' : '同盟') + '</h4><div class="p-cas-list">';
    for (const n of NATIONS.filter((x) => x.alliance === side)) {
      const rc = pressure.roundCasualties[n.id] || {};
      const parts = [];
      for (const uid of Object.keys(rc)) if (rc[uid] > 0) parts.push(UNIT_META[uid].name + '×' + rc[uid]);
      if (parts.length) { any = true; h += '<div class="p-cas-item"><span>' + n.name + '</span><span>' + parts.join('、') + '</span></div>'; }
    }
    h += '</div>';
  }
  if (!any) h += '<p class="muted">暂无战损</p>';
  h += '<button class="btn btn-primary" id="apply-casualty-stress">按占位表转压力并清空战损</button></div>';
  return h;
}

function bindPressureEvents(box) {
  box.querySelectorAll('[data-pn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pn = btn.dataset.pn;
      const act = btn.dataset.act;
      const nat = pressure.nations[pn];
      if (act === 'stress-') nat.stress = Math.max(0, nat.stress - 1);
      else if (act === 'stress+') nat.stress += 1;
      else if (act === 'medals-') nat.medals = Math.max(0, nat.medals - 1);
      else if (act === 'medals+') nat.medals += 1;
      else if (act === 'civilianGoods-') nat.civilianGoods = Math.max(0, nat.civilianGoods - 1);
      else if (act === 'civilianGoods+') nat.civilianGoods += 1;
      else if (act === 'zone-') adjustZone(pressure, pn, -1);
      else if (act === 'zone+') adjustZone(pressure, pn, 1);
      else if (act === 'spend-medal') spendToCancel(pressure, pn, 'medal');
      else if (act === 'spend-civil') spendToCancel(pressure, pn, 'civilian');
      savePressure();
      renderPressure();
    });
  });
  const apply = box.querySelector('#apply-casualty-stress');
  if (apply) apply.addEventListener('click', () => {
    applyCasualtyStress(pressure);
    savePressure();
    log('已按占位表将战损转为压力');
    renderPressure();
  });
}

function renderSide(side) {
  const fa = forceAdvantage(state);
  const el = side === 'axis' ? document.querySelector('.side-axis') : document.querySelector('.side-allied');
  if (el) el.classList.toggle('has-advantage', !!fa[side]);
  renderFlags(side);
  renderAdvantages(side);
  renderDice(side);
  renderGrid(side);
  renderEscaped(side);
}

function renderFlags(side) {
  const box = side === 'axis' ? $('#axis-flags') : $('#allied-flags');
  const nations = nationsFor(state.battlefield).filter((n) => ALLIANCE_OF[n.id] === side);
  box.innerHTML = nations.map((n) => '<img src="./assets/' + n.flag + '" alt="' + n.name + '" title="' + n.name + '">').join('');
}

function renderAdvantages(side) {
  const forceId = side === 'axis' ? '#axis-force' : '#allied-force';
  const portId = side === 'axis' ? '#axis-port' : '#allied-port';
  const fa = forceAdvantage(state);
  $(forceId).checked = !!fa[side];
  $(portId).checked = !!state.sides[side].advantages.port;
  $(portId).disabled = state.battlefield !== 'sea';
}

function renderDice(side) {
  const box = side === 'axis' ? $('#axis-dice') : $('#allied-dice');
  const s = state.sides[side];
  const html = [];

  // 骰子计数器总揽：每种颜色骰子总数，数字大且醒目
  const counts = { yellow: 0, blue: 0, green: 0, red: 0, black: 0, white: 0 };
  for (const d of s.dice) counts[d.color] = (counts[d.color] || 0) + 1;
  html.push('<div class="dice-counter">');
  for (const c of COLOR_ORDER) {
    html.push('<div class="counter-item"><span class="counter-swatch" data-color="' + c + '"></span><span class="counter-label">' + COLOR_LABELS[c] + '</span><span class="counter-num">' + (counts[c] || 0) + '</span></div>');
  }
  html.push('</div>');

  if (state.phase === 'roll' && s.batchPlan.length) {
    html.push('<span class="hint">应掷 ' + s.batchPlan.join('+') + ' 骰 · 已完成 ' + s.batchesRolled + '/' + s.batchPlan.length + ' 批</span>');
  }
  if (state.strategicBombing && state.strategicBombing[side] && state.strategicBombing[side].length) {
    html.push('<span class="hint">战略轰炸：' + state.strategicBombing[side].map((c) => COLOR_LABELS[c]).join('·') + '</span>');
  }
  // 按批次分行显示，批次之间加分割线
  const batches = [];
  for (const d of s.dice) {
    (batches[d.batch] = batches[d.batch] || []).push(d);
  }
  for (let b = 0; b < batches.length; b += 1) {
    html.push('<div class="dice-batch"><span class="batch-label">批' + (b + 1) + '</span>');
    for (const d of batches[b]) {
      const cls = ['die'];
      if (d.status === 'assigned') cls.push('is-assigned');
      else if (d.status === 'miss') cls.push('is-miss');
      else if (d.status === 'pending') cls.push('is-pending');
      if (selectedDieId === d.id) cls.push('is-selected');
      html.push('<span class="' + cls.join(' ') + '" data-color="' + d.color + '" data-die="' + d.id + '" title="' + COLOR_LABELS[d.color] + '"><img src="./assets/dice_' + d.color + '.png" alt="' + COLOR_LABELS[d.color] + '"></span>');
    }
    html.push('</div>');
  }
  if (state.phase === 'manual' && s.dice.some((d) => d.status === 'pending')) {
    html.push('<button class="btn" data-reassign="' + side + '" type="button">重新自动分配待分配骰子</button>');
  }
  box.innerHTML = html.join('');

  box.querySelectorAll('.die.is-pending').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.die;
      selectedDieId = selectedDieId === id ? null : id;
      render();
    });
  });
  box.querySelectorAll('[data-reassign]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sideName0 = btn.dataset.reassign;
      const s0 = state.sides[sideName0];
      const ids = s0.dice.filter((d) => d.status === 'pending').map((d) => d.id);
      if (ids.length) { autoAssign(state, sideName0, ids); log('重新自动分配 ' + sideName(sideName0)); }
      save(); render();
    });
  });
}

function renderGrid(side) {
  const box = side === 'axis' ? $('#axis-grid') : $('#allied-grid');
  const nations = nationsFor(state.battlefield).filter((n) => ALLIANCE_OF[n.id] === side);
  const airUnits = FIELD_UNITS[state.battlefield].air;
  const surfaceUnits = FIELD_UNITS[state.battlefield].surface;
  const sections = [
    { title: '空军', units: airUnits },
    { title: state.battlefield === 'land' ? '陆军' : '海军', units: surfaceUnits },
  ];
  // 国家 × 单位：国家做列（横轴），单位做行（纵轴）
  let html = '<table class="grid"><thead><tr><th class="corner"></th>';
  for (const n of nations) {
    html += '<th class="nation-head"><img class="th-flag-fill" src="./assets/' + n.flag + '" alt=""><span class="nation-name">' + n.name + '</span></th>';
  }
  html += '</tr></thead><tbody>';
  for (const sec of sections) {
    for (const uid of sec.units) {
      html += '<tr><td class="unit">' + UNIT_META[uid].name + '</td>';
      for (const n of nations) {
        html += renderCell(side, n.id, uid);
      }
      html += '</tr>';
    }
  }
  html += '</tbody></table>';
  box.innerHTML = html;
}

function renderCell(side, nation, unit) {
  const s = state.sides[side];
  const deployed = s.deployed[nation] ? (s.deployed[nation][unit] || 0) : 0;
  const destroyed = s.destroyed[nation] ? (s.destroyed[nation][unit] || 0) : 0;
  const alive = deployed - destroyed;
  const isCurrent = currentCell && currentCell.side === side && currentCell.nation === nation && currentCell.unit === unit;
  const legal = isLegalTarget(side, nation, unit);
  const cls = ['cell'];
  if (isCurrent) cls.push('is-current');
  if (legal) cls.push('is-legal');
  const aliveCls = alive === 0 ? 'alive is-zero' : 'alive';
  const destroyedHtml = destroyed > 0 ? '<span class="destroyed">✕' + destroyed + '</span>' : '';
  return '<td class="' + cls.join(' ') + '" data-nation="' + nation + '" data-unit="' + unit + '">' +
    '<div class="cell-row"><span class="' + aliveCls + '">' + alive + '</span>' + destroyedHtml + '</div>' +
    '</td>';
}

function isLegalTarget(gridSide, nation, unit) {
  if (!selectedDieId) return false;
  const sel = selectedDie();
  if (!sel) return false;
  const attackerSide = sel.side;
  const targetSide = attackerSide === 'axis' ? 'allied' : 'axis';
  if (gridSide !== targetSide) return false;
  if (ALLIANCE_OF[nation] !== targetSide) return false;
  const die = sel.die;
  const meta = UNIT_META[unit];
  const colorOk = die.color === meta.color || die.color === 'black' || (die.color === 'white' && unit !== 'submarine');
  if (!colorOk) return false;
  const s = state.sides[targetSide];
  const remaining = (s.deployed[nation][unit] || 0) - (s.destroyed[nation][unit] || 0);
  return remaining > 0;
}

function renderEscaped(side) {
  const el = side === 'axis' ? $('#axis-escaped') : $('#allied-escaped');
  el.textContent = '潜艇逃离 ' + state.sides[side].escapedSubs;
}

function renderSettingsPanel() {
  $('#set-roll-order').value = state.settings.rollOrder;
  $('#set-nation-priority').value = state.settings.nationPriority;
  const sel = $('#set-target-nation');
  const opts = ['<option value="">无（自动）</option>'];
  for (const n of nationsFor(state.battlefield)) {
    opts.push('<option value="' + n.id + '"' + (state.settings.targetNation === n.id ? ' selected' : '') + '>' + n.name + '</option>');
  }
  sel.innerHTML = opts.join('');
}

function renderLog() {
  const list = $('#log-list');
  list.innerHTML = state.log.slice(-60).map((l) => '<li>' + l + '</li>').join('');
}

// ---------- 工具 ----------
function rollOrderSides() {
  if (state.settings.rollOrder === 'axis-first') return ['axis', 'allied'];
  if (state.settings.rollOrder === 'allied-first') return ['allied', 'axis'];
  return ['axis', 'allied'];
}
function sideName(side) { return side === 'axis' ? '轴心' : '同盟'; }
function nationName(id) {
  const n = nationsFor(state.battlefield).find((x) => x.id === id);
  return n ? n.name : id;
}
function log(msg) { state.log.push(new Date().toLocaleTimeString() + ' ' + msg); }
function toggleLog() { const p = $('#log-panel'); p.open = !p.open; }
function openSettings() { $('#settings-panel').showModal(); }

init();
