import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopComposerBranchView } from '../src/client/ComposerBranch.tsx'
import {
  DESKTOP_WORKSPACE_CHANGES_PATH,
  addedEntireFile,
  changedLinesFromUnifiedDiff,
  diffRowKinds,
  requestDesktopWorkspaceBranch,
} from '../src/client/workspace-changes-api.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop composer branch', () => {
  it('renders the branch name above the input card', () => {
    const markup = renderToStaticMarkup(createElement(DesktopComposerBranchView, { branch: 'fix/pet-macos-spaces' }))
    expect(markup).toContain('dshDesktopComposerBranch')
    expect(markup).toContain('fix/pet-macos-spaces')
  })

  it('reads the current branch from the last-turn Host route without listing files', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      repository: true,
      branch: 'fix/pet-macos-spaces',
      view: 'agent-turn',
      additions: 0,
      deletions: 0,
      files: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(requestDesktopWorkspaceBranch('E:\\repo')).resolves.toBe('fix/pet-macos-spaces')
    expect(fetch).toHaveBeenCalledWith(
      `${DESKTOP_WORKSPACE_CHANGES_PATH}?root=${encodeURIComponent('E:\\repo')}&view=agent-turn`,
      {},
    )
  })

  it('hides the chip when the workspace is not a git repository', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      repository: false,
      branch: '',
      view: 'agent-turn',
      additions: 0,
      deletions: 0,
      files: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    await expect(requestDesktopWorkspaceBranch('E:\\not-a-repo')).resolves.toBeUndefined()
  })
})

describe('unified diff changed-line parsing', () => {
  it('maps added lines onto current-content positions and removals onto their slot', () => {
    const patch = [
      '@@ -1,4 +1,5 @@',
      ' context one',
      '-removed old',
      '+added new one',
      '+added second',
      ' context two',
      '-removed at end',
      '+kept tail',
    ].join('\n')
    const { added, removed } = changedLinesFromUnifiedDiff(patch)
    expect([...added].sort((a, b) => a - b)).toEqual([2, 3, 5])
    expect([...removed].sort((a, b) => a - b)).toEqual([2, 5])
    expect(diffRowKinds('one\ntwo\nthree\nfour\nfive', { added, removed })).toEqual([
      'none', 'added', 'added', 'none', 'added',
    ])
  })

  it('collapses consecutive removals onto one position and clamps trailing removals onto the final surviving line', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      'index 111..222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,2 @@',
      ' keep',
      '-drop one',
      '-drop two',
      ' last',
    ].join('\n')
    const { added, removed } = changedLinesFromUnifiedDiff(patch)
    expect(added.size).toBe(0)
    expect([...removed]).toEqual([2])
    expect(diffRowKinds('keep\nlast', { added, removed })).toEqual(['none', 'removed'])
  })

  it('marks every row of a new file and nothing for an empty diff', () => {
    expect(addedEntireFile('a\nb\nc').added).toEqual(new Set([1, 2, 3]))
    expect(addedEntireFile('').added.size).toBe(0)
    const empty = changedLinesFromUnifiedDiff('')
    expect(empty.added.size).toBe(0)
    expect(empty.removed.size).toBe(0)
    expect(diffRowKinds('single', empty)).toEqual(['none'])
  })
})

