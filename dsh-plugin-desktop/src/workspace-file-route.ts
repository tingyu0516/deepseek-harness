/** Read-only Desktop workspace tree and file routes. */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'

export const DESKTOP_WORKSPACE_FILE_PATH = '/api/desktop/workspace-file'
export const DESKTOP_WORKSPACE_TREE_PATH = '/api/desktop/workspace-tree'
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 1000

export interface DesktopWorkspaceTreeEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly hidden: boolean
}

export interface DesktopWorkspaceTreeResponse {
  readonly path: string
  readonly entries: readonly DesktopWorkspaceTreeEntry[]
  readonly truncated: boolean
}

type AllowedRoots = readonly string[] | (() => readonly string[])

function finish(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

/** Validate an absolute path without permitting encoded traversal or NUL bytes. */
export function validateWorkspaceFilePath(value: string | null): string | undefined {
  if (value === null || value.includes('\0') || !isAbsolute(value)
    || value.split(/[\\/]/u).some(segment => segment === '..')) return undefined
  const resolved = resolve(value)
  return normalize(value) === resolved ? resolved : undefined
}

function rootList(allowedRoots: AllowedRoots | undefined): readonly string[] | undefined {
  if (allowedRoots === undefined) return undefined
  return (typeof allowedRoots === 'function' ? allowedRoots() : allowedRoots)
    .map(root => validateWorkspaceFilePath(root))
    .filter((root): root is string => root !== undefined)
}

function isInside(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

async function resolveAllowedPath(path: string, allowedRoots: AllowedRoots | undefined): Promise<string | undefined> {
  const roots = rootList(allowedRoots)
  if (roots === undefined) return path
  for (const root of roots) {
    if (!isInside(root, path)) continue
    try {
      const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(path)])
      if (isInside(realRoot, realTarget)) return realTarget
    } catch {
      return undefined
    }
  }
  return undefined
}

async function handleTree(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  allowedRoots: AllowedRoots | undefined,
): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET')
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', rendererOrigin)
  const requested = validateWorkspaceFilePath(url.searchParams.get('path'))
  if (requested === undefined) return finish(res, 400, { error: 'invalid path' })
  const directory = await resolveAllowedPath(requested, allowedRoots)
  if (directory === undefined) return finish(res, 403, { error: 'path is outside the workspace' })
  try {
    const metadata = await stat(directory)
    if (!metadata.isDirectory()) return finish(res, 400, { error: 'path is not a directory' })
    const children = await readdir(directory, { withFileTypes: true })
    const entries: DesktopWorkspaceTreeEntry[] = []
    for (const child of children) {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) break
      const childPath = resolve(directory, child.name)
      let kind: DesktopWorkspaceTreeEntry['kind']
      try {
        kind = (await stat(childPath)).isDirectory() ? 'directory' : 'file'
      } catch {
        continue
      }
      entries.push({
        name: child.name,
        path: childPath,
        kind,
        hidden: child.name.startsWith('.'),
      })
    }
    entries.sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name))
    return finish(res, 200, {
      path: directory,
      entries,
      truncated: children.length > entries.length,
    } satisfies DesktopWorkspaceTreeResponse)
  } catch {
    return finish(res, 404, { error: 'directory unavailable' })
  }
}

async function handleFile(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  allowedRoots: AllowedRoots | undefined,
): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET')
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', rendererOrigin)
  const requested = validateWorkspaceFilePath(url.searchParams.get('path'))
  if (requested === undefined) return finish(res, 400, { error: 'invalid path' })
  const filePath = await resolveAllowedPath(requested, allowedRoots)
  if (filePath === undefined) return finish(res, 403, { error: 'path is outside the workspace' })
  try {
    const metadata = await stat(filePath)
    if (!metadata.isFile()) return finish(res, 400, { error: 'path is not a file' })
    if (metadata.size > MAX_FILE_BYTES) return finish(res, 413, { error: 'file is too large' })
    const content = await readFile(filePath, 'utf8')
    return finish(res, 200, { path: filePath, content })
  } catch {
    return finish(res, 404, { error: 'file unavailable' })
  }
}

/** Serve one read-only workspace tree or file request from the loopback renderer. */
export async function handleDesktopWorkspaceFileRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  allowedRoots?: AllowedRoots,
): Promise<void> {
  if (!isSameOriginLoopbackRequest(req, rendererOrigin, false)) {
    finish(res, 403, { error: 'forbidden' })
    return
  }
  const url = new URL(req.url ?? '/', rendererOrigin)
  if (url.pathname === DESKTOP_WORKSPACE_TREE_PATH) {
    await handleTree(req, res, rendererOrigin, allowedRoots)
    return
  }
  await handleFile(req, res, rendererOrigin, allowedRoots)
}
