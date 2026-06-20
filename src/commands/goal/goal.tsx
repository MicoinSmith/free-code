import * as React from 'react'
import { Text } from '../../ink.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { clearUserContextCache } from '../../context.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

function saveAndRefresh(updater: (goals: string[]) => string[]): void {
  saveGlobalConfig((current) => ({
    ...current,
    goals: updater(current.goals || []),
  }))
  clearUserContextCache()
}

export const call: LocalJSXCommandCall = async (_onDone, _context, args) => {
  const trimmed = args.trim()
  const config = getGlobalConfig()
  const goals = config.goals || []

  // No args or explicit list
  if (!trimmed || trimmed === 'list') {
    if (goals.length === 0) {
      return (
        <Text>
          No goals set. Use{' '}
          <Text bold>/goal add {'<text>'}</Text> to set a goal.
        </Text>
      )
    }
    return (
      <Text>
        <Text bold>Current Goals:</Text>
        {'\n'}
        {goals.map((g, i) => (
          <Text key={i}>
            {'\n'}
            {i + 1}. {g}
          </Text>
        ))}
        {'\n\n'}
        Use <Text bold>/goal add {'<text>'}</Text> to add more,{' '}
        <Text bold>/goal remove {'<n>'}</Text> to remove.
      </Text>
    )
  }

  // Shortcut: bare text with no subcommand → add
  if (
    !trimmed.startsWith('add ') &&
    !trimmed.startsWith('remove ') &&
    !trimmed.startsWith('rm ') &&
    trimmed !== 'clear' &&
    trimmed !== 'list'
  ) {
    saveAndRefresh((goals) => [...goals, trimmed])
    return (
      <Text>
        Goal added: <Text bold>&ldquo;{trimmed}&rdquo;</Text>
      </Text>
    )
  }

  // add subcommand
  if (trimmed.startsWith('add ')) {
    const goal = trimmed.slice(4).trim()
    if (!goal) {
      return <Text>Usage: /goal add {'<text>'}</Text>
    }
    saveAndRefresh((goals) => [...goals, goal])
    return (
      <Text>
        Goal added: <Text bold>&ldquo;{goal}&rdquo;</Text>
      </Text>
    )
  }

  // remove / rm subcommand
  if (trimmed.startsWith('remove ') || trimmed.startsWith('rm ')) {
    const numStr = trimmed.replace(/^(remove|rm) /, '').trim()
    const num = parseInt(numStr, 10)
    if (isNaN(num) || num < 1 || num > goals.length) {
      return (
        <Text>
          Invalid goal number. Current goals:{' '}
          {goals.length
            ? goals.map((g, i) => `${i + 1}. ${g}`).join(', ')
            : 'none'}
        </Text>
      )
    }
    const removed = goals[num - 1]
    saveAndRefresh((goals) => goals.filter((_, i) => i !== num - 1))
    return (
      <Text>
        Goal removed: <Text bold>&ldquo;{removed}&rdquo;</Text>
      </Text>
    )
  }

  // clear subcommand
  if (trimmed === 'clear') {
    saveAndRefresh(() => [])
    return <Text>All goals cleared.</Text>
  }

  return <Text>Usage: /goal [add {'<text>'}|list|remove {'<n>'}|clear]</Text>
}
