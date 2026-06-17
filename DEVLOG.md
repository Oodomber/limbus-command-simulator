# 谨遵指令 (Limbus Command Simulator) — 开发日志

## 项目概述

基于《边狱巴士》游戏世界观，模拟"食指"组织下达"指令"的 Electron 桌面应用。用户在游玩镜牢模式时，软件生成指令并通过悬浮传呼机窗口展示。用户遵守/违抗指令被记录为"指令加护"与"业"，并解锁成就。

- **框架**: Electron v33 + 原生 HTML/CSS/JS
- **存储**: electron-store (config) + 直接 JSON 读写 (data)
- **入口**: `main.js` → 主进程，`renderer/` → 渲染进程
- **数据**: `data/` 下为随应用分发的静态 JSON；编辑后写入 `userData/data/`

---

## 目录结构

```
limbus-command-simulator/
├── main.js              # Electron 主进程：窗口管理、IPC、全局热键
├── preload.js           # contextBridge API（主窗口/传呼机两套接口）
├── src/
│   ├── dataLoader.js    # 数据加载：userData/data/ 优先 → 打包 data/ → 空默认
│   ├── engine.js        # 指令生成引擎（9个游戏环节）
│   ├── queueManager.js  # 指令队列管理 + 指引指令批量导航
│   ├── achievements.js  # 成就系统（JSON条件树 AND/OR/NOT）
│   └── soundManager.js  # 音效管理（桩实现，预留接口）
├── renderer/
│   ├── main.html        # 控制面板（5个标签页）
│   ├── overlay.html     # 传呼机悬浮窗（透明、置顶、无边框）
│   ├── history.html     # 指令历史页
│   ├── css/
│   │   ├── main.css     # 控制面板样式
│   │   └── overlay.css  # 传呼机样式
│   └── js/
│       ├── main.js      # 控制面板逻辑（~1700行）
│       ├── overlay.js   # 传呼机逻辑（打字机动画、导航）
│       └── history.js   # 历史页逻辑
├── data/                # 静态数据（打包分发）
│   ├── identities.json  # 179条人格
│   ├── egos.json        # 108条EGO
│   ├── relics.json      # 438条饰品
│   ├── starlight.json   # 10种星光
│   ├── cardpacks.json   # 29个卡包
│   ├── templates.json   # 指令模板（所有环节）
│   └── achievements.json # 15个初始成就
├── resources/           # 应用资源（图标、音效、参考图片）
└── tools/
    ├── fix-data.js      # 一次性数据修复脚本（已运行）
    └── patch-editor.js  # 编辑器代码补丁脚本
```

---

## 已完成功能清单

### 1. 双窗口架构
- **主窗口** (main.html)：控制面板，左侧导航，5个标签页
- **传呼机** (overlay.html)：透明无边框、始终置顶、可拖拽、可缩放
- 传呼机启动时隐藏，点击"谨遵指令"后显示
- 传呼机关闭按钮（✕）→ 最小化到任务栏
- F10 切换传呼机显示/隐藏（保持状态不重置）
- 应用退出时传呼机先播放关机动画再隐藏

### 2. 控制面板
- **人格管理**：表格展示（名称/罪人/稀有度/标签）、拥有勾选框
  - 筛选：罪人（游戏编号01-12排序）、稀有度、效果标签
  - 批量操作：全选/全不选/反选（编辑模式下作用于池成员）
  - 池管理：新建池（从已勾选创建）、编辑池（黄色保存栏）、快速加载（点击池标签）
  - 池列表在表格上方，胶囊样式，自动换行
- **EGO管理**：同人格管理的完整功能（池、筛选、批量操作）
- **环节启用**：10个环节复选框，2列网格布局
- **成就一览**：15个成就，显示进度/完成状态
- **设置页**：游戏模式、透明度/缩放滑块、音效开关、历史上限、导入/导出
- **指令历史**：独立窗口，可滚动，显示时间/环节/结果

