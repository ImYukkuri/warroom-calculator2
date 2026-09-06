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
    for (const nation of nationsFor(battlefield)) {
      if (ALLIANCE_OF[nation.id] !== side) continue;
      deployed[nation.id] = {};
      destroyed[nation.id] = {};
      for (const uid of ids) {
        deployed[nation.id][uid] = 0;
        destroyed[nation.id][uid] = 0;
      }
    }
    sides[side] = {
      deployed,
      destroyed,
      dice: [],
      groups: [],
      batchPlan: [],
      batchesRolled: 0,
      advantages: { force: null, forceManual: false, port: false },
      escapedSubs: 0,
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
      const remaining = deployed - destroyed;
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
    total += Math.max(0, (s.deployed[nationId][uid] || 0) - (s.destroyed[nationId][uid] || 0));
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

// 对本方一批待分配骰子做自动分配；返回本批新增的组与作废骰子 id
export function autoAssign(state, side, diceIds) {
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
  const priority = ['red', 'green', 'blue', 'yellow'];
  for (const color of priority) {
    for (const t of targets.filter(function (x) { return x.color === color; })) {
      while (t.remaining > 0) {
        const needed = t.hitsRequired;
        const isSub = t.unit === 'submarine';
        const whiteCap = isSub ? 0 : Math.min(1, byColor.white.length);
        const base = byColor[color].length + byColor.black.length;
        if (base + whiteCap < needed) break;

        const picked = [];
        picked.push(...byColor[color].splice(0, needed - picked.length));
        picked.push(...byColor.black.splice(0, needed - picked.length));
        if (!isSub && picked.length < needed) {
          picked.push(...byColor.white.splice(0, needed - picked.length));
        }
        if (picked.length !== needed) {
          // 理论上不会发生；防御性放回
          break;
        }
        const group = {
          id: nextId('hit'),
          targetNation: t.nation,
          targetUnit: t.unit,
          color,
          needed,
          diceIds: picked.map(function (d) { return d.id; }),
        };
        for (const d of picked) {
          d.status = 'assigned';
          d.groupId = group.id;
        }
        groups.push(group);
        state.sides[enemySide].destroyed[t.nation][t.unit] += 1;
        t.remaining -= 1;
      }
    }
  }

  // 剩余未分配骰子作废
  for (const color of ['yellow', 'blue', 'green', 'red', 'black', 'white']) {
    for (const d of byColor[color]) d.status = 'miss';
  }

  // 潜艇逃离：仅海战海面阶段，每批结算后若敌方仍有存活潜艇则逃 1 艘
  if (field === 'sea' && state.stage === 'surface') {
    let subs = 0;
    const es = state.sides[enemySide];
    for (const nation of nationsFor(field)) {
      if (ALLIANCE_OF[nation.id] !== enemySide) continue;
      subs += Math.max(0, (es.deployed[nation.id].submarine || 0) - (es.destroyed[nation.id].submarine || 0));
    }
    if (subs > 0) es.escapedSubs += 1;
  }

  for (const g of groups) sideState.groups.push(g);
  return { groups, missIds: sideState.dice.filter(function (d) { return d.status === 'miss' && diceIds.includes(d.id); }).map(function (d) { return d.id; }) };
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
  const result = autoAssign(state, side, dice.map(function (d) { return d.id; }));
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
    if (die) { die.status = 'pending'; die.groupId = null; }
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
