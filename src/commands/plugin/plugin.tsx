import * as React from 'react'
import { Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { PluginSettings } from './PluginSettings.js'
import { parsePluginArgs } from './parseArgs.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  const parsed = parsePluginArgs(args)

  // Handle /plugin list [--enabled|--disabled] inline
  if (parsed.type === 'list') {
    return <PluginList onDone={onDone} filter={parsed.filter} />
  }

  return <PluginSettings onComplete={onDone} args={args} />
}

type PluginInfo = {
  name: string
  enabled: boolean
  source: string
}

function PluginList({
  onDone,
  filter,
}: {
  onDone: LocalJSXCommandOnDone
  filter?: 'enabled' | 'disabled'
}): React.ReactNode {
  const [plugins, setPlugins] = React.useState<PluginInfo[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    loadAllPlugins()
      .then((result) => {
        let list: PluginInfo[] = result.enabled.map((p) => ({
          name: p.name,
          enabled: true,
          source: p.source,
        }))
          .concat(
            result.disabled.map((p) => ({
              name: p.name,
              enabled: false,
              source: p.source,
            })),
          )
          .sort((a, b) => a.name.localeCompare(b.name))

        if (filter === 'enabled') {
          list = list.filter((p) => p.enabled)
        } else if (filter === 'disabled') {
          list = list.filter((p) => !p.enabled)
        }

        setPlugins(list)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
  }, [filter])

  if (error) {
    return <Text>Error loading plugins: {error}</Text>
  }

  if (!plugins) {
    return <Text>Loading plugins...</Text>
  }

  if (plugins.length === 0) {
    const msg =
      filter === 'enabled'
        ? 'No enabled plugins.'
        : filter === 'disabled'
          ? 'No disabled plugins.'
          : 'No plugins installed.'
    return <Text>{msg}</Text>
  }

  return (
    <Text>
      <Text bold>
        Plugins ({plugins.length}
        {filter ? `, ${filter}` : ''}):
      </Text>
      {'\n'}
      {plugins.map((p) => (
        <Text key={p.name}>
          {'\n'}  {p.enabled ? '✓' : '○'} {p.name}
          <Text dimColor> ({p.source})</Text>
        </Text>
      ))}
    </Text>
  )
}