### 3. 开始/结束流程
- 点击"谨遵指令" → 弹出池选择弹窗（选择人格池 + EGO池）
- 选择后正式启动，传呼机显示 `********` 等待态
- 进行中可点击"请求指令"或按 F9 弹出环节选择器
- 点击"结束指引" → 确认 → 传呼机关机动画 → 窗口隐藏
- 全局热键：F9(请求指令)、F10(切换传呼机)、F11(否决弹幕，预留)

### 4. 指令生成引擎 (`src/engine.js`)
- 9个环节：编队(人格/EGO)、星光、开局饰品、卡包、路线、战斗、事件、商店、隐藏BOSS
- 合理性(rationality) & 信息完整度(infoCompleteness)：随机参数影响指令
- 人格/EGO指令**严格从所选池中选取**（硬约束，非偏好）
- 编队指令为指引性质，**批量发送**到传呼机，支持上一条/下一条导航
- 其余指令排队显示，完成后统计加护/业

### 5. 传呼机交互
- 打字机动画（逐字显示 + 光标闪烁）
- 新指令到达金色光晕闪烁
- 指引指令：显示进度 `1/12`，◀上一条 / 下一条▶ / 完成阅读
- 普通指令：✓完成 / ✗失败 按钮
- 完成 → 加护+1 / 失败 → 业+5（全局累计同步更新）
- 键盘快捷键：Enter=完成，Esc=失败

### 6. 成就系统
- JSON条件树：AND/OR/NOT 逻辑组合
- 基础条件类型：clearMirror, blessingGlobal, karmaGlobal, completeInstruction, failInstruction 等
- 向后兼容字符串格式
- 每次状态更新时自动检测，解锁时弹窗通知（顶部居中）

### 7. 数据编辑器（开发者页面）
- 入口：左下角 ☝食指 图标三连击 → 密码 `dongxiongxianiao`
- 类型选择：人格/EGO/饰品/星光/卡包/模板/成就
- 搜索过滤 + 新增/删除记录
- 新增按罪人编号自动插入正确位置
- **人格编辑**：
  - id/name/sinner：文本框 | rarity：下拉(一灯/二灯/三灯)
  - tags.faction：文本框（顿号分隔）| tags.special：文本框
  - tags.effect：芯片选择（烧伤/流血/震颤/破裂/沉沦/呼吸/充能 + 自定义输入）
  - tags.damageType：芯片选择（打击/斩击/突刺 + 自定义）
  - tags.sinAffinity：芯片选择（暴怒/色欲/怠惰/暴食/忧郁/傲慢/嫉妒 + 自定义）
  - coreMechanic：芯片选择（烧伤/流血/震颤/破裂/沉沦/呼吸/充能 + 自定义）
- **EGO编辑**：id/name/sinner(文本)、level(下拉)、isBaseEgo(复选框)、damageType(芯片)、effect(芯片)、special(文本)、sinCost(数量输入含罪孽标签)
- **饰品编辑**：id/name(文本)、tier(下拉 I-V/EX)、effect/sinAffinity(芯片)、price(文本)
- **卡包编辑**：id/name(文本)、楼层复选框 + 模式复选框
- 保存写入 userData/data/，不修改打包数据
- 芯片交互：绿色=已选(点移除)、灰色+=候选(点添加)、虚线框=自定义(回车添加)

### 8. 数据处理
- 数据修复：identities.json 修复语法错误 + 生成 ID 字段
- 加载优先级：userData/data/ → 打包 data/ → 空默认
- 编辑保存写入 userData，不影响打包文件
- 数据导入/导出为 JSON

---

## 关键架构细节

### IPC 通道
- **invoke/handle (请求-响应)**: data:load, data:save, config:get/set, run:start/end, instruction:generate/complete, achievement:check, milestone:record
- **send/on (广播)**: pager:ready, pager:complete, pager:fail, pager:minimize, pager:guidance-next/prev/dismiss
- **Main→Renderer**: pager:show-instruction, pager:show-waiting, pager:update-stats, pager:shutdown, achievement:unlocked, run:state-changed

