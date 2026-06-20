// Workflow DAG types

export type WorkflowStepDef = {
  id: string
  prompt: string
  agentType?: string
  dependsOn?: string[]
  description?: string
}

export type WorkflowInput = {
  steps: WorkflowStepDef[]
  maxConcurrency?: number
}

export type WorkflowStepResult = {
  id: string
  status: 'completed' | 'failed' | 'skipped'
  summary: string
  error?: string
}

export type WorkflowOutput = {
  status: 'completed' | 'failed' | 'partial'
  summary: string
  stepResults: WorkflowStepResult[]
  failedSteps: string[]
}
