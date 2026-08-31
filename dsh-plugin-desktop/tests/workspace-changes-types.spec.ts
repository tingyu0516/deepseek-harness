import { describe, expect, it } from 'vitest'
import {
  mergeChangeFiles,
  parseCommitLog,
  parseDesktopChangeView,
  parseNumstat,
  parsePorcelainStatus,
  validateCommitId,
  validateGitPathspec,
} from '../src/workspace-changes-types.ts'

describe('desktop changes parsers', () => {
  it('parses porcelain, numstat, and commit log rows', () => {
    expect(parsePorcelainStatus('M  staged.ts\n M unstaged.ts\n?? new.ts\n')).toEqual([
      { path: 'staged.ts', index: 'M', worktree: ' ' },
      { path: 'unstaged.ts', index: ' ', worktree: 'M' },
      { path: 'new.ts', index: '?', worktree: '?' },
    ])
    expect(parseNumstat('12\t3\tsrc/a.ts\n-\t-\tbinary.png\n8\t1\told.ts => new.ts\n')).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3 },
      { path: 'binary.png', additions: null, deletions: null },
      { path: 'new.ts', additions: 8, deletions: 1 },
    ])
    expect(parseCommitLog('abc1234\u001ffabc123\u001fAdd panel\u001fAda\u001f2026-08-31T01:00:00Z\n')).toEqual([
      {
        hash: 'abc1234',
        short: 'fabc123',
        subject: 'Add panel',
        author: 'Ada',
        committedAt: '2026-08-31T01:00:00Z',
      },
    ])
  })

  it('splits staged, unstaged, and last-turn files from the same porcelain', () => {
    const porcelain = parsePorcelainStatus('M  staged.ts\n M unstaged.ts\nMM both.ts\n?? new.ts\n')
    const numstat = parseNumstat('1\t0\tstaged.ts\n2\t1\tunstaged.ts\n3\t3\tboth.ts\n')
    expect(mergeChangeFiles(porcelain, numstat, 'staged', undefined).files.map(file => file.path))
      .toEqual(['staged.ts', 'both.ts'])
    expect(mergeChangeFiles(porcelain, numstat, 'unstaged', undefined).files.map(file => file.path))
      .toEqual(['unstaged.ts', 'both.ts', 'new.ts'])
    expect(mergeChangeFiles(porcelain, numstat, 'uncommitted', new Set(['unstaged.ts', 'missing.ts'])).files)
      .toEqual([{ path: 'unstaged.ts', status: 'modified', additions: 2, deletions: 1 }])
  })

  it('rejects invalid views, pathspecs, and commit ids', () => {
    expect(parseDesktopChangeView(null)).toBe('uncommitted')
    expect(parseDesktopChangeView('staged')).toBe('staged')
    expect(parseDesktopChangeView('other')).toBeUndefined()
    expect(validateGitPathspec('src/a.ts')).toBe('src/a.ts')
    expect(validateGitPathspec('../secret')).toBeUndefined()
    expect(validateGitPathspec('E:\\workspace\\a.ts')).toBeUndefined()
    expect(validateCommitId('abc1234')).toBe('abc1234')
    expect(validateCommitId('not-a-hash')).toBeUndefined()
  })
})