### 队列系统
- 指引指令（编队）：批量发送，overlay 显示导航按钮
- 普通指令：单条排队，队首处理完毕后自动出队显示下一条

### 池系统
- 人格池和 EGO 池独立管理
- 三种交互：新建（从勾选创建）、编辑（进入编辑模式修改）、快速加载（直接替换勾选）
- 开始镜牢时可分别选择人格池和 EGO 池

---

## 2026-06-13 更新

### 数据编辑器优化
- **tags.faction / tags.special 改为芯片输入**：原先使用文本框（顿号分隔），修改时卡顿严重。现已改为与其他标签属性一致的芯片选择器（预设标签 + 自定义输入），性能问题已修复。
- faction 预设：LCB罪人、LCB、边狱公司、收尾人、Seven协会、臼齿事务所、脑叶公司、剑契组、G公司、W公司、R公司、N公司、黑云会
- special 预设：空（仅自定义输入，不含预设标签）
- saveEditorData 中移除了 faction/special 的文本拆分逻辑（芯片系统直接维护数组）

### 数据同步
- **coreMechanic 同步脚本** (`tools/sync-core-mechanic.js`)：将人格 tags.effect 中的 7 种核心效果自动同步到 coreMechanic 数组。
- 首次运行更新 123 条，后续清空全部重同步 → 130 条
- 统一 `呼吸` → `呼吸法`：effect/coreMechanic 芯片预设及数据中全部统一，再次重同步 → **144 条** coreMechanic 已填充
- 剩余 35 条无核心效果的特征保持空数组

---

## 2026-06-14 更新

### Bug 修复：批量操作忽略筛选条件
- **问题**：筛选稀有度等条件后，点击"全选"/"全不选"/"反选"仍操作全部数据
- **修复**：提取 `getFilteredIdentities()` / `getFilteredEgos()`，批量操作改用过滤后的列表

### 编队人格指令生成逻辑重写
- **旧逻辑**：始终为 12 个罪人各生成 1 条指令；全局共用 infoCompleteness；根据队伍核心效果（coreMechanic）和 rationality 决定选取倾向
- **新逻辑**：
  - 从所选池中提取不重复的罪人，只对池中有人的罪人生成指令
  - 每条指令**独立随机**信息完整度（`Math.random()`）
  - 从池中该罪人的人格中**纯随机**选取，不再受 coreMechanic/rationality 影响
  - 精确模板：直接写人格名称；模糊模板：从该人格的阵营/效果/特殊标签中随机抽 1~3 个
- 同时去掉模板中的"不得违抗"（`templates.json` + `engine.js` 默认模板）

### 星光 ID 规范化
- ID 从英文（`star_strength` 等）改为 `starlight_01` ~ `starlight_10`

### 指引流程阶段化
- **关卡阶段状态机**：`deploy_identity` → `deploy_ego`(跳过) → `starlight` → `starting_relic` → `dungeon`(自由)
  - `getNextPhase()` 部署在主进程 `main.js`
  - 编队指引完成（dismiss）自动推进到星光
  - 非指引指令（星光/饰品）完成或失败后自动推进
  - EGO 环节因数据未校对暂时自动跳过

- **UI 锁定**：开始镜牢后锁定侧边栏标签页和筛选控件，仅保留"结束指引"和"请求指令"按钮
  - 半透明锁屏覆盖层（`#run-lock-overlay`）带脉冲动画
  - 结束指引时自动解锁

- **分阶段请求指令**：`showPhasePicker()` 根据当前 `runPhase` 动态显示可用环节
  - 开局阶段每步只显示当前环节
  - `starting_relic` 阶段可点击"跳过"按钮（或按 S 键）
  - 进入 `dungeon` 后自由选择 6 个地牢环节（卡包/路线/战斗/事件/商店/隐藏BOSS）

