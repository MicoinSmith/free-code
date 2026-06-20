import chalk from 'chalk'
import figures from 'figures'
import React from 'react'
import { setCwdState, setOriginalCwd } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const targetPath = (args ?? '').trim()

  // No args: show current directory
  if (!targetPath) {
    const current = getCwd()
    onDone(`Current directory: ${chalk.bold(current)}`)
    return null
  }

  // Resolve the path relative to current cwd
  let resolved: string
  try {
    const pathModule = await import('path')
    const fsModule = await import('fs')
    const current = getCwd()
    resolved = pathModule.resolve(current, targetPath)

    // Verify the path exists and is a directory
    const stat = fsModule.statSync(resolved)
    if (!stat.isDirectory()) {
      const message = `${chalk.bold(targetPath)} is not a directory`
      return (
        <Box flexDirection="column">
          <Text dimColor>
            {figures.pointer} /cd {targetPath}
          </Text>
          <MessageResponse>
            <Text>{message}</Text>
          </MessageResponse>
        </Box>
      )
    }
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error'
    const message = `Failed to change directory: ${errorMessage}`
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {figures.pointer} /cd {targetPath}
        </Text>
        <MessageResponse>
          <Text>{message}</Text>
        </MessageResponse>
      </Box>
    )
  }

  // Execute the directory change
  try {
    process.chdir(resolved)
    setCwdState(resolved)
    setOriginalCwd(resolved)
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error'
    const message = `Failed to change directory: ${errorMessage}`
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {figures.pointer} /cd {targetPath}
        </Text>
        <MessageResponse>
          <Text>{message}</Text>
        </MessageResponse>
      </Box>
    )
  }

  onDone(`Changed directory to ${chalk.bold(resolved)}`)
  return null
}
