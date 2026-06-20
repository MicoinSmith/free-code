import React from 'react'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { Text } from '../../ink.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { topologicalSort, getReadySteps } from './scheduler.js'
import type { WorkflowStepDef, WorkflowStepResult } from './types.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    steps: z
      .array(
        z.strictObject({
          id: z
            .string()
            .min(1)
            .describe('Unique identifier for this step'),
          prompt: z
            .string()
            .min(1)
            .describe(
              'Instruction for the agent executing this step. Dependency results are injected before this prompt.',
            ),
          agentType: z
            .string()
            .optional()
            .default('general-purpose')
            .describe(
              "Agent type: 'general-purpose' (default), 'Explore', 'Plan', etc.",
            ),
          dependsOn: z
            .array(z.string())
            .optional()
            .describe('Step IDs this step depends on'),
          description: z
            .string()
            .optional()
            .describe('Human-readable description of this step'),
        }),
      )
      .min(1)
      .max(25)
      .describe('Array of workflow steps to execute (1-25)'),
    maxConcurrency: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe('Maximum number of steps to run in parallel (1-10)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.enum(['completed', 'failed', 'partial']).describe(
      `completed: all steps succeeded
failed: all steps failed
partial: some steps succeeded, some failed`,
    ),
    summary: z.string().describe('Human-readable summary of the workflow run'),
    stepResults: z
      .array(
        z.object({
          id: z.string(),
          status: z.enum(['completed', 'failed', 'skipped']),
          summary: z.string(),
          error: z.string().optional(),
        }),
      )
      .describe('Results for each step'),
    failedSteps: z
      .array(z.string())
      .describe('IDs of steps that failed or were skipped'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Types used by executeStep (dynamic requires avoid circular deps)
type ToolUseContext = import('../../Tool.js').ToolUseContext

/**
 * Build a step prompt that includes dependency results as context.
 */
function buildStepPrompt(
  step: WorkflowStepDef,
  stepResults: Map<string, WorkflowStepResult>,
): string {
  const deps = step.dependsOn ?? []
  if (deps.length === 0) return step.prompt

  const contextBlocks: string[] = []
  for (const depId of deps) {
    const depResult = stepResults.get(depId)
    if (!depResult || depResult.status !== 'completed') continue
    contextBlocks.push(
      `<dependency-step id="${depId}">\n${depResult.summary}\n</dependency-step>`,
    )
  }

  if (contextBlocks.length === 0) return step.prompt

  return `Context from completed dependency steps:\n\n${contextBlocks.join('\n\n')}\n\n---\n\n${step.prompt}`
}

/**
 * Build a human-readable summary of the workflow result.
 */
function buildSummary(results: WorkflowStepResult[]): string {
  const total = results.length
  const succeeded = results.filter(r => r.status === 'completed').length
  const failed = results.filter(r => r.status === 'failed').length
  const skipped = results.filter(r => r.status === 'skipped').length

  const lines: string[] = [
    `Workflow completed: ${succeeded}/${total} steps succeeded`,
  ]
  if (failed > 0) lines.push(`${failed} step(s) failed`)
  if (skipped > 0) lines.push(`${skipped} step(s) skipped due to upstream failures`)

  for (const r of results) {
    const icon = r.status === 'completed' ? '✓' : r.status === 'failed' ? '✗' : '—'
    const err = r.error ? ` (${r.error})` : ''
    lines.push(`  ${icon} ${r.id}: ${r.status}${err}`)
  }

  lines.push('\nStep details:')
  for (const r of results) {
    lines.push(`\n[${r.id}] (${r.status}):`)
    lines.push(r.summary)
  }

  return lines.join('\n')
}

/**
 * Render a live progress table showing each step's status.
 */
function renderProgressTable(
  steps: WorkflowStepDef[],
  results: Map<string, WorkflowStepResult>,
  inProgress: Set<string>,
): React.ReactNode {
  const lines: string[] = [`Workflow steps (${results.size}/${steps.length}):`]
  for (const step of steps) {
    const r = results.get(step.id)
    if (r) {
      const icon = r.status === 'completed' ? '✓' : r.status === 'failed' ? '✗' : '—'
      lines.push(`  ${icon} ${step.id} ${r.status}`)
    } else if (inProgress.has(step.id)) {
      lines.push(`  ● ${step.id} running...`)
    } else {
      lines.push(`  ○ ${step.id} pending`)
    }
  }
  return <Text>{lines.join('\n')}</Text>
}

/**
 * Execute a single workflow step using runAgent.
 * Uses dynamic requires to avoid circular dependency chains.
 */
async function executeStep(
  step: WorkflowStepDef,
  stepResults: Map<string, WorkflowStepResult>,
  context: ToolUseContext,
  canUseTool: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
): Promise<WorkflowStepResult> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createSubagentContext } = require('../../utils/forkedAgent.js') as typeof import('../../utils/forkedAgent.js')
  const { runAgent } = require('../AgentTool/runAgent.js') as typeof import('../AgentTool/runAgent.js')
  const { resolveAgentTools } = require('../AgentTool/agentToolUtils.js') as typeof import('../AgentTool/agentToolUtils.js')
  const { assembleToolPool } = require('../../tools.js') as typeof import('../../tools.js')
  const { extractTextContent } = require('../../utils/messages.js') as typeof import('../../utils/messages.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const agentType = step.agentType || 'general-purpose'
  const appState = context.getAppState()
  const activeAgents = context.options.agentDefinitions.activeAgents

  // Find agent definition
  const agentDef = activeAgents.find(a => a.agentType === agentType)
  if (!agentDef) {
    return {
      id: step.id,
      status: 'failed' as const,
      summary: '',
      error: `Agent type "${agentType}" not found`,
    }
  }

  // Build tool pool for the subagent
  const workerPermissionContext = {
    ...appState.toolPermissionContext,
    mode: (agentDef as Record<string, unknown>).permissionMode as string ?? 'acceptEdits',
  }
  const fullTools = assembleToolPool(
    workerPermissionContext,
    appState.mcp.tools ?? [],
  )
  const { resolvedTools } = resolveAgentTools(agentDef, fullTools, false)

  // Build prompt with dependency context
  const promptText = buildStepPrompt(step, stepResults)
  const promptMessages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: promptText },
      ],
    },
  ]

  // Create isolated context for the subagent
  const stepContext = createSubagentContext(context)

  // Run the agent and consume all messages
  const messages: Array<unknown> = []
  try {
    const iterator = runAgent({
      agentDefinition: agentDef,
      promptMessages,
      toolUseContext: stepContext,
      canUseTool,
      isAsync: false,
      querySource: `workflow:${step.id}`,
      availableTools: resolvedTools,
    })[Symbol.asyncIterator]()

    while (true) {
      const { done, value } = await iterator.next()
      if (done) break
      messages.push(value)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      id: step.id,
      status: 'failed' as const,
      summary: '',
      error: message,
    }
  }

  // Extract result text from last assistant message
  let summary = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: Array<{ type: string; text: string }> }
    if (msg.role === 'assistant' && msg.content) {
      summary = msg.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
      break
    }
  }

  return {
    id: step.id,
    status: 'completed' as const,
    summary: summary || 'Step completed (no text output)',
  }
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  aliases: ['DagWorkflow', 'ParallelWorkflow'],
  searchHint: 'parallel agent orchestration dag workflow',
  maxResultSizeChars: 500_000,
  async prompt() {
    return `Execute a DAG workflow of multiple agents in parallel.

Use this when a complex task can be broken into independent sub-tasks with dependencies. Each step runs as its own agent with full tool access.

Example: research multiple approaches in parallel, then synthesize results.

Steps with no dependencies run in parallel. A step waits for all its dependencies to complete before starting. Results from completed dependencies are automatically injected as context.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isEnabled() {
    return true
  },
  mapToolResultToToolResultBlockParam(
    content: { status: string; summary: string; stepResults: WorkflowStepResult[]; failedSteps: string[] },
    toolUseID: string,
  ) {
    const text = `[Workflow ${content.status}]\n${content.summary}`
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: text }
  },
  async call(
    { steps, maxConcurrency }: { steps: WorkflowStepDef[]; maxConcurrency: number },
    context: ToolUseContext,
    canUseTool: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
    _parentMessage: unknown,
    onProgress?: (p: { toolUseID: string; data: Record<string, unknown> }) => void,
  ) {
    // Validate step id uniqueness
    const ids = new Set<string>()
    for (const step of steps) {
      if (ids.has(step.id)) {
        return {
          data: {
            status: 'failed' as const,
            summary: `Duplicate step ID: ${step.id}`,
            stepResults: [],
            failedSteps: [step.id],
          },
        }
      }
      ids.add(step.id)
    }

    // Validate dependency references
    for (const step of steps) {
      for (const dep of step.dependsOn ?? []) {
        if (!ids.has(dep)) {
          return {
            data: {
              status: 'failed' as const,
              summary: `Step "${step.id}" depends on unknown step "${dep}"`,
              stepResults: [],
              failedSteps: [step.id],
            },
          }
        }
      }
    }

    // Cycle detection via topological sort
    try {
      topologicalSort(steps)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      return {
        data: {
          status: 'failed' as const,
          summary: message,
          stepResults: [],
          failedSteps: steps.map(s => s.id),
        },
      }
    }

    // Execute the DAG
    const allStepResults = new Map<string, WorkflowStepResult>()
    const inProgress = new Set<string>()
    const skipSet = new Set<string>()

    while (allStepResults.size < steps.length) {
      const ready = getReadySteps(steps, new Set(allStepResults.keys()), inProgress)

      if (ready.length === 0 && inProgress.size === 0) {
        // All remaining steps are blocked by failures
        for (const step of steps) {
          if (!allStepResults.has(step.id) && !skipSet.has(step.id)) {
            skipSet.add(step.id)
            allStepResults.set(step.id, {
              id: step.id,
              status: 'skipped' as const,
              summary: 'Skipped due to upstream step failure',
            })
          }
        }
        break
      }

      // Limit ready steps to maxConcurrency
      const batch = ready.slice(0, maxConcurrency)
      for (const s of batch) inProgress.add(s.id)

      // Report progress: show which steps are running
      if (context.setToolJSX) {
        context.setToolJSX({
          jsx: renderProgressTable(steps, allStepResults, inProgress),
          shouldHidePromptInput: false,
          showSpinner: true,
          shouldContinueAnimation: true,
        })
      }
      if (onProgress) {
        onProgress({
          toolUseID: '',
          data: {
            type: 'workflow_progress',
            running: batch.map(s => s.id),
            completed: [...allStepResults.keys()],
          },
        })
      }

      // Execute batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(step => executeStep(step, allStepResults, context, canUseTool)),
      )

      for (const settled of batchResults) {
        if (settled.status === 'fulfilled') {
          const r = settled.value
          allStepResults.set(r.id, r)
        } else {
          // Promise.allSettled rejection — should not happen since executeStep catches all errors
          // but handle defensively
          const errMsg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
          // We lost the step id here, skip — the DAG loop will detect the stall and skip remaining
          // This is a fallback for truly unexpected crashes
        }
      }
      inProgress.clear()

      // Update progress after batch completes
      if (context.setToolJSX) {
        context.setToolJSX({
          jsx: renderProgressTable(steps, allStepResults, inProgress),
          shouldHidePromptInput: false,
          showSpinner: true,
          shouldContinueAnimation: true,
        })
      }
      if (onProgress) {
        onProgress({
          toolUseID: '',
          data: {
            type: 'workflow_progress',
            completed: [...allStepResults.keys()],
            remaining: steps.filter(s => !allStepResults.has(s.id)).map(s => s.id),
          },
        })
      }
    }

    const stepResults = [...allStepResults.values()]
    const failed = stepResults
      .filter(r => r.status === 'failed' || r.status === 'skipped')
      .map(r => r.id)

    const overallStatus =
      failed.length === 0
        ? 'completed'
        : failed.length === steps.length
          ? 'failed'
          : 'partial'

    // Clear the progress display
    if (context.setToolJSX) {
      context.setToolJSX(null)
    }

    return {
      data: {
        status: overallStatus,
        summary: buildSummary(stepResults),
        stepResults,
        failedSteps: failed,
      },
    }
  },
})
