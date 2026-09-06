// 压力系统 DEMO 逻辑（占位数值待实体士气板数据替换）
import { NATIONS, UNIT_META } from '../data/rules-data.js';

export const ZONES = Object.freeze(['白', '蓝', '黄', '橙', '红', '灰']);

// TODO(DEMO)：以下三张表均为占位，需替换为实体士气板数据
export const DEMO_CASUALTY_FACTORS = Object.freeze(
  Object.fromEntries(Object.keys(UNIT_META).map(function (u) { return [u, 1]; }))
);
export const DEMO_THRESHOLDS = Object.freeze({
  germany: 5, italy: 5, japan: 5, uk: 5, usa: 5, ussr: 5, china: 5,
});

export function createPressureState() {
  const roundCasualties = {};
  const nations = {};
  for (const n of NATIONS) {
    roundCasualties[n.id] = {};
    for (const uid of Object.keys(UNIT_META)) roundCasualties[n.id][uid] = 0;
    nations[n.id] = { stress: 0, medals: 0, civilianGoods: 0, zone: 0 };
  }
  return { roundCasualties, nations };
}

export function addCasualties(p, casualties) {
  for (const nationId of Object.keys(casualties)) {
    for (const uid of Object.keys(casualties[nationId])) {
      p.roundCasualties[nationId][uid] = (p.roundCasualties[nationId][uid] || 0) + (casualties[nationId][uid] || 0);
    }
  }
}

export function casualtyPoints(p, nationId) {
  let pts = 0;
  const rc = p.roundCasualties[nationId] || {};
  for (const uid of Object.keys(rc)) {
    pts += rc[uid] * (DEMO_CASUALTY_FACTORS[uid] || 1);
  }
  return pts;
}

// TODO(DEMO)：占位换算 = 1 伤亡点 = 1 压力点
export function stressFromCasualties(p, nationId) {
  return casualtyPoints(p, nationId);
}

export function applyCasualtyStress(p) {
  for (const n of NATIONS) {
    p.nations[n.id].stress += stressFromCasualties(p, n.id);
  }
  // 转换后清空本回合战损（DEMO 行为）
  for (const n of NATIONS) {
    for (const uid of Object.keys(p.roundCasualties[n.id])) p.roundCasualties[n.id][uid] = 0;
  }
}

export function spendToCancel(p, nationId, kind) {
  const nat = p.nations[nationId];
  const key = kind === 'medal' ? 'medals' : 'civilianGoods';
  if (nat[key] > 0 && nat.stress > 0) {
    nat[key] -= 1;
    nat.stress -= 1;
    return true;
  }
  return false;
}

export function adjustZone(p, nationId, delta) {
  const nat = p.nations[nationId];
  nat.zone = Math.min(ZONES.length - 1, Math.max(0, nat.zone + delta));
}
