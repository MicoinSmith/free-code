# Claude Code 新功能清单 — 本地移植计划

> 基于 upstream Claude Code v2.1.183 (June 2026) 的新功能，评估移植到本 fork (free-code) 的可行性。

---

## 待添加功能（按优先级排列）

### P1 — 中等价值、有一定工作量

#### 1. `/plugin list --enabled/--disabled` 过滤

**说明**: 列出已安装插件，支持按启用状态过滤。

**当前状态**: ⚠️ 已有 `plugin` 命令系统，缺少 `list` 子命令的过滤参数。

**工作量**: 小
- 扩展 `plugin list` 命令参数

---

### P2 — 高价值但工作量大

#### 2. Artifacts

**说明**: 将工作会话变成实时交互式网页（PR 审查看板、系统架构图等）。依赖 Claude API Artifacts 功能。

**当前状态**: ❌ 完全不存在。

**工作量**: 大
- 需要构建 HTML 模板系统
- 内联资源（CSP 安全）
- 版本管理
- 分享机制（本地文件 + HTTP 服务）
- 不需要上游的 Claude API Artifacts 端点，可用本地静态文件替代

---

#### 3. Dynamic Workflows

**说明**: Claude 自动编排多 agent 工作流处理超大任务（数十到上百个并行子 agent）。

**当前状态**: ⚠️ 已有 `AgentTool` 和子 agent 能力，但缺少大规模编排层。

**工作量**: 大
- 设计工作流定义 DSL
- 子 agent 协调/结果聚合
- 中断恢复
- 进度报告

---

## 已完成功能

### P0 — 快速见效

#### 1. `/cd` 命令 — 中切换工作目录

**说明**: 不退出会话切换工作目录，不破坏 prompt cache。

**完成内容**:
- 注册 `/cd` slash command (`src/commands.ts`)
- 实现 `setCwd()` 状态更新 (`src/state/AppStateStore.ts`)
- 处理目录不存在等错误
- 添加目录自动补全（tab 补全）
- 分支: `feature/cd-command`

---

#### 2. `--safe-mode` 启动标志

**说明**: 禁用所有自定义配置（CLAUDE.md、plugins、hooks、MCP）启动，用于故障排查。

**完成内容**:
- 解析 `--safe-mode` CLI 参数 (`src/main.tsx`)
- 条件跳过配置加载
- 不影响正常启动路径

---

#### 3. 并行工具调用 Resilience

**说明**: Bash 失败时不再取消同批其他并行工具调用。

**完成内容**:
- 移除 `StreamingToolExecutor.ts` 中的 Bash 兄弟取消逻辑
- 移除 `siblingAbortController` 的 `sibling_error` 机制
- 加固 `generators.ts` 的 `all()` 函数，捕获异步生成器异常
- 各工具独立报告错误，互不影响

**核心文件修改**:
- `src/services/tools/StreamingToolExecutor.ts`
- `src/utils/generators.ts`

---

#### 4. Auto Mode 提示词优化（中文支持）

**说明**: 分类器提示词支持中文，使其理解中文用户意图。

**完成内容**:
- `auto_mode_system_prompt.txt` — 添加中文 ALLOW/BLOCK 分类描述
- `permissions_external.txt` — 添加中文段落标题和说明
- 双语提示词帮助分类器匹配中文用户命令

---

#### 5. `/goal` 命令

**说明**: 设定长期目标，Claude 主动推进。

**完成内容**:
- 支持 `add <text>`、`list`、`remove <n>`、`clear` 子命令，裸文本自动视为添加
- 持久化到 GlobalConfig (`~/.claude.json`)
- 每轮对话自动注入到 system prompt（通过 `clearUserContextCache()` 保证即时刷新）
- React Ink 组件渲染结果

**核心文件**:
- `src/commands/goal/index.ts` — 命令注册
- `src/commands/goal/goal.tsx` — 命令实现
- `src/utils/config.ts` — `goals` 字段
- `src/context.ts` — 注入系统上下文

---

#### 6. AcceptEdits 模式加固

**说明**: 写入 `.npmrc`、`.bazelrc` 等构建工具配置前弹窗确认。

**完成内容**:
- 将 `.npmrc`、`.bazelrc`、`.yarnrc`、`.yarnrc.yml` 加入 `DANGEROUS_FILES` 名单
- 安全检查（`checkPathSafetyForAutoEdit`）在 AcceptEdits 自动放行前执行，确保这些文件始终弹窗确认
- 所有权限模式（包括 AcceptEdits）均受影响

**核心文件修改**:
- `src/utils/permissions/filesystem.ts` — `DANGEROUS_FILES` 列表

---

### 已存在的上游功能

| 功能 | 备注 |
|------|------|
| Auto Mode | 已去除分类器依赖，直接放行 |
| Fallback Model | `query.ts` / `QueryEngine.ts` 中实现 |
| Ultraplan | 27 个文件，完整实现 |
| Ultrareview / Code Review | `src/commands/review/` |
| Computer Use | `src/utils/computerUse/` (26 files) |
| Custom Themes | `ThemeProvider.tsx` |
| History Search (Ctrl+R) | `useHistorySearch.ts`，HISTORY_PICKER 特性 |
| Plugin System | 完整 marketplace + 管理 UI |

---

## 开发路线图

```
待开始:
  ├── /plugin list 过滤
  ├── Dynamic Workflows
  └── Artifacts

已完成 (Phase 1):
  ├── --safe-mode
  ├── /cd 命令
  ├── Parallel tool resilience
  ├── Auto mode 中文提示词
  ├── /goal 命令
  └── AcceptEdits 加固
```

> 注：Claude Fable 5 / Mythos-class 是模型本身，不需要移植——通过 LiteLLM 配置模型名即可使用。
