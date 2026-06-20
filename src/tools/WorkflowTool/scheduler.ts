import type { WorkflowStepDef } from './types.js'

/**
 * Topological sort using Kahn's algorithm.
 * Returns step IDs in execution order.
 * Throws if a cycle is detected.
 */
export function topologicalSort(steps: WorkflowStepDef[]): string[] {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const step of steps) {
    inDegree.set(step.id, 0)
    adjacency.set(step.id, [])
  }

  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      adjacency.get(dep)?.push(step.id)
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id)
  }

  const result: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(id)
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }

  if (result.length !== steps.length) {
    const cycleNodes = steps
      .map(s => s.id)
      .filter(id => !result.includes(id))
    throw new Error(
      `Workflow cycle detected involving steps: ${cycleNodes.join(', ')}`,
    )
  }

  return result
}

/**
 * Find step IDs whose dependencies are all satisfied.
 */
export function getReadySteps(
  steps: WorkflowStepDef[],
  completed: Set<string>,
  inProgress: Set<string>,
): WorkflowStepDef[] {
  return steps.filter(
    s =>
      !completed.has(s.id) &&
      !inProgress.has(s.id) &&
      (s.dependsOn ?? []).every(d => completed.has(d)),
  )
}
