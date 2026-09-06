import {
  ALLIANCE_OF, COLOR_LABELS, COLOR_ORDER, FIELD_UNITS, NATIONS, SIDES, STRATEGIC_BOMBING_RESULTS,
  UNIT_META, nationsFor, unitIdsFor,
} from './data/rules-data.js';
import {
  CASUALTY_FACTORS, NATION_STRESS_THRESHOLDS,
  ZONES, ZONE_EFFECTS, addCasualties, adjustScore, casualtyPoints, casualtyStress,
  createPressureState, newRound, roundCasualtyOverview, thisRoundAdded, totalStress, zoneFor,
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
if (!pressure.log) pressure.log = [];
if (!pressure.adjustmentLog) pressure.adjustmentLog = [];

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
    if (!raw) return null;
    const old = JSON.parse(raw);
    // 旧 demo schema 迁移：nations 里是 stress/medals/civilianGoods
    if (old.nations && old.nations.germany && 'stress' in old.nations.germany) {
      const p = createPressureState();
      if (old.roundCasualties) p.roundCasualties = old.roundCasualties;
      for (const n of NATIONS) {
        if (old.nations[n.id]) p.nations[n.id].previousRoundStress = old.nations[n.id].stress || 0;
      }
      return p;
    }
    return old;
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
      if (state.phase === 'deploy') { adjustUnit(side, nation, unit, -1); save(); render(); }
      else if (state.phase === 'settle') adjustDestroyed(side, nation, unit, -1);
    });
    area.addEventListener('wheel', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      if (state.phase !== 'deploy' && state.phase !== 'settle') return;
      e.preventDefault();
      const { nation, unit } = cell.dataset;
      const delta = e.deltaY < 0 ? 1 : -1;
      if (state.phase === 'deploy') { adjustUnit(side, nation, unit, delta); save(); render(); }
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
  state.stage = 'air';
  prepareStage(state);
  state.phase = 'roll';
  log('空战阶段开始');
  rollCurrentBatches();
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
  state.stage = 'surface';
  prepareStage(state);
  state.phase = 'roll';
  log(state.battlefield === 'land' ? '陆面阶段开始' : '海面阶段开始');
  rollCurrentBatches();
}