- **队伍核心机制显示（开发者功能）**：编队完成后，若在开发者菜单开启了"显示队伍核心机制"，弹出提示显示当前队伍的主流核心效果
  - 开发者菜单新增复选框 `settings.showCoreMechanic`
  - 核心机制统计逻辑在主进程 `run:get-team-mechanic` IPC 中

- **IPC 新增**：`run:get-phase` / `run:advance-phase` / `run:skip-phase` / `run:get-team-mechanic`
- **事件新增**：`run:phase-changed`（主进程→渲染进程）

---

### 功能调整 (2026-06-14)

- **累计加护/业显示**：侧边栏新增全局统计区域，显示累计指令加护和累计业
- **卡包序号替代**：`_genCardpack` 不再依赖卡包数据，用"第1~5个卡包"代替卡包名
- **事件选项限制**：`_genEvent` 选项仅限 1 或 2，用"第一个/第二个/倒数第一个/倒数第二个"表达
- **新增判定环节** (`judgment`)：随机从当前队伍/全部罪人中选取一名，下达判定指令
  - 加入地牢自由选择阶段、环节启用、模板文件
- 战斗和商店逻辑待用户审阅调整

### 下次继续
- 补回 EGO 编队环节（数据校对完成后）
- 图像识别 (Phase 10)

---

### 视觉资源替换 (2026-06-14)

- **Logo**：侧边栏、开发者弹窗、传呼机左上角的 ☝ 符号替换为 `resources/images/index.png`，fallback ☝
- **加护/业图标**：🛡️ → `指令加护.png`，🔥 → `业.png`，主页面和传呼机均替换

### 传呼机内嵌阶段选择弹窗

- **📟 按钮**：传呼机顶栏新增请求指令按钮，点击后在传呼机内弹出阶段选择窗口（不用切回主界面）
  - 金色边框风格，与传呼机统一
  - 数字键快速选择、S 跳过、Esc 关闭
  - 按钮锁定逻辑与主界面一致（生成指令后锁定，批次完成解锁）
- **修复 btnRequest 未声明**：变量声明被意外删除导致按钮完全不可用

### 阶段推进音效与 `sendPhaseChanged` 重构

- 7 处内联 `send('run:phase-changed', ...)` 提取为 `sendPhaseChanged()` 函数
- 阶段推进时播放 `stage_change.mp3`
- **修复递归死循环**：`sendPhaseChanged` 函数体被替换时写成了自调用

### 音效系统多次重构

- **最终方案**：主窗口和传呼机各自嵌入 `<audio>` 标签，相对路径直连 `resources/sounds/`
  - `bibi_long.mp3`：生成指令时播放
  - `bibi_short.mp3`：完成/失败指令时播放
  - `stage_change.mp3`：阶段推进时播放
- `SoundManager` 通过 IPC `pager:play-sound` 同时通知两个窗口
- 传呼机本地按钮点击有用户手势 → 直接播放；IPC 触发无手势 → 队列缓存到下次点击
- 清理了不存在的旧音效引用（`instruction_new.mp3`、`achievement_unlock.wav`）
- overlay 设 `webSecurity: false` 允许 file:// 音频加载

---

### Bug 修复 #2 — 按钮锁定与池选择 (2026-06-14)

- **移除"全部已拥有"选项**：`showRunStartModal()` 强制从人格池中选择，无池时提示创建，空池时拒绝启动
- **多指令批次锁定**：主进程新增 `pendingBatchRemaining` 计数器，非指引环节的每条指令完成/失败递减，仅当计数器归零才推进阶段并解锁按钮
  - 星光阶段 N 条指令：前 N-1 条完成后按钮保持锁定，全部完成才解锁
- **地牢阶段解锁**：新增 `instruction:processed` IPC 事件，地牢环节每条指令完成/失败后立即解锁按钮（因为地牢阶段不会触发 `phase-changed`）
- **`_isAnimating` 未重置**（上一轮遗漏点）：`_handleResult()` 中也加了 `this._isAnimating = false`

