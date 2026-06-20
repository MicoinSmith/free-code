import type { Command } from '../../commands.js'

const goal: Command = {
  type: 'local-jsx',
  name: 'goal',
  description: 'Set or view long-term goals that persist across sessions (injected into system prompt every turn)',
  argumentHint: '[add <text>|list|remove <n>|clear]',
  load: () => import('./goal.js'),
}

export default goal
