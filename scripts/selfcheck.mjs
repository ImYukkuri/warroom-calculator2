// 确定性自检：规则数据 + 战斗引擎
import { D12_FACES } from '../js/data/rules-data.js';
import { nationsFor } from '../js/data/rules-data.js';
import { createBattle, diceCountFor, forceAdvantage, autoAssign, cancelGroup } from '../js/modules/engine.js';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failures += 1; console.error('FAIL', name, '-', e.message); }
}

check('D12 面数为 12', () => {
  if (D12_FACES.length !== 12) throw new Error('面数不是 12');
});

check('海战不含中国', () => {
  if (nationsFor('sea').some(n => n.id === 'china')) throw new Error('海战仍含中国');
  if (!nationsFor('land').some(n => n.id === 'china')) throw new Error('陆战缺少中国');
});

check('陆战空战骰数计算', () => {
  const s = createBattle('land');
  s.stage = 'air';
  s.sides.axis.deployed.germany.fighter = 1; // 3
  s.sides.axis.deployed.germany.bomber = 1;  // 1
  if (diceCountFor(s, 'axis', 'air') !== 4) throw new Error('空战骰数应为 4');
});

check('陆战陆面骰数计算（含存活空军）', () => {
  const s = createBattle('land');
  s.stage = 'surface';
  s.sides.axis.deployed.germany.fighter = 1; // 3
  s.sides.axis.deployed.germany.bomber = 1;  // 4
  s.sides.axis.deployed.germany.infantry = 1; // 1
  if (diceCountFor(s, 'axis', 'surface') !== 8) throw new Error('陆面骰数应为 8');
});

check('兵种优势：种类多的一方拥有', () => {
  const s = createBattle('land');
  s.stage = 'surface';
  s.sides.axis.deployed.germany.infantry = 1;
  s.sides.axis.deployed.germany.armor = 1;   // 轴心 2 种
  s.sides.allied.deployed.uk.infantry = 1;   // 同盟 1 种
  const fa = forceAdvantage(s);
  if (fa.axis !== true || fa.allied !== false) throw new Error('兵种优势判断错误');
});

check('自动分配：两绿消灭一架战斗机', () => {
  const s = createBattle('land');
  s.stage = 'air';
  s.sides.allied.deployed.uk.fighter = 1;
  s.sides.axis.dice.push(
    { id: 'd1', color: 'green', batch: 0, status: 'pending', groupId: null },
    { id: 'd2', color: 'green', batch: 0, status: 'pending', groupId: null },
  );
  const r = autoAssign(s, 'axis', ['d1', 'd2']);
  if (r.groups.length !== 1) throw new Error('应生成 1 组');
  if (s.sides.allied.destroyed.uk.fighter !== 1) throw new Error('战斗机应被击毁 1');
});

check('主力舰需三连', () => {
  const s = createBattle('sea');
  s.stage = 'surface';
  s.sides.allied.deployed.uk.battleship = 1;
  s.sides.axis.dice.push(
    { id: 'd1', color: 'red', batch: 0, status: 'pending', groupId: null },
    { id: 'd2', color: 'red', batch: 0, status: 'pending', groupId: null },
    { id: 'd3', color: 'red', batch: 0, status: 'pending', groupId: null },
  );
  autoAssign(s, 'axis', ['d1', 'd2', 'd3']);
  if (s.sides.allied.destroyed.uk.battleship !== 1) throw new Error('战列舰应被三连击毁');
});

check('潜艇逃离：奇数黄未配对逃 1 艘', () => {
  const s = createBattle('sea');
  s.stage = 'surface';
  s.sides.allied.deployed.uk.submarine = 2;
  s.sides.axis.dice.push({ id: 'd1', color: 'yellow', batch: 0, status: 'pending', groupId: null });
  autoAssign(s, 'axis', ['d1']);
  if ((s.sides.allied.escaped.uk || 0) !== 1) throw new Error('应逃离 1 艘潜艇');
});

check('潜艇逃离：无黄不逃', () => {
  const s = createBattle('sea');
  s.stage = 'surface';
  s.sides.allied.deployed.uk.submarine = 2;
  s.sides.axis.dice.push({ id: 'd1', color: 'red', batch: 0, status: 'pending', groupId: null });
  autoAssign(s, 'axis', ['d1']);
  if ((s.sides.allied.escaped.uk || 0) !== 0) throw new Error('无黄不应逃离');
});

check('取消命中回退骰子与击毁计数', () => {
  const s = createBattle('land');
  s.stage = 'air';
  s.sides.allied.deployed.uk.fighter = 1;
  s.sides.axis.dice.push(
    { id: 'd1', color: 'green', batch: 0, status: 'pending', groupId: null },
    { id: 'd2', color: 'green', batch: 0, status: 'pending', groupId: null },
  );
  const r = autoAssign(s, 'axis', ['d1', 'd2']);
  const gid = r.groups[0].id;
  const ok = cancelGroup(s, 'axis', gid);
  if (!ok) throw new Error('取消失败');
  if (s.sides.allied.destroyed.uk.fighter !== 0) throw new Error('击毁计数未回退');
  if (s.sides.axis.dice.some(d => d.status !== 'pending')) throw new Error('骰子未回退待分配');
});

// 压力系统（真实数据）
import { createPressureState, casualtyPoints, casualtyPointsToStress, casualtyStress, totalStress, zoneFor } from '../js/modules/pressure.js';

check('伤亡点数换算边界', () => {
  if (casualtyPointsToStress(0) !== 0) throw new Error('0 点应为 0 压力');
  if (casualtyPointsToStress(18) !== 0) throw new Error('18 点应为 0 压力');
  if (casualtyPointsToStress(19) !== 1) throw new Error('19 点应为 1 压力');
  if (casualtyPointsToStress(34) !== 1) throw new Error('34 点应为 1 压力');
  if (casualtyPointsToStress(35) !== 2) throw new Error('35 点应为 2 压力');
  if (casualtyPointsToStress(109) !== 6) throw new Error('109 点应为 6 压力');
});

check('压力：伤亡点数与 Zone', () => {
  const p = createPressureState();
  p.roundCasualties.germany.infantry = 10; // 10×2=20 伤亡点 → 1 压力
  if (casualtyPoints(p, 'germany') !== 20) throw new Error('伤亡点数应为 20');
  if (casualtyStress(p, 'germany') !== 1) throw new Error('击杀分压力应为 1');
  if (totalStress(p, 'germany') !== 1) throw new Error('总压力应为 1');
  if (zoneFor(p, 'germany') !== 0) throw new Error('德国阈值 6，1 压力应仍在白区');
});

if (failures > 0) {
  console.error(failures + ' 项自检失败');
  process.exitCode = 1;
} else {
  console.log('全部自检通过');
}
