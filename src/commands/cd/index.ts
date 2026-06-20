import type { Command } from '../../commands.js'

const cdCommand = {
  type: 'local-jsx',
  name: 'cd',
  description: 'Change the current working directory',
  argumentHint: '<path>',
  load: () => import('./cd.js'),
} satisfies Command

export default cdCommand
