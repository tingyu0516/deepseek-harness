import { describe, expect, it } from 'vitest'
import { collectLastAgentTurnPaths, relativizeWorkspaceFile } from '../src/client/last-agent-turn.ts'

describe('last agent turn paths', () => {
  it('collects write and edit paths after the last user message', () => {
    expect(collectLastAgentTurnPaths({
      nodes: [
        { kind: 'user' },
        { kind: 'assistant', blocks: [{ kind: 'tool-call', name: 'read', argsRaw: '{"file_path":"skip.ts"}' }] },
        { kind: 'assistant', blocks: [{ kind: 'tool-call', name: 'write', argsRaw: '{"file_path":"src/a.ts","content":"x"}' }] },
        { kind: 'tool-result', call: { name: 'edit', argsRaw: '{"file_path":"src/b.ts","old_string":"a","new_string":"b"}' } },
      ],
      partial: { blocks: [{ kind: 'tool-call', name: 'write', argsRaw: '{"file_path":"src/c.ts","content":"y"}' }] },
      runningCalls: [{ name: 'edit', argsRaw: '{"file_path":"src/a.ts","old_string":"1","new_string":"2"}' }],
    })).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('ignores tool calls from earlier turns', () => {
    expect(collectLastAgentTurnPaths({
      nodes: [
        { kind: 'assistant', blocks: [{ kind: 'tool-call', name: 'write', argsRaw: '{"file_path":"old.ts","content":"x"}' }] },
        { kind: 'user' },
        { kind: 'assistant', blocks: [{ kind: 'text', argsRaw: '' }] },
      ],
    })).toEqual([])
  })

  it('relativizes absolute tool paths to the workspace', () => {
    expect(relativizeWorkspaceFile('E:\\workspace\\app', 'E:\\workspace\\app\\src\\a.ts')).toBe('src/a.ts')
    expect(relativizeWorkspaceFile('E:\\workspace\\app', 'src/a.ts')).toBe('src/a.ts')
    expect(relativizeWorkspaceFile('E:\\workspace\\app', 'E:\\other\\a.ts')).toBeUndefined()
    expect(relativizeWorkspaceFile('E:\\workspace\\app', '../secret.ts')).toBeUndefined()
  })
})