---

### Bug 修复 (2026-06-14)
- **单条编队指令无"完成阅读"按钮**：`overlay.js` 中 guidance nav 的显示条件从 `batchTotal > 1` 改为 `isGuidance` 即显示，单条时隐藏 prev/next 仅保留"完成阅读"
- **地牢阶段传呼机不显示**：`queueManager.js` 中 `_handleResult` 和 `_showWaiting` 未重置 `_isAnimating` 标志，导致后续指令无法出队
- **核心机制始终为空**：`main.js` 中 `instruction:generate` 在生成 `deploy_identity` 指令后未写入 `runState.currentTeam`，现已从指令 meta 中提取 `sinner → identityId` 映射填充队伍
- **请求指令后可重复点击刷新**：新增 `instructionPending` 标志，生成指令后锁定按钮（变灰），阶段推进（guidance dismiss / instruction complete）时自动解锁

---

---

## 已知限制与后续计划

1. **图像识别** (Phase 10)：模板匹配方案已设计，待实现
2. **弹幕互动** (Phase 11)：B站 WebSocket 连接预留，待实现
3. **音效** (Phase 8)：SoundManager 为桩实现，需添加真实音频文件
4. **像素字体**：传呼机目前使用等宽字体，可替换为像素风格字体
5. **打包** (Phase 12)：electron-builder 配置已完成，待构建测试
6. **EGO 的 sinCost 编辑**目前仅支持修改已有键值，不支持新增/删除罪孽类型
7. **饰品 price**：已通过浏览器端爬虫提取，445条全部有价格数据（范围 100-999）
8. **星光/模板/成就编辑器**：当前为通用文本编辑模式，可优化为专用界面

---

## 2026-06-16 更新

### 饰品数据全面更新

- **数据来源**：从 E.G.O饰品页面的45页分页卡片布局中爬取（`scrape_accessories.js` 浏览器Console脚本）
- **新的数据覆盖**：
  - **等级**：从卡片图标精确提取，分布为 I:58, II:141, III:133, IV:111, V:2
  - **罪孽属性**：从 span.label 的 background 颜色通过HSL色相判定，445/445 全覆盖（旧数据仅97条有）
  - **效果标签**：107种效果标签
  - **价格**：445/445 条有价格（范围 100-999，旧数据全部为 null）
- **数据量**：维持 445 条饰品（仅镜像迷宫），7 条新增

### 卡包数据全面更新

- **数据来源**：从 镜像迷宫-敌方数据 页面爬取（`scrape_cardpacks.js` 浏览器Console脚本）
- **数据量**：29 个 → **95 个卡包**（从两页合并去重）
- **字段**：name, availability(normal/hard/parallel/extreme)
- **覆盖**：hard 全覆盖 (95/95), normal 51个, parallel 45个, extreme 4个
- **ID生成**：MD5 hash 前缀 `pack_`

### 配置文件更新

- `data/relics.json`：438条 → 445条，等级/罪孽/价格字段全部补全
- `data/cardpacks.json`：29条 → 95条，从Wiki页面重新爬取
- `data/egos.json`：108条 → 109条，新增详情页技能标签 + attackCapacity/coinCount
- `data/relics.json`：438条 → 445条，等级/罪孽/价格字段全部补全
- `data/cardpacks.json`：29条 → 95条，从Wiki页面重新爬取

### Bug 修复

- **饰品编辑器下拉缺V级**：`main.js:1697`(patch-editor.js同步) `['I','II','III','IV','EX']` → `['I','II','III','IV','V','EX']`
- **编辑器 checkbox 保存 bug**：`saveEditorData` 中 `input.value` 对 checkbox 永远返回 `"on"`，改为 `input.type === 'checkbox' ? input.checked : input.value`
- **userData 旧缓存覆盖**：更新打包数据后需同步清理 `%APPDATA%/limbus-command-simulator/data/` 下对应旧文件

