import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopComposerBranchView } from '../src/client/ComposerBranch.tsx'
import {
  DESKTOP_WORKSPACE_CHANGES_PATH,
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
