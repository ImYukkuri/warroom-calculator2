// 规则静态数据（唯一数据源）
// 来源：rules_cn.txt（快速结算中文规则）+ warroom_rules.txt（英文精简版）。
// 本文件只放数据与查找表，不写业务逻辑、不操作 DOM。

// 规则 §14：D12 色面分布（白1、黑1、红1、绿2、蓝3、黄4）
export const D12_FACES = Object.freeze([
  'white',
  'black',
  'red',
  'green',
  'green',
  'blue',
  'blue',
  'blue',
  'yellow',
  'yellow',
  'yellow',
  'yellow',
]);

// 伤害分配颜色顺序（规则 §8）
export const COLOR_ORDER = Object.freeze(['yellow', 'blue', 'green', 'red', 'black', 'white']);

export const COLOR_LABELS = Object.freeze({
  white: '白',
  black: '黑',
  red: '红',
  green: '绿',
  blue: '蓝',
  yellow: '黄',
});

export const BATCH_SIZE = 10;
export const MAX_DICE = 30;
export const SIDES = Object.freeze(['axis', 'allied']);

export const NATIONS = Object.freeze([
  { id: 'germany', name: '德国', alliance: 'axis', flag: 'ger.png' },
  { id: 'italy', name: '意大利', alliance: 'axis', flag: 'ita.png' },
  { id: 'japan', name: '日本', alliance: 'axis', flag: 'jpn.png' },
  { id: 'uk', name: '英国', alliance: 'allied', flag: 'uk.png' },
  { id: 'usa', name: '美国', alliance: 'allied', flag: 'usa.png' },
  { id: 'ussr', name: '苏联', alliance: 'allied', flag: 'ussr.png' },
  { id: 'china', name: '中国', alliance: 'allied', flag: 'chn.png' },
]);

export const ALLIANCE_OF = Object.freeze(
  NATIONS.reduce(function (acc, n) { acc[n.id] = n.alliance; return acc; }, {})
);

// 兵种元数据：颜色、命中所需骰面数（普通 2 / 主力舰 3）、类别
export const UNIT_META = Object.freeze({
  fighter: { name: '战斗机', category: 'air', color: 'green', hitsRequired: 2 },
  bomber: { name: '轰炸机', category: 'air', color: 'red', hitsRequired: 2 },
  bomber_strategic: { name: '轰炸机·战略', category: 'air', color: 'red', hitsRequired: 2, mergeInto: 'bomber' },
  infantry: { name: '步兵', category: 'land', color: 'yellow', hitsRequired: 2 },
  artillery: { name: '炮兵', category: 'land', color: 'blue', hitsRequired: 2 },
  armor: { name: '装甲', category: 'land', color: 'green', hitsRequired: 2 },
  submarine: { name: '潜艇', category: 'sea', color: 'yellow', hitsRequired: 2 },
  cruiser: { name: '巡洋舰', category: 'sea', color: 'blue', hitsRequired: 2 },
  carrier: { name: '航母', category: 'sea', color: 'green', hitsRequired: 3 },
  battleship: { name: '战列舰', category: 'sea', color: 'red', hitsRequired: 3 },
});

// 快速战斗值：{ air: 空战值, surface: 陆面/海面值, strategic: 战略轰炸骰/架 }
export const COMBAT_VALUES = Object.freeze({
  land: Object.freeze({
    bomber_strategic: { air: 1, surface: 0, strategic: 4 },
    bomber: { air: 1, surface: 4, strategic: 0 },
    fighter: { air: 3, surface: 3, strategic: 0 },
    armor: { air: 1, surface: 3 },
    artillery: { air: 3, surface: 2 },
    infantry: { air: 0, surface: 1 },
  }),
  sea: Object.freeze({
    bomber: { air: 1, surface: 3 },
    fighter: { air: 3, surface: 2 },
    battleship: { air: 3, surface: 4 },
    carrier: { air: 2, surface: 2 },
    cruiser: { air: 3, surface: 3 },
    submarine: { air: 0, surface: 2 },
  }),
});

// 每个战场下：空军区常显；陆/海面区随战场切换
export const FIELD_UNITS = Object.freeze({
  land: Object.freeze({ air: ['fighter', 'bomber', 'bomber_strategic'], surface: ['armor', 'artillery', 'infantry'] }),
  sea: Object.freeze({ air: ['fighter', 'bomber'], surface: ['submarine', 'cruiser', 'carrier', 'battleship'] }),
});

// 每个阶段可被命中的兵种（与 FIELD_UNITS 一致，语义上表示“合法目标”）
export const STAGE_TARGETS = Object.freeze({
  land: Object.freeze({ air: ['fighter', 'bomber', 'bomber_strategic'], surface: ['armor', 'artillery', 'infantry'] }),
  sea: Object.freeze({ air: ['fighter', 'bomber'], surface: ['submarine', 'cruiser', 'carrier', 'battleship'] }),
});

// 兵种优势：只比较陆/海军单位种类（空军不算）
export const FORCE_ADVANTAGE_UNITS = Object.freeze({
  land: ['infantry', 'artillery', 'armor'],
  sea: ['submarine', 'cruiser', 'carrier', 'battleship'],
});

// 战略轰炸结果表（§9，仅提示桌面操作，不结算资源）
export const STRATEGIC_BOMBING_RESULTS = Object.freeze({
  yellow: '摧毁 1 个在建步兵/潜艇，或使敌方损失 1 OSR',
  blue: '摧毁 1 个在建炮兵/巡洋舰，或使敌方损失 1 Iron',
  green: '摧毁 1 个在建装甲/航母/战斗机',
  red: '摧毁 1 个在建轰炸机/战列舰，或使敌方损失 1 Oil',
  white: '所有基础设施受损：加 1 个 Bomb Token（港口/铁路等）',
  black: '由玩家选择以上任意一项',
});

// 某战场下参与战斗的国家（海战不含中国）
export function nationsFor(battlefield) {
  return NATIONS.filter(function (n) {
    return !(battlefield === 'sea' && n.id === 'china');
  });
}

export function unitIdsFor(battlefield) {
  return FIELD_UNITS[battlefield].air.concat(FIELD_UNITS[battlefield].surface);
}
