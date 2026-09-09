// 战斗状态与结算引擎（纯逻辑，不操作 DOM）
// 规则来源：rules_cn.txt（快速结算）、warroom_rules.txt §8/§9/§13。
import {
  ALLIANCE_OF, COMBAT_VALUES, FIELD_UNITS, FORCE_ADVANTAGE_UNITS, MAX_DICE,
  NATIONS, SIDES, STAGE_TARGETS, UNIT_META, nationsFor, unitIdsFor,
} from '../data/rules-data.js';
import { splitBatches, rollDice } from './dice.js';

let seq = 0;
function nextId(prefix) {
  seq += 1;
  return prefix + '-' + String(seq);
}

function other(side) {
  return side === 'axis' ? 'allied' : 'axis';
}

export function createBattle(battlefield) {
  const ids = unitIdsFor(battlefield);
  const sides = {};
  for (const side of SIDES) {
    const deployed = {};
    const destroyed = {};
    const adjustments = {};
    const escaped = {};
    for (const nation of nationsFor(battlefield)) {
      if (ALLIANCE_OF[nation.id] !== side) continue;
      deployed[nation.id] = {};
      destroyed[nation.id] = {};
      adjustments[nation.id] = {};
      escaped[nation.id] = 0;
      for (const uid of ids) {
        deployed[nation.id][uid] = 0;
        destroyed[nation.id][uid] = 0;
        adjustments[nation.id][uid] = 0;
      }
    }
    sides[side] = {
      deployed,
      destroyed,
      adjustments,
      escaped,
      dice: [],
      groups: [],
      batchPlan: [],
      batchesRolled: 0,
      advantages: { force: null, forceManual: false, port: false },
    };
  }
  return {
    battlefield,
    stage: 'air',
    phase: 'deploy',
    sides,
    settings: {
      rollOrder: 'simultaneous',
      nationPriority: 'min-stack',
      targetNation: null,
      animation: 'short',
    },
    log: [],
  };
}

// 某一方在当前阶段应掷骰数（含港口优势，上限 30）
export function diceCountFor(state, side, stage = state.stage) {
  const field = state.battlefield;
  const combat = COMBAT_VALUES[field];
  const s = state.sides[side];
  let total = 0;
  for (const nation of nationsFor(field)) {
    if (ALLIANCE_OF[nation.id] !== side) continue;
    for (const uid of unitIdsFor(field)) {
      const cv = combat[uid];
      if (!cv) continue;
      const meta = UNIT_META[uid];
      let count = s.deployed[nation.id][uid] || 0;
      if (stage === 'surface' && meta.category === 'air') {
        count -= s.destroyed[nation.id][uid] || 0;
      }
      const value = stage === 'air' ? cv.air : cv.surface;
      total += Math.max(0, count) * (value || 0);
    }
  }
  if (stage === 'surface' && field === 'sea' && s.advantages.port) total += 2;
  return Math.min(total, MAX_DICE);
}

// 兵种优势（部署起即计算：只比较陆/海军单位种类数，空军不算；可手动覆盖）
export function forceAdvantage(state) {
  const field = state.battlefield;
  const units = FORCE_ADVANTAGE_UNITS[field];
  function typeCount(side) {
    const s = state.sides[side];
    const seen = new Set();
    for (const nation of nationsFor(field)) {
      if (ALLIANCE_OF[nation.id] !== side) continue;
      for (const uid of units) {
        if ((s.deployed[nation.id][uid] || 0) > 0) seen.add(uid);
      }
    }
    return seen.size;
  }
  const a = typeCount('axis');
  const b = typeCount('allied');
  const auto = { axis: a > b, allied: b > a };
  for (const side of SIDES) {
    const adv = state.sides[side].advantages;
    if (adv.forceManual) auto[side] = !!adv.force;
  }
  return auto;
}

export function isDisadvantaged(state, side) {
  // 兵种优势只在陆/海面阶段影响黑/白骰；展示从部署起即可
  return state.stage === 'surface' && forceAdvantage(state)[other(side)] === true;
}

