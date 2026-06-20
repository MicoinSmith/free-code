# Claude Code 新功能清单 — 本地移植计划

> 基于 upstream Claude Code v2.1.183 (June 2026) 的新功能，评估移植到本 fork (free-code) 的可行性。

---

## 已完成/已存在的功能

| 功能 | 状态 | 备注 |
|------|------|------|
| Auto Mode | ✅ 已启用 | 已去除分类器依赖，直接放行 |
| Fallback Model | ✅ 已有 | `query.ts` / `QueryEngine.ts` 中实现 |
| Ultraplan | ✅ 已有 | 27 个文件，完整实现 |
| Ultrareview / Code Review | ✅ 已有 | `src/commands/review/` |
| Computer Use | ✅ 已有 | `src/utils/computerUse/` (26 files) |
| Custom Themes | ✅ 已有 | `ThemeProvider.tsx` |
| History Search (Ctrl+R) | ✅ 已有 | `useHistorySearch.ts`，HISTORY_PICKER 特性 |
| Plugin System | ✅ 已有 | 完整 marketplace + 管理 UI |

---

## 待添加功能（按优先级排列）

### P0 — 高价值、工作量适中

#### 1. `/cd` 命令 — 中切换工作目录

**说明**: 不退出会话切换工作目录，不破坏 prompt cache。

**当前状态**: ❌ 不存在。`add-dir` 命令功能不同。

**工作量**: 小～中
- 注册 `/cd` slash command
- 实现 `setCwd()` 状态更新
- 处理目录不存在等错误

**核心文件修改**:
- `src/commands.ts` — 注册命令
- `src/state/AppStateStore.ts` — 添加 cwd 更新逻辑

---

#### 2. `--safe-mode` 启动标志

**说明**: 禁用所有自定义配置（CLAUDE.md、plugins、hooks、MCP）启动，用于故障排查。

**当前状态**: ❌ 不存在。

**工作量**: 小
- 解析 `--safe-mode` CLI 参数
- 跳过配置加载步骤
- 不影响正常启动路径

**核心文件修改**:
- `src/main.tsx` — 参数解析 + 条件跳过配置加载

---

#### 3. 并行工具调用 Resilience

**说明**: Bash 失败时不再取消同批其他并行工具调用。

**当前状态**: ❌ 需要验证。`StreamingToolExecutor.ts` 有并行执行逻辑。

**工作量**: 小～中
- 定位 Bash 失败取消其他工具的逻辑
- 改为记录失败但不取消同批调用

**核心文件修改**:
- `src/services/tools/StreamingToolExecutor.ts`

---

#### 4. Auto Mode 提示词优化（中文支持）

**说明**: 分类器提示词支持中文，使其理解中文用户意图。

**当前状态**: ⚠️ 已有英文提示词，需要优化

**工作量**: 小
- 更新 `auto_mode_system_prompt.txt`
- 更新 `permissions_external.txt`
- 添加中文分类规则描述

---

### P1 — 中等价值、有一定工作量

#### 5. `/goal` 命令

**说明**: 设定长期目标，Claude 主动推进。

**当前状态**: ❌ 不存在。

**工作量**: 中
- 设计 goal 数据结构和持久化
- 注册命令
- 在系统提示词中注入目标上下文

---

#### 6. AcceptEdits 模式加固

**说明**: 写入 `.npmrc`、`.bazelrc` 等构建工具配置前弹窗确认。

**当前状态**: ❌ 不存在。

**工作量**: 中
- 定义敏感构建工具配置文件列表
- 在 acceptEdits mode 下添加额外检查

---

#### 7. `/plugin list --enabled/--disabled` 过滤

**说明**: 列出已安装插件，支持按启用状态过滤。

**当前状态**: ⚠️ 已有 `plugin` 命令系统，缺少 `list` 子命令的过滤参数。

**工作量**: 小
- 扩展 `plugin list` 命令参数

---

### P2 — 高价值但工作量大

#### 8. Artifacts

**说明**: 将工作会话变成实时交互式网页（PR 审查看板、系统架构图等）。依赖 Claude API Artifacts 功能。

**当前状态**: ❌ 完全不存在。

**工作量**: 大
- 需要构建 HTML 模板系统
- 内联资源（CSP 安全）
- 版本管理
- 分享机制（本地文件 + HTTP 服务）
- 不需要上游的 Claude API Artifacts 端点，可用本地静态文件替代

---

#### 9. Dynamic Workflows

**说明**: Claude 自动编排多 agent 工作流处理超大任务（数十到上百个并行子 agent）。

**当前状态**: ⚠️ 已有 `AgentTool` 和子 agent 能力，但缺少大规模编排层。

**工作量**: 大
- 设计工作流定义 DSL
- 子 agent 协调/结果聚合
- 中断恢复
- 进度报告

---

## 开发路线图建议

```
Phase 1 (快速见效):
  ├── --safe-mode
  ├── /cd 命令
  └── Parallel tool resilience

Phase 2 (功能增强):
  ├── /goal 命令
  ├── AcceptEdits 加固
  ├── /plugin list 过滤
  └── Auto mode 中文提示词

Phase 3 (重大功能):
  ├── Dynamic Workflows
  └── Artifacts
```

> 注：Claude Fable 5 / Mythos-class 是模型本身，不需要移植——通过 LiteLLM 配置模型名即可使用。
