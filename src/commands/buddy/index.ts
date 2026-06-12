import type { Command } from '../../commands.js'

const buddy = {
  type: 'local',
  name: 'buddy',
  description: 'Hatch and interact with your companion',
  supportsNonInteractive: true,
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