// 准备当前阶段的批次计划；最后一批若只有 1 骰，追加 1 骰
export function prepareStage(state) {
  for (const side of SIDES) {
    const total = diceCountFor(state, side);
    const plan = splitBatches(total);
    if (plan.length > 0 && plan[plan.length - 1] === 1) plan[plan.length - 1] = 2;
    const s = state.sides[side];
    s.dice = [];
    s.groups = [];
    s.batchPlan = plan;
    s.batchesRolled = 0;
  }
}

function buildTargets(state, enemySide) {
  const field = state.battlefield;
  const stage = state.stage;
  const targetUnits = STAGE_TARGETS[field][stage];
  const s = state.sides[enemySide];
  const targets = [];
  for (const nation of nationsFor(field)) {
    if (ALLIANCE_OF[nation.id] !== enemySide) continue;
    for (const uid of targetUnits) {
      const deployed = s.deployed[nation.id][uid] || 0;
      const destroyed = s.destroyed[nation.id][uid] || 0;
      let remaining = deployed - destroyed;
      if (uid === 'submarine') remaining -= (s.escaped[nation.id] || 0);
      if (remaining > 0) {
        targets.push({
          nation: nation.id,
          unit: uid,
          color: UNIT_META[uid].color,
          hitsRequired: UNIT_META[uid].hitsRequired,
          remaining,
        });
      }
    }
  }
  return targets;
}

function totalSurviving(state, side, nationId) {
  const s = state.sides[side];
  let total = 0;
  for (const uid of unitIdsFor(state.battlefield)) {
    let n = (s.deployed[nationId][uid] || 0) - (s.destroyed[nationId][uid] || 0);
    if (uid === 'submarine') n -= (s.escaped[nationId] || 0);
    total += Math.max(0, n);
  }
  return total;
}

function orderTargets(targets, state, enemySide) {
  const priority = state.settings.nationPriority === 'max-stack' ? -1 : 1; // min-stack 升序
  targets.sort(function (a, b) {
    const ta = totalSurviving(state, enemySide, a.nation);
    const tb = totalSurviving(state, enemySide, b.nation);
    if (ta !== tb) return (ta - tb) * priority;
    return 0; // 保持 nationsFor 的从左到右顺序
  });
  const pick = state.settings.targetNation;
  if (pick) {
    targets.sort(function (a, b) {
      if (a.nation === pick && b.nation !== pick) return -1;
      if (a.nation !== pick && b.nation === pick) return 1;
      return 0;
    });
  }
}

// 骰子组合优先级：C=匹配色 W=白 B=黑
function pickGroupDice(byColor, color, needed, isSub) {
  const combos = needed === 3
    ? [[3, 0, 0], [2, 1, 0], [2, 0, 1], [1, 1, 1], [1, 0, 2], [0, 1, 2], [0, 0, 3]]
    : [[2, 0, 0], [1, 1, 0], [1, 0, 1], [0, 0, 2], [0, 1, 1]];
  for (const [c, w, b] of combos) {
    if (isSub && w > 0) continue;
    if (byColor[color].length >= c && byColor.white.length >= w && byColor.black.length >= b) {
      const picked = [];
      picked.push(...byColor[color].splice(0, c));
      picked.push(...byColor.white.splice(0, w));
      picked.push(...byColor.black.splice(0, b));
      return picked;
    }
  }
  return null;
}