## 2026-06-17 更新

### 罪孽属性颜色映射修复

- **问题**：爬虫脚本 `scrape_accessories.js` 中的 `parseSin()` 使用 HSL 色相阈值判定罪孽属性，阈值边界重叠导致三类误判：
  - 怠惰 (h=0.099) → 误判为 色欲 (阈值 ≤0.10)
  - 傲慢 (h=0.582) → 误判为 忧郁 (阈值 ≤0.65)
  - 嫉妒 (h=0.779) → 误判为 傲慢 (阈值 ≤0.82)
- **修复**：改为 RGB 空间最近距离匹配，使用用户确认的标准色：
  - 暴怒 `#a0392b`、色欲 `#bb521f`、怠惰 `#e48801`、暴食 `#61822b`
  - 忧郁 `#306471`、傲慢 `#185188`、嫉妒 `#7d4e94`
- **数据更新**：重新爬取并转换，445 条饰品罪孽属性全部更新
  - 分布：色欲83 / 忧郁65 / 傲慢63 / 嫉妒63 / 暴食60 / 怠惰56 / 暴怒55
- **新增工具**：`tools/convert-scraped-relics.js` — 将浏览器端爬取JSON转为标准格式

### 指令生成逻辑重构

基于用户提供的完整镜牢流程说明，重构了指令生成引擎。

#### 环节流程变更
```
deploy_identity → deploy_ego → formation → starlight → starting_relic → cardpack → dungeon(自由)
```
地牢自由环节：cardpack, route, combat, event, event_reward, shop, hidden_boss, judgment, boss_reward

#### 主要变化

- **deploy_ego**：恢复为指引环节，为池中罪人生成EGO选择指令（每罪人最多4个/ZAYIN~WAW各一）
- **formation（新）**：指引环节，12罪人编队排序。独立置顶窗口（上6下6布局），支持拖拽交换，保存至runState供combat使用。EGO完成后自动弹出，传呼机📋按钮可重新打开
- **starlight**：纯随机选择（0~10个星光，每个1/2级强化）。4种特殊星光（星际旅行/流星雨/双星商店/全面可能性）联动影响后续阶段的饰品数量和卡包数量
- **starting_relic**：生成1~3条由星光决定（默认1+流星雨+1+全面可能性+1）
- **cardpack**：展示数量3~5（默认3+星际旅行+1+全面可能性+1）
- **combat**：新增上方技能/下方技能/使用EGO/金枝(PIGRITIA等4种，~2%概率）指令；仅对场上罪人（1-7号位）生成指令
- **event**：选项扩展至2~4个；描述方式增加上/下/倒数等方位描述
- **event_reward（新）**：遭遇战奖励卡独立环节；2~4张卡(I~VII级)，位置+类型描述
- **shop**：新增关键词刷新/替换技能/更换人格EGO/治疗操作
- **boss_reward（新）**：关底选择环节；普通3选1，困难（平行叠加）4选2

#### 修改文件
- `src/engine.js`：全阶段重写（+~200行）
- `main.js`：阶段流程/IPC/formation窗口/星光效果持久化
- `preload.js`：新增formation窗口API通道
- `data/templates.json`：新增12种模板
- `renderer/formation.html/js/css`（新）：编队窗口
- `renderer/js/main.js`：阶段列表更新
- `renderer/overlay.html/js`：📋编队按钮

### 下次继续

- 图像识别 (Phase 10)
- 编辑器 sinCost 支持新增/删除罪孽类型
- 弹幕互动 (Phase 11)

---

## 开发环境

- **Node.js**: v24.16.0
- **Electron**: v33.4.11
- **平台**: Windows 11
- **启动命令**: `npm start`
- **数据修复**: `node tools/fix-data.js`

---

## 数据文件来源

数据由 `D:\Projects\谨遵指令\数据爬取\` 下的 Python 爬虫脚本从 huijiwiki 抓取，经 `tools/fix-data.js` 修复后放入 `data/`。
