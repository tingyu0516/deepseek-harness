/** Collect workspace paths written by the current session's last agent turn. */

const FILE_TOOLS = new Set(['write', 'edit'])

interface ToolArgsBlock {
  readonly kind: string
  readonly name?: string
  readonly argsRaw?: string
}

interface ConversationTurnNode {
  readonly kind: string
  readonly blocks?: readonly ToolArgsBlock[]
  readonly call?: { readonly name: string; readonly argsRaw: string } | null
}

/** Conversation fields used to recover last-turn write/edit paths. */
export interface LastAgentTurnSnapshot {
  readonly nodes: readonly ConversationTurnNode[]
  readonly partial?: { readonly blocks: readonly ToolArgsBlock[] } | null
  readonly runningCalls?: readonly { readonly name: string; readonly argsRaw: string }[]
}

function parseFilePath(argsRaw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const path = (parsed as { file_path?: unknown }).file_path
    if (typeof path !== 'string' || path.trim() === '') return undefined
    return path.trim()
  } catch {
    return undefined
  }
}

function posix(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '')
}

/**
 * Convert an absolute tool path to a git pathspec under the workspace root.
 * @param root - workspace directory.
 * @param filePath - write/edit file_path argument.
 * @returns a relative path, or the original relative path when it is already confined.
 */
export function relativizeWorkspaceFile(root: string, filePath: string): string | undefined {
  const from = posix(root)
  const to = posix(filePath)
  const drive = /^[A-Za-z]:/u.test(from) && /^[A-Za-z]:/u.test(to)
  const fromKey = drive ? from.toLowerCase() : from
  const toKey = drive ? to.toLowerCase() : to
  if (toKey === fromKey) return undefined
  if (toKey.startsWith(`${fromKey}/`)) return to.slice(from.length + 1)
  if (to.startsWith('/') || /^[A-Za-z]:/u.test(to)) return undefined
  if (to.split('/').some(segment => segment === '..')) return undefined
  return to
}

function addToolPath(paths: Set<string>, name: string, argsRaw: string): void {
  if (!FILE_TOOLS.has(name)) return
  const path = parseFilePath(argsRaw)
  if (path !== undefined) paths.add(path)
}

function addFromBlocks(paths: Set<string>, blocks: readonly ToolArgsBlock[] | undefined): void {
  for (const block of blocks ?? []) {
    if (block.kind !== 'tool-call' || block.name === undefined || block.argsRaw === undefined) continue
    addToolPath(paths, block.name, block.argsRaw)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One Session event-window entry used to recover last-turn write/edit paths. */
export interface LastAgentTurnEventEntry {
  readonly type: string
  readonly event: {
    readonly type: string
    readonly data?: unknown
  }
}

function assistantToolBlocks(data: unknown): ToolArgsBlock[] {
  if (!isRecord(data) || !isRecord(data.message) || !Array.isArray(data.message.content)) return []
  const blocks: ToolArgsBlock[] = []
  for (const block of data.message.content) {
    if (!isRecord(block) || block.type !== 'tool-call') continue
    if (typeof block.name === 'string' && typeof block.arguments === 'string') {
      blocks.push({ kind: 'tool-call', name: block.name, argsRaw: block.arguments })
    }
  }
  return blocks
}

function acceptToolCallDelta(
  running: Map<string, { name: string; argsRaw: string }>,
  data: unknown,
): void {
  if (!isRecord(data) || !isRecord(data.chunk)) return
  const chunk = data.chunk
  if (chunk.type !== 'tool-call-delta' || typeof chunk.id !== 'string') return
  const previous = running.get(chunk.id)
  const name = typeof chunk.name === 'string' ? chunk.name : previous?.name ?? ''
  const delta = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
  running.set(chunk.id, { name, argsRaw: `${previous?.argsRaw ?? ''}${delta}` })
}

function acceptPackedToolCall(
  running: Map<string, { name: string; argsRaw: string }>,
  event: LastAgentTurnEventEntry['event'],
): void {
  if (event.type !== 'chunkrow/tool-call-chunks' || !isRecord(event.data)) return
  const id = event.data.id
  const args = event.data.args
  if (typeof id !== 'string' || !Array.isArray(args)) return
  const name = typeof event.data.name === 'string' ? event.data.name : ''
  running.set(id, {
    name,
    argsRaw: args.filter(value => typeof value === 'string').join(''),
  })
}

/**
 * Fold a Session event window into the conversation fields {@link collectLastAgentTurnPaths} reads.
 * @param entries - current Session event-window entries.
 * @returns last-turn nodes plus any still-streaming tool calls.
 */
export function lastAgentTurnSnapshotFromEvents(
  entries: readonly LastAgentTurnEventEntry[],
): LastAgentTurnSnapshot {
  const nodes: ConversationTurnNode[] = []
  const running = new Map<string, { name: string; argsRaw: string }>()
  for (const entry of entries) {
    if (entry.type === 'event') {
      const { type, data } = entry.event
      if (type === 'user/message') {
        nodes.push({ kind: 'user' })
        continue
      }
      if (type === 'tool/call' && isRecord(data)) {
        const name = data.name
        const args = data.arguments
        if (typeof name === 'string' && typeof args === 'string') {
          nodes.push({ kind: 'tool-result', call: { name, argsRaw: args } })
        }
        if (typeof data.callId === 'string') running.delete(data.callId)
        continue
      }
      if (type === 'assistant/message') {
        const blocks = assistantToolBlocks(data)
        if (blocks.length > 0) nodes.push({ kind: 'assistant', blocks })
        continue
      }
      if (type === 'assistant/chunk') acceptToolCallDelta(running, data)
      continue
    }
    if (entry.type === 'chunks') acceptPackedToolCall(running, entry.event)
  }
  return { nodes, runningCalls: [...running.values()] }
}

/**
 * Paths from write/edit calls after the last user message in a Session event window.
 * @param entries - current Session event-window entries.
 * @returns unique file_path values in first-seen order.
 */
export function collectLastAgentTurnPathsFromEvents(
  entries: readonly LastAgentTurnEventEntry[],
): string[] {
  return collectLastAgentTurnPaths(lastAgentTurnSnapshotFromEvents(entries))
}

/**
 * Paths from write/edit calls after the last user message, including a live partial turn.
 * @param snapshot - current session conversation snapshot.
 * @returns unique file_path values in first-seen order.
 */
export function collectLastAgentTurnPaths(snapshot: LastAgentTurnSnapshot): string[] {
  const paths = new Set<string>()
  let lastUser = -1
  for (let index = snapshot.nodes.length - 1; index >= 0; index -= 1) {
    if (snapshot.nodes[index]?.kind === 'user') {
      lastUser = index
      break
    }
  }
  for (let index = lastUser + 1; index < snapshot.nodes.length; index += 1) {
    const node = snapshot.nodes[index]
    if (node === undefined) continue
    if (node.kind === 'assistant') addFromBlocks(paths, node.blocks)
    if (node.kind === 'tool-result' && node.call !== null && node.call !== undefined) {
      addToolPath(paths, node.call.name, node.call.argsRaw)
    }
  }
  addFromBlocks(paths, snapshot.partial?.blocks)
  for (const call of snapshot.runningCalls ?? []) addToolPath(paths, call.name, call.argsRaw)
  return [...paths]
}
