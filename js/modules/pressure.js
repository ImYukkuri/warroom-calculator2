// 压力系统逻辑（真实数据）
import { NATIONS } from '../data/rules-data.js';

export const ZONES = Object.freeze(['白', '蓝', '黄', '橙', '红', '灰']);
export const ZONE_EFFECTS = Object.freeze([
  '无惩罚',
  '如可支付，必须支付任意 3 资源',
  '铁路本国及盟友不可用；无海运贸易；港口不提供港口优势（仍可部署）',
  '战略规划阶段少 3 条命令',
  '不可新增资源；现有资源仍可花/损失',
  '从世界地图移入伤亡表的单位数 = 当前压力点（不含在建单位与舰载机）；压力点不因逃兵减少',
]);

// 7 国压力阈值（soviet 即 ussr）
export const NATION_STRESS_THRESHOLDS = Object.freeze({
  germany: 6, japan: 7, italy: 4, uk: 6, ussr: 6, usa: 5, china: 4,
});

// 单位伤亡点数系数（轰炸机普通/战略均为 6）
export const CASUALTY_FACTORS = Object.freeze({
  infantry: 2, artillery: 2, armor: 4, fighter: 4, bomber: 6, bomber_strategic: 6,
  submarine: 6, cruiser: 10, battleship: 20, carrier: 20,
});

// 伤亡点数 → 压力点数换算表
const CONVERSION = Object.freeze([
  [0, 18, 0], [19, 34, 1], [35, 50, 2], [51, 68, 3], [69, 88, 4], [89, 108, 5], [109, Infinity, 6],
]);

export function casualtyPointsToStress(points) {
  for (const [lo, hi, stress] of CONVERSION) {
    if (points >= lo && points <= hi) return stress;
  }
  return 0;
}

export function createPressureState() {
  const roundCasualties = {};
  const nations = {};
  for (const n of NATIONS) {
    roundCasualties[n.id] = {};
    for (const uid of Object.keys(CASUALTY_FACTORS)) roundCasualties[n.id][uid] = 0;
    nations[n.id] = {
      previousRoundStress: 0,
      contestedTerritory: 0,
      medals: 0, // 勋章/战略物资分（净分，可为负）
    };
  }
  return { roundCasualties, nations, adjustmentLog: [], log: [], round: 1 };
}

export function addCasualties(p, casualties) {
  for (const nationId of Object.keys(casualties || {})) {
    const rc = p.roundCasualties[nationId];
    if (!rc) continue;
    for (const uid of Object.keys(casualties[nationId])) {
      rc[uid] = Math.max(0, (rc[uid] || 0) + (casualties[nationId][uid] || 0));
    }
  }
}

export function casualtyPoints(p, nationId) {
  const rc = p.roundCasualties[nationId] || {};
  let pts = 0;
  for (const uid of Object.keys(rc)) pts += (rc[uid] || 0) * (CASUALTY_FACTORS[uid] || 0);
  return pts;
}

export function casualtyStress(p, nationId) {
  return casualtyPointsToStress(casualtyPoints(p, nationId));
}

export function thisRoundAdded(p, nationId) {
  const nat = p.nations[nationId];
  return casualtyStress(p, nationId) + nat.contestedTerritory + nat.medals;
}

export function totalStress(p, nationId) {
  return p.nations[nationId].previousRoundStress + thisRoundAdded(p, nationId);
}

export function zoneFor(p, nationId) {
  const threshold = NATION_STRESS_THRESHOLDS[nationId] || 1;
  let stress = totalStress(p, nationId);
  let zone = 0;
  while (stress >= threshold && zone < ZONES.length - 1) {
    stress -= threshold;
    zone += 1;
  }
  return zone;
}

export function adjustScore(p, nationId, kind, delta) {
  const nat = p.nations[nationId];
  if (kind === 'territory') nat.contestedTerritory += delta;
  else if (kind === 'medals') nat.medals += delta;
}

export function roundCasualtyOverview(p, nationId) {
  const rc = p.roundCasualties[nationId] || {};
  const items = [];
  for (const uid of Object.keys(rc)) {
    const count = rc[uid] || 0;
    if (count > 0) {
      const factor = CASUALTY_FACTORS[uid] || 0;
      items.push({ unit: uid, count, factor, points: factor * count });
    }
  }
  return items;
}

export function newRound(p) {
  for (const n of NATIONS) {
    const nat = p.nations[n.id];
    nat.previousRoundStress = totalStress(p, n.id);
    nat.contestedTerritory = 0;
    nat.medals = 0;
    const rc = p.roundCasualties[n.id] || {};
    for (const uid of Object.keys(rc)) rc[uid] = 0;
  }
  p.adjustmentLog = [];
  p.log = [];
  p.round = (p.round || 1) + 1;
}
