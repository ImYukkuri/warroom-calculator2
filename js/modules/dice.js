// 掷骰内核（P1 基础实现）
// 规则来源：warroom_rules.txt §8、§14。
// 说明：随机源可注入，便于用固定随机序列做确定性自测。

import { BATCH_SIZE, D12_FACES, MAX_DICE } from '../data/rules-data.js';

// 校验骰数：整数、非负、不超过单阶段上限
export function assertDiceCount(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('骰数必须是大于等于 0 的整数');
  }
  if (count > MAX_DICE) {
    throw new Error('每阶段每方最多 ' + MAX_DICE + ' 骰，超出部分应忽略');
  }
}

// 按每批 batchSize 拆批；最后一批可不足 batchSize
export function splitBatches(total, batchSize = BATCH_SIZE) {
  assertDiceCount(total);
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('批次大小必须是正整数');
  }
  const batches = [];
  let remaining = total;
  while (remaining > 0) {
    const size = Math.min(remaining, batchSize);
    batches.push(size);
    remaining -= size;
  }
  return batches;
}

// 掷 count 枚 D12，返回颜色数组
export function rollDice(count, random = Math.random) {
  assertDiceCount(count);
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(random() * D12_FACES.length);
    results.push(D12_FACES[index]);
  }
  return results;
}

// 颜色归组：{ white: n, black: n, ... }
export function groupByColor(results) {
  return results.reduce(function (acc, color) {
    acc[color] = (acc[color] ?? 0) + 1;
    return acc;
  }, {});
}

// 一次完成“拆批 + 掷骰”：返回 [{ size, results }, ...]
export function rollInBatches(total, random = Math.random, batchSize = BATCH_SIZE) {
  return splitBatches(total, batchSize).map(function (size) {
    return { size, results: rollDice(size, random) };
  });
}