// 自动分配（skipEscape 用于“下一批前重跑”时跳过潜艇逃离）
export function autoAssign(state, side, diceIds, batchIndex, skipEscape) {
  const field = state.battlefield;
  const enemySide = other(side);
  const sideState = state.sides[side];
  const disadvantaged = isDisadvantaged(state, side);
  const targets = buildTargets(state, enemySide);
  orderTargets(targets, state, enemySide);

  const byColor = { yellow: [], blue: [], green: [], red: [], black: [], white: [] };
  for (const id of diceIds) {
    const die = sideState.dice.find(function (d) { return d.id === id; });
    if (!die) continue;
    if (disadvantaged && (die.color === 'black' || die.color === 'white')) {
      die.status = 'miss';
      continue;
    }
    byColor[die.color].push(die);
  }

  const groups = [];
  const orderMap = {};
  const priority = ['red', 'green', 'blue', 'yellow'];
  for (const color of priority) {
    for (const t of targets.filter(function (x) { return x.color === color; })) {
      while (t.remaining > 0) {
        const needed = t.hitsRequired;
        const isSub = t.unit === 'submarine';
        const picked = pickGroupDice(byColor, color, needed, isSub);
        if (!picked) break;
        const key = t.nation + '|' + t.unit;
        orderMap[key] = (orderMap[key] || 0) + 1;
        const group = {
          id: nextId('hit'),
          targetNation: t.nation,
          targetUnit: t.unit,
          color,
          needed,
          diceIds: picked.map(function (d) { return d.id; }),
          batch: batchIndex,
          order: orderMap[key],
        };
        for (const d of picked) {
          d.status = 'assigned';
          d.groupId = group.id;
          d.fresh = true;
          d.assignOrder = groups.length;
        }
        groups.push(group);
        state.sides[enemySide].destroyed[t.nation][t.unit] += 1;
        t.remaining -= 1;
      }
    }
  }

  for (const color of ['yellow', 'blue', 'green', 'red', 'black', 'white']) {
    for (const d of byColor[color]) d.status = 'miss';
  }

  if (!skipEscape && field === 'sea' && state.stage === 'surface') {
    const yellowMiss = diceIds.filter(function (id) {
      const d = sideState.dice.find(function (x) { return x.id === id; });
      return d && d.color === 'yellow' && d.status === 'miss';
    }).length;
    if (yellowMiss % 2 === 1) {
      const es = state.sides[enemySide];
      const order = nationsFor(field).filter(function (n) { return ALLIANCE_OF[n.id] === enemySide; });
      for (const n of order) {
        const rem = (es.deployed[n.id].submarine || 0) - (es.destroyed[n.id].submarine || 0) - (es.escaped[n.id] || 0);
        if (rem > 0) { es.escaped[n.id] = (es.escaped[n.id] || 0) + 1; break; }
      }
    }
  }

  for (const g of groups) sideState.groups.push(g);
  return { groups, missIds: sideState.dice.filter(function (d) { return d.status === 'miss' && diceIds.includes(d.id); }).map(function (d) { return d.id; }) };
}

// 手动右键：回退该单元格最早的一组（FIFO）
export function revertGroupForCell(state, side, nation, unit, batchIndex) {
  const s = state.sides[side];
  const targetSide = other(side);
  const destroyed = state.sides[targetSide].destroyed[nation][unit] || 0;
  if (destroyed <= 0) return null;
  const groups = s.groups.filter(function (g) {
    return g.targetNation === nation && g.targetUnit === unit && g.batch === batchIndex;
  });
  if (!groups.length) return null;
  groups.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  const group = groups[0];
  const idx = s.groups.indexOf(group);
  if (idx < 0) return null;
  s.groups.splice(idx, 1);
  for (const dieId of group.diceIds) {
    const die = s.dice.find(function (d) { return d.id === dieId; });
    if (die) { die.status = 'pending'; die.groupId = null; delete die.fresh; delete die.assignOrder; }
  }
  state.sides[targetSide].destroyed[nation][unit] = Math.max(0, destroyed - 1);
  return group;
}

