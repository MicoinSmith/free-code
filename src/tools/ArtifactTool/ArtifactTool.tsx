import React from 'react'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { Text, Box } from '../../ink.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { ARTIFACT_TOOL_NAME, MAX_ARTIFACTS_PER_SESSION, MAX_ARTIFACT_CONTENT_CHARS } from './constants.js'
import { startServer, registerArtifactRoute, getServerUrl } from './server.js'
import type { ArtifactType, ArtifactAction, ArtifactRecord, ArtifactMeta, ArtifactOutput } from './types.js'
import { ARTIFACT_ACTIONS, ARTIFACT_TYPES } from './types.js'

// ─── In-memory artifact store ────────────────────────────────────────────────
const artifacts = new Map<string, ArtifactRecord>()
let nextId = 1

function generateId(): string {
  const id = `art_${Date.now().toString(36)}_${nextId}`
  nextId++
  return id
}

function createArtifact(
  type: ArtifactType,
  title: string,
  content: string,
): ArtifactRecord {
  const now = Date.now()
  return {
    id: generateId(),
    type,
    title,
    content,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(ARTIFACT_ACTIONS)
      .describe('Action to perform on artifacts'),
    type: z
      .enum(ARTIFACT_TYPES)
      .optional()
      .describe('Type of artifact (required for create)'),
    title: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Title of the artifact'),
    content: z
      .string()
      .max(MAX_ARTIFACT_CONTENT_CHARS)
      .optional()
      .describe('Content of the artifact (HTML/SVG/markdown body)'),
    artifactId: z
      .string()
      .optional()
      .describe('Artifact ID (required for update/delete/open)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z
      .enum(['created', 'updated', 'deleted', 'listed', 'opened', 'error'])
      .describe('Result status'),
    artifact: z
      .object({
        id: z.string(),
        type: z.enum(ARTIFACT_TYPES),
        title: z.string(),
        createdAt: z.number(),
        updatedAt: z.number(),
        version: z.number(),
      })
      .optional()
      .describe('The affected artifact metadata'),
    artifacts: z
      .array(
        z.object({
          id: z.string(),
          type: z.enum(ARTIFACT_TYPES),
          title: z.string(),
          createdAt: z.number(),
          updatedAt: z.number(),
          version: z.number(),
        }),
      )
      .optional()
      .describe('List of all artifacts (for list action)'),
    url: z.string().optional().describe('URL to view the artifact'),
    message: z.string().describe('Human-readable result message'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ─── Terminal UI components ──────────────────────────────────────────────────

function ArtifactListItem({ artifact, url }: { artifact: ArtifactMeta; url?: string }): React.ReactNode {
  const created = new Date(artifact.createdAt).toLocaleString()
  const lines = [
    `  ${artifact.type.toUpperCase()}  ${artifact.title}`,
    `      ID: ${artifact.id}  v${artifact.version}  Created: ${created}`,
  ]
  if (url) {
    lines.push(`      URL: ${url}`)
  }
  return <Text>{lines.join('\n')}</Text>
}

function ArtifactCreatedPreview({ artifact, url }: { artifact: ArtifactMeta; url: string }): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{'✓'}</Text> Artifact created: {artifact.title}
      </Text>
      <Text>  Type: {artifact.type}  |  ID: {artifact.id}  |  v{artifact.version}</Text>
      <Text>  URL: {url}</Text>
    </Box>
  )
}

// ─── Tool implementation ─────────────────────────────────────────────────────

export const ArtifactTool = buildTool({
  name: ARTIFACT_TOOL_NAME,
  aliases: ['Artifacts', 'CreateArtifact'],
  searchHint: 'create view share rich content html svg chart markdown artifact',
  maxResultSizeChars: 500_000,

  async prompt() {
    return `Create, view, and manage rich interactive content (artifacts).

Artifacts are rich content pieces (HTML, SVG, charts, markdown) that can be:
- Viewed in the terminal with a preview
- Served via a local HTTP server for browser viewing
- Versioned and managed throughout a session

Available actions:
- \`create\`: Create a new artifact (requires type, title, content)
- \`update\`: Update an existing artifact (requires artifactId, optional title/content)
- \`list\`: List all artifacts in the current session
- \`delete\`: Delete an artifact (requires artifactId)
- \`open\`: Get the URL for an existing artifact (requires artifactId)

Artifact types:
- \`html\`: Full HTML page
- \`svg\`: SVG graphic
- \`chart\`: Chart data/configuration
- \`markdown\`: Markdown content

Use artifacts when you need to create rich, persistent, shareable content
that the user can view in their browser via the local HTTP server.`
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

  userFacingName(input: Partial<Record<string, unknown>> | undefined): string {
    const action = (input?.action as string) || 'use'
    return `Artifact (${action})`
  },
  getToolUseSummary(input: Partial<Record<string, unknown>> | undefined): string | null {
    const action = input?.action as string
    const title = input?.title as string | undefined
    if (action === 'create' && title) return `Create artifact: ${title}`
    if (action === 'list') return 'List artifacts'
    if (action === 'delete') return 'Delete artifact'
    if (action === 'open') return 'Open artifact'
    if (action === 'update' && title) return `Update artifact: ${title}`
    return null
  },

  renderToolUseMessage(input: Record<string, unknown>) {
    const action = input.action as string
    const title = input.title as string | undefined
    const label = title ? `"${title}"` : ''
    return <Text>Artifact ({action}) {label}...</Text>
  },

  renderToolResultMessage(
    content: ArtifactOutput,
  ): React.ReactNode {
    const { status, artifact, artifacts: artifactList, url, message } = content

    if (status === 'error') {
      return (
        <Text>
          <Text color="red">{'✗'}</Text> {message}
        </Text>
      )
    }

    if (status === 'listed' && artifactList) {
      if (artifactList.length === 0) {
        return <Text>No artifacts in this session.</Text>
      }
      const items = artifactList.map((a, i) => {
        const aUrl = url ? `${url}/artifact/${a.id}` : undefined
        return <ArtifactListItem key={a.id} artifact={a} url={aUrl} />
      })
      return (
        <Box flexDirection="column">
          <Text bold>Artifacts ({artifactList.length}):</Text>
          {items}
        </Box>
      )
    }

    if (status === 'created' && artifact && url) {
      return <ArtifactCreatedPreview artifact={artifact} url={url} />
    }

    if (status === 'updated' && artifact) {
      return (
        <Text>
          <Text bold>{'✓'}</Text> Artifact updated: {artifact.title} (v{artifact.version})
        </Text>
      )
    }

    if (status === 'deleted') {
      return <Text>{'✓'} Artifact deleted</Text>
    }

    if (status === 'opened' && artifact && url) {
      return (
        <Box flexDirection="column">
          <Text bold>{'→'} {artifact.title}</Text>
          <Text>  URL: {url}</Text>
        </Box>
      )
    }

    return <Text>{message}</Text>
  },

  async call(
    input: {
      action: ArtifactAction
      type?: ArtifactType
      title?: string
      content?: string
      artifactId?: string
    },
    _context: Record<string, unknown>,
    _canUseTool: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
    _parentMessage: unknown,
  ): Promise<{ data: ArtifactOutput }> {
    const { action, type, title, content, artifactId } = input

    switch (action) {
      case 'create': {
        if (!type || !title || content === undefined) {
          return {
            data: {
              status: 'error',
              message: 'Create requires: type, title, and content',
            },
          }
        }

        if (artifacts.size >= MAX_ARTIFACTS_PER_SESSION) {
          return {
            data: {
              status: 'error',
              message: `Maximum ${MAX_ARTIFACTS_PER_SESSION} artifacts per session reached. Delete some first.`,
            },
          }
        }

        const record = createArtifact(type, title, content)
        artifacts.set(record.id, record)

        // Start server and register route
        try {
          const baseUrl = getServerUrl() || (await startServer())
          const url = registerArtifactRoute(record)
          return {
            data: {
              status: 'created',
              artifact: {
                id: record.id,
                type: record.type,
                title: record.title,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                version: record.version,
              },
              url: url || `${baseUrl}/artifact/${record.id}`,
              message: `Created ${type} artifact "${title}" (${record.id})`,
            },
          }
        } catch (err: unknown) {
          // Server failed, return artifact info without URL
          const msg = err instanceof Error ? err.message : String(err)
          return {
            data: {
              status: 'created',
              artifact: {
                id: record.id,
                type: record.type,
                title: record.title,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                version: record.version,
              },
              message: `Created ${type} artifact "${title}" (server unavailable: ${msg})`,
            },
          }
        }
      }

      case 'update': {
        if (!artifactId) {
          return {
            data: { status: 'error', message: 'Update requires: artifactId' },
          }
        }
        const existing = artifacts.get(artifactId)
        if (!existing) {
          return {
            data: {
              status: 'error',
              message: `Artifact "${artifactId}" not found`,
            },
          }
        }

        if (title !== undefined) existing.title = title
        if (content !== undefined) existing.content = content
        existing.version++
        existing.updatedAt = Date.now()

        artifacts.set(artifactId, existing)

        // Re-register route with updated content
        const url = registerArtifactRoute(existing)

        return {
          data: {
            status: 'updated',
            artifact: {
              id: existing.id,
              type: existing.type,
              title: existing.title,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
              version: existing.version,
            },
            url: url || undefined,
            message: `Updated artifact "${existing.title}" (v${existing.version})`,
          },
        }
      }

      case 'delete': {
        if (!artifactId) {
          return {
            data: { status: 'error', message: 'Delete requires: artifactId' },
          }
        }
        if (!artifacts.has(artifactId)) {
          return {
            data: {
              status: 'error',
              message: `Artifact "${artifactId}" not found`,
            },
          }
        }
        artifacts.delete(artifactId)
        return {
          data: {
            status: 'deleted',
            message: `Deleted artifact ${artifactId}`,
          },
        }
      }

      case 'list': {
        const baseUrl = getServerUrl()
        const allArtifacts: ArtifactMeta[] = []
        for (const record of artifacts.values()) {
          allArtifacts.push({
            id: record.id,
            type: record.type,
            title: record.title,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            version: record.version,
          })
        }
        // Sort newest first
        allArtifacts.sort((a, b) => b.createdAt - a.createdAt)
        return {
          data: {
            status: 'listed',
            artifacts: allArtifacts,
            url: baseUrl || undefined,
            message: `Found ${allArtifacts.length} artifact(s)`,
          },
        }
      }

      case 'open': {
        if (!artifactId) {
          return {
            data: { status: 'error', message: 'Open requires: artifactId' },
          }
        }
        const record = artifacts.get(artifactId)
        if (!record) {
          return {
            data: {
              status: 'error',
              message: `Artifact "${artifactId}" not found`,
            },
          }
        }

        const baseUrl = getServerUrl() || (await startServer())
        const url = registerArtifactRoute(record)

        return {
          data: {
            status: 'opened',
            artifact: {
              id: record.id,
              type: record.type,
              title: record.title,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
              version: record.version,
            },
            url: url || `${baseUrl}/artifact/${record.id}`,
            message: `Opened artifact "${record.title}"`,
          },
        }
      }

      default: {
        return {
          data: {
            status: 'error',
            message: `Unknown action: ${action}`,
          },
        }
      }
    }
  },
})
