import { getFileModificationTime } from './file.js'
import { readFileSyncWithMetadata } from './fileRead.js'
import type { FileStateCache } from './fileStateCache.js'
import { expandPath } from './path.js'

/** Tools whose call() records a readFileState snapshot of what they wrote. */
const FILE_WRITER_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/**
 * Refresh the readFileState snapshot for a file a writer tool just wrote, after
 * its PostToolUse hooks have run.
 *
 * Why: Edit/Write record readFileState with the content THEY wrote. A
 * format-on-save hook (prettier / eslint --fix / gofmt through a hook) then
 * rewrites the file. The next Edit compares the on-disk file against that stale
 * snapshot, concludes it was changed externally, and fails with
 * `File content has changed` — even though the change was our own formatter.
 *
 * Only entries the tool recorded as a full view are touched (no offset/limit,
 * not a partial auto-injected view), so the partial-read safety check that
 * forces an explicit Read first is left intact. Any lookup or read failure is a
 * silent no-op — the worst case is simply the previous behavior.
 */
export function resyncWritableFileStateAfterHooks(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  readFileState: FileStateCache,
): void {
  if (!FILE_WRITER_TOOLS.has(toolName)) return
  const rawPath = toolInput?.file_path ?? toolInput?.notebook_path
  if (typeof rawPath !== 'string' || rawPath.length === 0) return

  try {
    const absolutePath = expandPath(rawPath)
    const cached = readFileState.get(absolutePath)
    if (!cached) return
    // Leave partial/auto-injected views alone — Edit/Write must still ask for an
    // explicit Read before touching those.
    if (cached.isPartialView) return
    if (cached.offset !== undefined || cached.limit !== undefined) return

    // Unchanged on disk → the hook didn't rewrite it, nothing to do.
    if (getFileModificationTime(absolutePath) === cached.timestamp) return

    const { content } = readFileSyncWithMetadata(absolutePath)
    readFileState.set(absolutePath, {
      content,
      timestamp: getFileModificationTime(absolutePath),
      offset: undefined,
      limit: undefined,
    })
  } catch {
    // File deleted or unreadable after the hook — keep the previous snapshot.
  }
}
