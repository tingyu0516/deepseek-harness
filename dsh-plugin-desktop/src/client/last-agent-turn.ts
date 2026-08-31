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
