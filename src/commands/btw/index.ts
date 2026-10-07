import type { Command } from '../../commands.js'

const btw = {
  type: 'local-jsx',
  name: 'btw',
  description:
    'Ask a quick side question without interrupting the main conversation',
  immediate: true,
  // The side conversation needs room to read and scroll; in the normal
  // output flow it competes with the transcript for the same rows. Take the
  // alternate screen so the pane owns a fixed-height viewport.
  altScreen: true,
  argumentHint: '<question>',
  load: () => import('./btw.js'),
} satisfies Command

export default btw
