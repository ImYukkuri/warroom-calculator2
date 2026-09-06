# AI 上下文（给 AI 助手 / 新会话）

读这个文件可快速恢复项目上下文。实现前先看 `task.md` 和 `progress.md`。

## 项目是什么

线下桌游《War Room》结算助手：网页工具，覆盖掷骰、伤害分配、全局压力记录。规则精编在 `warroom_rules.txt`（682 行，非完整规则书）。

## 技术决策（已定）

- 原生 HTML + CSS + Vanilla JS（ES Modules）。
- 无框架、无构建、无第三方运行时依赖。
- 部署 GitHub Pages；本地预览必须 HTTP 服务（`python -m http.server 8080` 或 Live Server）。
- 不要依赖 `file://`（ES Modules 会被拦截）。
- 中文文档、中文注释。

## 常用命令

~~~bash
python -m http.server 8080   # 打开 http://localhost:8080/
npm run selfcheck            # 运行规则数据/掷骰内核自检
~~~

## 目录地图

- `index.html`：应用壳入口。
- `package.json`：无依赖，标记 ESM，提供自检命令。
- `scripts/selfcheck.mjs`：规则数据/掷骰内核自检。
- `js/main.js`：组合根（标签页、规则速查渲染）。
- `js/data/rules-data.js`：规则静态数据唯一源。
- `js/modules/dice.js`：掷骰内核。
- `docs/开发规范.md`：代码/协作约定。
- `docs/任务要求.md`：分阶段需求与验收。
- `task.md`：任务看板。
- `progress.md`：开发日志。

## 关键领域数据

- D12 色面：白 1、黑 1、红 1、绿 2、蓝 3、黄 4（`§14`）。
- 伤害分配颜色顺序：黄 → 蓝 → 绿 → 红 → 黑 → 白（`§8`）。
- 批次：每批最多 10 骰，最后一批可不足 10；每阶段每方最多 30 骰（`§8`）。
- 战斗阶段：Air Battle Stage → 袭击 → Surface Battle Stage → 善后。
- 快速战斗：按颜色配对，黑白万能，白每单位限 1 次；战列舰/航母需 3 击；潜艇白骰无效、奇数黄未配对逃离（`§13`）。
- 标准战斗状态：Initial / Lightly Damaged / Damaged / Eliminated / Dive。
- 士气/压力：压力来源、勋章 1:1 抵消、阈值升格 Zone（`§12`）。

## 已安装技能

- `frontend-design`（Anthropic 官方，`.agents/skills/frontend-design/`）：做 UI 前先加载该技能，按其视觉设计方法论执行。

## 当前状态（P1）

- 掷骰内核基础函数已建，骰子面板 UI 尚未实现。
- 下一任务：骰子面板 + 确定性自测 + 手测清单。

## 约束与陷阱

- `warroom_rules.txt` 是精简参考，OCR 中士气换算表等数值缺失，遇到需玩家补充的数据必须标 TODO 并记录。
- 颜色展示必须带中文文字标签，不能只靠色块。
- 规则与实体棋盘冲突时，先记录差异，不静默覆盖。
- 不要在 `js/data/rules-data.js` 里写业务逻辑或 DOM 操作。
