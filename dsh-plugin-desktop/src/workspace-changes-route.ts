/** Loopback Changes inventory for the Desktop drawer. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'
import {
  parseDesktopChangeView,
  validateCommitId,
  validateGitPathspec,
} from './workspace-changes-types.ts'
import { readDesktopChanges } from './workspace-changes-git.ts'
import {
  resolveAllowedWorkspacePath,
  validateWorkspaceFilePath,
  type DesktopWorkspaceAllowedRoots,
} from './workspace-file-route.ts'

export const DESKTOP_WORKSPACE_CHANGES_PATH = '/api/desktop/workspace-changes'

function finish(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

function requestedFiles(url: URL): string[] | undefined {
  const values = url.searchParams.getAll('file')
  if (values.length === 0) return undefined
  const files: string[] = []
  for (const value of values) {
    const path = validateGitPathspec(value)
    if (path === undefined) return undefined
    files.push(path)
  }
  return files
}

/** Serve one read-only git Changes request from the loopback renderer.
 * @param req - incoming renderer request.
 * @param res - loopback JSON response.
 * @param rendererOrigin - expected Origin of the Desktop renderer.
 * @param allowedRoots - live workspace directories that may be inspected.
 */
export async function handleDesktopWorkspaceChangesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  allowedRoots?: DesktopWorkspaceAllowedRoots,
): Promise<void> {
  if (!isSameOriginLoopbackRequest(req, rendererOrigin, false)) {
    finish(res, 403, { error: 'forbidden' })
    return
  }
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET')
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', rendererOrigin)
  const view = parseDesktopChangeView(url.searchParams.get('view'))
  if (view === undefined) return finish(res, 400, { error: 'invalid view' })
  const requested = validateWorkspaceFilePath(url.searchParams.get('root'))
  if (requested === undefined) return finish(res, 400, { error: 'invalid path' })
  const root = await resolveAllowedWorkspacePath(requested, allowedRoots)
  if (root === undefined) return finish(res, 403, { error: 'path is outside the workspace' })
  const pathParam = url.searchParams.get('path')
  const path = pathParam === null ? undefined : validateGitPathspec(pathParam)
  if (pathParam !== null && path === undefined) return finish(res, 400, { error: 'invalid path' })
  const commitParam = url.searchParams.get('commit')
  const commit = commitParam === null ? undefined : validateCommitId(commitParam)
  if (commitParam !== null && commit === undefined) return finish(res, 400, { error: 'invalid commit' })
  const files = requestedFiles(url)
  if (url.searchParams.has('file') && files === undefined) return finish(res, 400, { error: 'invalid path' })
  const result = await readDesktopChanges(root, view, {
    ...(path === undefined ? {} : { path }),
    ...(commit === undefined ? {} : { commit }),
    ...(files === undefined ? {} : { files }),
  })
  if ('error' in result && 'status' in result && !('repository' in result)) {
    return finish(res, result.status, { error: result.error })
  }
  return finish(res, 200, result)
}
