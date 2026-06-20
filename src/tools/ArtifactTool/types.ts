export const ARTIFACT_TYPES = ['html', 'svg', 'chart', 'markdown'] as const
export type ArtifactType = (typeof ARTIFACT_TYPES)[number]

export const ARTIFACT_ACTIONS = [
  'create',
  'update',
  'list',
  'delete',
  'open',
] as const
export type ArtifactAction = (typeof ARTIFACT_ACTIONS)[number]

export type ArtifactInput = {
  action: ArtifactAction
  type?: ArtifactType
  title?: string
  content?: string
  artifactId?: string
}

export type ArtifactMeta = {
  id: string
  type: ArtifactType
  title: string
  createdAt: number
  updatedAt: number
  version: number
  tags?: string[]
}

export type ArtifactRecord = ArtifactMeta & {
  content: string
}

export type ArtifactOutput = {
  status: 'created' | 'updated' | 'deleted' | 'listed' | 'opened' | 'error'
  artifact?: ArtifactMeta
  artifacts?: ArtifactMeta[]
  url?: string
  message: string
}