function settle() {
  state.settleSnapshot = {
    destroyed: clone({ axis: state.sides.axis.destroyed, allied: state.sides.allied.destroyed }),
    adjustments: clone({ axis: state.sides.axis.adjustments, allied: state.sides.allied.adjustments }),
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
    state.sides[side].adjustments = clone(state.settleSnapshot.adjustments[side]);
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

function strategicBombersFor(side) {
  let total = 0;
  for (const n of nationsFor(state.battlefield)) {
    if (ALLIANCE_OF[n.id] !== side) continue;
    const s = state.sides[side];
    total += Math.max(0, (s.deployed[n.id].bomber_strategic || 0) - (s.destroyed[n.id].bomber_strategic || 0));
  }
  return total;
}

function survivingStrategicBombers() {
  return strategicBombersFor('axis') + strategicBombersFor('allied');
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
  const fieldEl = document.querySelector('#battle-view .battlefield');
  const settleEl = $('#settle-view');
  const isSettle = state.phase === 'settle';
  if (fieldEl) fieldEl.hidden = isSettle;
  if (settleEl) {
    settleEl.hidden = !isSettle;
    if (isSettle) renderSettle();
  }
  if (!isSettle) for (const side of SIDES) renderSide(side);
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
  if (state.phase === 'deploy') btn.textContent = '进入空战阶段';
  else if (state.phase === 'roll') btn.textContent = '掷下一批';
  else if (state.phase === 'manual' && state.stage === 'air') btn.textContent = (state.battlefield === 'land' ? '进入陆面阶段' : '进入海面阶段');
  else if (state.phase === 'manual' && state.stage === 'surface') btn.textContent = '结算';
  else if (state.phase === 'settle') btn.textContent = '开始新战斗';
}

function renderView() {
  const battleEl = $('#battle-view');
  const pressureEl = $('#pressure-view');
  if (battleEl) battleEl.hidden = viewMode !== 'battle';
  if (pressureEl) pressureEl.hidden = viewMode !== 'pressure';
  document.querySelectorAll('#view-switch [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === viewMode));
  if (viewMode === 'pressure') renderPressure();
  else render();
}

function submitCasualties() {
  const field = state.battlefield;
  const beforeStress = {};
  for (const n of NATIONS) beforeStress[n.id] = casualtyStress(pressure, n.id);
  for (const side of SIDES) {
    const s = state.sides[side];
    for (const n of nationsFor(field)) {
      if (ALLIANCE_OF[n.id] !== side) continue;
      for (const uid of unitIdsFor(field)) {
        const X = pressure.roundCasualties[n.id][uid] || 0;
        const Y = s.destroyed[n.id][uid] || 0;
        const Z = s.adjustments[n.id][uid] || 0;
        const merged = Math.max(0, X + Y + Z);
        pressure.roundCasualties[n.id][uid] = merged;
        if (Z !== 0) pressure.adjustmentLog.push({ round: pressure.round, nation: n.id, unit: uid, z: Z });
        s.destroyed[n.id][uid] = 0;
        s.adjustments[n.id][uid] = 0;
      }
    }
  }
  for (const n of NATIONS) {
    const d = casualtyStress(pressure, n.id) - beforeStress[n.id];
    if (d !== 0) pressure.log.push({ time: new Date().toLocaleTimeString(), kind: 'casualty', nation: n.id, delta: d, note: '提交战损' });
  }
  state.casualtiesSubmitted = true;
  savePressure();
  save();
  log('已提交战损：本场 Y+Z 并入本回合累计');
  render();
}

function renderSettle() {
  const box = $('#settle-view');
  if (!box) return;
  const field = state.battlefield;
  const nations = nationsFor(field);
  const units = unitIdsFor(field);
  let html = '<h3>战斗结算 · 提交战损</h3>';
  html += '<table class="settle-table"><thead><tr><th>国家</th><th>伤亡点数</th><th>本轮伤亡点数</th>';
  for (const uid of units) html += '<th>' + UNIT_META[uid].name + '</th>';
  html += '</tr></thead><tbody>';
  for (const n of nations) {
    const side = ALLIANCE_OF[n.id];
    const s = state.sides[side];
    let totalPts = 0;
    let thisBattlePts = 0;
    const cells = [];
    for (const uid of units) {
      const X = pressure.roundCasualties[n.id][uid] || 0;
      const Y = s.destroyed[n.id][uid] || 0;
      const Z = s.adjustments[n.id][uid] || 0;
      const total = Math.max(0, X + Y + Z);
      const factor = CASUALTY_FACTORS[uid] || 0;
      totalPts += total * factor;
      thisBattlePts += Y * factor;
      cells.push({ uid, total, z: Z, x: X, y: Y });
    }
    html += '<tr><td class="nation-cell">' + n.name + '</td>';
    html += '<td class="readonly">' + totalPts + '</td>';
    html += '<td class="readonly">' + thisBattlePts + '</td>';
    for (const c of cells) {
      const zText = c.z !== 0 ? ' <span class="z">' + (c.z > 0 ? '+' : '') + c.z + '</span>' : '';
      html += '<td class="settle-unit" data-nation="' + n.id + '" data-unit="' + c.uid + '" title="X' + c.x + ' + Y' + c.y + ' + Z' + c.z + '">' + c.total + zText + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += '<div class="settle-actions"><button class="btn btn-primary" id="settle-submit" type="button">提交战损</button><button class="btn" id="settle-revert" type="button">回退结算修改</button></div>';
  box.innerHTML = html;
  bindSettleEvents(box);
}

function bindSettleEvents(box) {
  box.querySelectorAll('.settle-unit').forEach((cell) => {
    cell.addEventListener('click', () => adjustSettleUnit(cell.dataset.nation, cell.dataset.unit, 1));
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); adjustSettleUnit(cell.dataset.nation, cell.dataset.unit, -1); });
  });
  const submit = box.querySelector('#settle-submit');
  if (submit) submit.addEventListener('click', submitCasualties);
  const revert = box.querySelector('#settle-revert');
  if (revert) revert.addEventListener('click', revertSettle);
}

function adjustSettleUnit(nation, unit, delta) {
  const side = ALLIANCE_OF[nation];
  const s = state.sides[side];
  const X = pressure.roundCasualties[nation][unit] || 0;
  const Y = s.destroyed[nation][unit] || 0;
  const next = (s.adjustments[nation][unit] || 0) + delta;
  s.adjustments[nation][unit] = Math.max(-(X + Y), next);
  save(); render();
}

function renderPressure() {
  const box = $('#pressure-view');
  if (!box) return;
  if (!pressure || !pressure.nations || !pressure.roundCasualties) pressure = createPressureState();
  let html = '<div class="pressure-head"><h3>压力系统</h3><button class="btn" id="new-round" type="button">新回合</button></div>';
  html += '<table class="pmatrix"><thead><tr><th></th>';
  for (const n of NATIONS) html += '<th><img src="./assets/' + n.flag + '" alt="">' + n.name + '</th>';
  html += '</tr></thead><tbody>';
  const rows = [
    ['国家名称', (n) => n.name],
    ['压力阈值', (n) => NATION_STRESS_THRESHOLDS[n.id]],
    ['总压力值', (n) => totalStress(pressure, n.id)],
    ['上一轮压力', (n) => pressure.nations[n.id].previousRoundStress],
    ['本回合新增压力', (n) => thisRoundAdded(pressure, n.id)],
    ['击杀分压力', (n) => casualtyStress(pressure, n.id)],
    ['伤亡点数', (n) => casualtyPoints(pressure, n.id)],
    ['争夺领地分', (n) => pressure.nations[n.id].contestedTerritory],
    ['勋章/战略物资分', (n) => pressure.nations[n.id].medals],
  ];
  for (let r = 0; r < rows.length; r += 1) {
    html += '<tr><td class="row-label">' + rows[r][0] + '</td>';
    for (const n of NATIONS) {
      const value = rows[r][1](n);
      if (r === 2) {
        const z = zoneFor(pressure, n.id);
        html += '<td class="zone-cell zone-' + z + '" data-nation="' + n.id + '" data-zone="' + z + '">' + value + '</td>';
      } else if (r === 6) {
        html += '<td class="overview-cell" data-nation="' + n.id + '">' + value + '</td>';
      } else if (r === 7 || r === 8) {
        const kind = r === 7 ? 'territory' : 'medals';
        html += '<td class="editable-cell" data-nation="' + n.id + '" data-kind="' + kind + '">' + value + '</td>';
      } else {
        html += '<td>' + value + '</td>';
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  box.innerHTML = html;
  bindPressureEvents(box);
  renderLog();
}

function bindPressureEvents(box) {
  box.querySelectorAll('.zone-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const z = Number(cell.dataset.zone);
      alert('第 ' + (z + 1) + ' 压力阶段 · ' + ZONES[z] + '：' + ZONE_EFFECTS[z]);
    });
  });
  box.querySelectorAll('.overview-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const items = roundCasualtyOverview(pressure, cell.dataset.nation);
      const lines = items.map((it) => UNIT_META[it.unit].name + '：' + CASUALTY_FACTORS[it.unit] + '×' + it.count + '=' + it.points);
      alert(lines.length ? lines.join('；') : '本回合暂无损失');
    });
  });
  box.querySelectorAll('.editable-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      adjustScore(pressure, cell.dataset.nation, cell.dataset.kind, 1);
      pressure.log.push({ time: new Date().toLocaleTimeString(), kind: cell.dataset.kind, nation: cell.dataset.nation, delta: 1, note: cell.dataset.kind === 'territory' ? '争夺领地分' : '勋章分' });
      savePressure(); renderPressure();
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      adjustScore(pressure, cell.dataset.nation, cell.dataset.kind, -1);
      pressure.log.push({ time: new Date().toLocaleTimeString(), kind: cell.dataset.kind, nation: cell.dataset.nation, delta: -1, note: cell.dataset.kind === 'territory' ? '争夺领地分' : '勋章分' });
      savePressure(); renderPressure();
    });
  });
  const nr = box.querySelector('#new-round');
  if (nr) nr.addEventListener('click', () => { newRound(pressure); savePressure(); log('进入新回合'); renderPressure(); });
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

