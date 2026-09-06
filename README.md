# War Room 结算助手

用于线下桌游《War Room》结算的网页工具，规划功能：

- 掷骰：按 D12 色面分布与批次规则结算
- 伤害分配：按黄蓝绿红黑白顺序把命中分配到单位
- 全局压力记录：各国压力点数、勋章/民用物资抵消、士气 Zone 参考

当前阶段：**初始化完成，进入 P1 掷骰内核**。规则精编位于 `warroom_rules.txt`。

## 技术方案

| 项 | 决策 |
| --- | --- |
| 技术栈 | 原生 HTML + CSS + Vanilla JS（ES Modules） |
| 构建 | 无框架、无构建、无运行时依赖 |
| 部署 | GitHub Pages（HTTPS + 正确 MIME，ES Modules 兼容） |
| 本地预览 | 需要 HTTP 服务；`file://` 双击打开会被浏览器拦截 ES Modules |
| 文档语言 | 中文文档 + 中文注释 |

## 快速开始

本地预览（任选其一）：

~~~bash
# 方式一：Python
python -m http.server 8080
# 打开 http://localhost:8080/

# 方式二：VS Code
# 安装 Live Server 扩展后右键 index.html -> Open with Live Server
~~~

自检（可选，需要 Node.js）：

~~~bash
npm run selfcheck
~~~

部署到 GitHub Pages：

1. 把本目录作为仓库根目录推到 GitHub。
2. 仓库 Settings -> Pages -> Source 选择分支（如 `main`，根目录 `/`）。
3. 保存后访问 `https://<用户名>.github.io/<仓库名>/`。

## 目录结构

~~~
warroom2/
├── warroom_rules.txt        # 规则精编（只读参考，勿当完整规则书）
├── README.md                # 项目说明
├── task.md                  # 任务看板
├── progress.md              # 开发日志
├── AI_CONTEXT.md            # AI/新会话上下文
├── package.json             # 标记 ESM，提供 npm run selfcheck（无依赖）
├── scripts/
│   └── selfcheck.mjs        # 规则数据/掷骰内核确定性自检
├── index.html               # 应用入口
├── css/
│   └── style.css            # 全局样式
├── js/
│   ├── main.js              # 组合根：标签页切换、规则速查渲染
│   ├── data/
│   │   └── rules-data.js    # 规则静态数据（唯一数据源）
│   └── modules/
│       └── dice.js          # 掷骰内核（P1）
├── docs/
│   ├── 开发规范.md           # 开发约定
│   └── 任务要求.md           # 功能需求与验收
└── assets/
    └── README.md            # 棋盘图片等资源占位说明
~~~

## 路线图

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| P0 | 项目初始化与文档框架 | ✅ 已完成 |
| P1 | 掷骰内核 | 🔨 进行中 |
| P2 | 快速战斗伤害分配 | ⬜ 待开始 |
| P3 | 标准战棋盘模式 | ⬜ 待开始 |
| P4 | 全局压力记录 | ⬜ 待开始 |
| P5 | 战斗善后检查清单 | ⬜ 待开始 |
| P6 | 打磨与发布 | ⬜ 待开始 |

## 数据来源

静态规则数据来自 `warroom_rules.txt`。其中陆/海战斗值与 D12 色面分布等表后续可能要用实体棋盘图片核对，详见 `docs/任务要求.md`。