// 手动左键：从当前批次未分配骰子池凑一组，分配并击毁 1 单位
export function assignGroupToCell(state, side, nation, unit, batchIndex) {
  const s = state.sides[side];
  const targetSide = other(side);
  const meta = UNIT_META[unit];
  let alive = (state.sides[targetSide].deployed[nation][unit] || 0) - (state.sides[targetSide].destroyed[nation][unit] || 0);
  if (unit === 'submarine') alive -= (state.sides[targetSide].escaped[nation] || 0);
  if (alive <= 0) return null;

  const needed = meta.hitsRequired;
  const color = meta.color;
  const isSub = unit === 'submarine';
  const disadvantaged = isDisadvantaged(state, side);
  const byColor = { yellow: [], blue: [], green: [], red: [], black: [], white: [] };
  for (const d of s.dice) {
    if (d.batch !== batchIndex) continue;
    if (d.status !== 'miss' && d.status !== 'pending') continue;
    if (disadvantaged && (d.color === 'black' || d.color === 'white')) continue;
    byColor[d.color].push(d);
  }
  const picked = pickGroupDice(byColor, color, needed, isSub);
  if (!picked) return null;

  const existing = s.groups.filter(function (g) { return g.targetNation === nation && g.targetUnit === unit && g.batch === batchIndex; });
  const group = {
    id: nextId('hit'),
    targetNation: nation,
    targetUnit: unit,
    color,
    needed,
    diceIds: picked.map(function (d) { return d.id; }),
    batch: batchIndex,
    order: existing.length + 1,
  };
  for (const d of picked) {
    d.status = 'assigned';
    d.groupId = group.id;
    d.fresh = true;
    d.assignOrder = s.groups.length;
  }
  s.groups.push(group);
  state.sides[targetSide].destroyed[nation][unit] = (state.sides[targetSide].destroyed[nation][unit] || 0) + 1;
  return group;
}

// 掷下一批并自动分配；批次掷完返回 null
export function rollNextBatch(state, side, rng = Math.random) {
  const s = state.sides[side];
  if (s.batchesRolled >= s.batchPlan.length) return null;
  const batchIndex = s.batchesRolled;
  const size = s.batchPlan[batchIndex];
  const colors = rollDice(size, rng);
  const dice = colors.map(function (color) {
    return { id: nextId('die'), color, batch: batchIndex, status: 'pending', groupId: null };
  });
  s.dice.push(...dice);
  s.batchesRolled += 1;
  const result = autoAssign(state, side, dice.map(function (d) { return d.id; }), batchIndex, false);
  result.batchIndex = batchIndex;
  result.size = size;
  return result;
}

// 取消一个命中组：骰子回退待分配，敌方击毁计数回退
export function cancelGroup(state, side, groupId) {
  const s = state.sides[side];
  const idx = s.groups.findIndex(function (g) { return g.id === groupId; });
  if (idx < 0) return false;
  const group = s.groups[idx];
  const enemySide = other(side);
  for (const dieId of group.diceIds) {
    const die = s.dice.find(function (d) { return d.id === dieId; });
    if (die) { die.status = 'pending'; die.groupId = null; delete die.fresh; delete die.assignOrder; }
  }
  state.sides[enemySide].destroyed[group.targetNation][group.targetUnit] -= 1;
  s.groups.splice(idx, 1);
  return true;
}

// 当前待分配骰子的合法目标（阶段 + 颜色 + 剩余数量）
export function legalTargetsForDie(state, side, die) {
  const field = state.battlefield;
  const enemySide = other(side);
  const result = [];
  if (!die || die.status !== 'pending') return result;
  for (const nation of nationsFor(field)) {
    if (ALLIANCE_OF[nation.id] !== enemySide) continue;
    for (const uid of STAGE_TARGETS[field][state.stage]) {
      const meta = UNIT_META[uid];
      const colorOk = die.color === meta.color || die.color === 'black' || (die.color === 'white' && uid !== 'submarine');
      if (!colorOk) continue;
      const s = state.sides[enemySide];
      const remaining = (s.deployed[nation.id][uid] || 0) - (s.destroyed[nation.id][uid] || 0);
      if (remaining > 0) result.push({ nation: nation.id, unit: uid });
    }
  }
  return result;
}

// 手动改绑：后续在 UI 层实现“选中待分配骰子 → 点击合法单位 → 重新成组”。
// 这里先提供占位，避免静默产生错误结果。
export function bindDie() {
  throw new Error('bindDie 尚未实现（手动改绑将在 UI 层完成）');
}