function counterColor(n) {
  const k = Math.min(n, 12);
  const g = 255 - k * 5;
  const b = 255 - k * 5;
  return 'rgb(255,' + g + ',' + b + ')';
}

function renderDice(side) {
  const box = side === 'axis' ? $('#axis-dice') : $('#allied-dice');
  const s = state.sides[side];
  const html = [];

  // 颜色计数按 3 行 × 2 列：红绿 / 蓝黄 / 黑白
  const counts = { yellow: 0, blue: 0, green: 0, red: 0, black: 0, white: 0 };
  for (const d of s.dice) counts[d.color] = (counts[d.color] || 0) + 1;
  const overviewRows = [['red', 'green'], ['blue', 'yellow'], ['black', 'white']];

  let overview = '<div class="dice-overview">';
  for (const row of overviewRows) {
    overview += '<div class="overview-row">';
    for (const c of row) {
      const n = counts[c] || 0;
      const numCls = n === 0 ? 'counter-num zero' : 'counter-num';
      const numStyle = n > 0 ? ' style="color:' + counterColor(n) + '"' : '';
      overview += '<div class="counter-item"><span class="counter-swatch" data-color="' + c + '"></span><span class="' + numCls + '"' + numStyle + '>' + n + '</span></div>';
    }
    overview += '</div>';
  }
  overview += '</div>';

  // 三批次始终占位显示
  let batches = '<div class="dice-batches">';
  const byBatch = [[], [], []];
  for (const d of s.dice) {
    if (d.batch < 3) byBatch[d.batch].push(d);
  }
  for (let b = 0; b < 3; b += 1) {
    batches += '<div class="dice-batch"><span class="batch-label">批' + (b + 1) + '</span>';
    if (byBatch[b].length) {
      for (const d of byBatch[b]) {
        const cls = ['die'];
        let delayStyle = '';
        if (d.status === 'assigned') {
          cls.push('is-assigned');
          if (d.fresh) {
            cls.push('is-just-assigned');
            delayStyle = ' style="animation-delay:' + ((d.assignOrder || 0) * 0.04).toFixed(2) + 's"';
          }
        } else if (d.status === 'miss') cls.push('is-miss');
        else if (d.status === 'pending') cls.push('is-pending');
        if (selectedDieId === d.id) cls.push('is-selected');
        batches += '<span class="' + cls.join(' ') + '" data-color="' + d.color + '" data-die="' + d.id + '" title="' + COLOR_LABELS[d.color] + '"' + delayStyle + '><img src="./assets/dice_' + d.color + '.png" alt="' + COLOR_LABELS[d.color] + '"></span>';
      }
    } else {
      batches += '<span class="batch-empty">·</span>';
    }
    batches += '</div>';
  }
  batches += '</div>';

  // 总览靠页面中部：轴心放右、同盟放左
  if (side === 'axis') html.push('<div class="dice-row">' + batches + overview + '</div>');
  else html.push('<div class="dice-row">' + overview + batches + '</div>');

  if (state.phase === 'roll' && s.batchPlan.length) {
    html.push('<span class="hint">本阶段应掷 ' + s.batchPlan.join('+') + ' 骰 · 已完成 ' + s.batchesRolled + '/' + s.batchPlan.length + ' 批</span>');
  }
  if (state.strategicBombing && state.strategicBombing[side] && state.strategicBombing[side].length) {
    html.push('<div class="dice-batch"><span class="batch-label">战略轰炸骰</span>');
    for (const c of state.strategicBombing[side]) {
      html.push('<span class="die" title="' + COLOR_LABELS[c] + '"><img src="./assets/dice_' + c + '.png" alt="' + COLOR_LABELS[c] + '"></span>');
    }
    html.push('</div>');
  }
  if (state.phase === 'manual' && s.dice.some((d) => d.status === 'pending')) {
    html.push('<button class="btn" data-reassign="' + side + '" type="button">重新自动分配待分配骰子</button>');
  }
  box.innerHTML = html.join('');

  // 新分配骰子动画结束后清除 fresh 标记，避免后续渲染重复动画
  const freshDice = s.dice.filter((d) => d.fresh);
  if (freshDice.length) {
    const maxOrder = Math.max(...freshDice.map((d) => d.assignOrder || 0));
    const totalMs = maxOrder * 40 + 520;
    setTimeout(() => { for (const d of freshDice) delete d.fresh; }, totalMs);
  }

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

function gutterTiles(side) {
  const airCount = diceCountFor(state, side, 'air');
  const surfaceCount = diceCountFor(state, side, 'surface');
  const stratCount = state.battlefield === 'land' ? strategicBombersFor(side) * 4 : 0;
  let h = '';
  if (state.battlefield === 'land') h += '<div class="gutter-tile strat"><span>战略轰炸</span><b>' + stratCount + '</b></div>';
  h += '<div class="gutter-tile air"><span>空战</span><b>' + airCount + '</b></div>';
  h += '<div class="gutter-tile surf"><span>' + (state.battlefield === 'land' ? '陆面' : '海面') + '</span><b>' + surfaceCount + '</b></div>';
  return h;
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
  const gutter = gutterTiles(side);
  // 国家 × 单位：国家做列（横轴），单位做行（纵轴）；骰数总览放左右槽位
  let html = '<div class="unit-wrap">';
  html += '<div class="dice-gutter left">' + gutter + '</div>';
  html += '<div class="grid-scroll"><table class="grid"><thead><tr><th class="corner"></th>';
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
  html += '</tbody></table></div>';
  html += '<div class="dice-gutter right">' + gutter + '</div>';
  html += '</div>';
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
  const entries = (pressure.log || []).slice(-100).reverse();
  list.innerHTML = entries.map(function (e) {
    const cat = logCatLabel(e.kind);
    const nation = pressureNationName(e.nation);
    const sign = e.delta >= 0 ? '+' : '';
    return '<li><span class="log-cat">[' + cat + ']</span> ' + nation + ' ' + sign + e.delta + ' · ' + (e.note || '') + '</li>';
  }).join('') || '<li class="muted">暂无压力增减</li>';
}

function logCatLabel(kind) {
  if (kind === 'territory') return '争夺领地';
  if (kind === 'medals') return '勋章';
  if (kind === 'casualty') return '伤亡';
  return kind || '压力';
}

function pressureNationName(id) {
  const n = NATIONS.find((x) => x.id === id);
  return n ? n.name : id;
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
