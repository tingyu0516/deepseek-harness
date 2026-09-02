/** Desktop workspace tree and UTF-8 file routes. */
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'

export const DESKTOP_WORKSPACE_FILE_PATH = '/api/desktop/workspace-file'
export const DESKTOP_WORKSPACE_TREE_PATH = '/api/desktop/workspace-tree'
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_WRITE_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024
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

export type DesktopWorkspaceAllowedRoots = readonly string[] | (() => readonly string[])

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
  return resolve(value)
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, '') || value
}

function rootList(allowedRoots: DesktopWorkspaceAllowedRoots | undefined): readonly string[] | undefined {
  if (allowedRoots === undefined) return undefined
  return (typeof allowedRoots === 'function' ? allowedRoots() : allowedRoots)
    .map(root => validateWorkspaceFilePath(root))
    .filter((root): root is string => root !== undefined)
}

function isInside(root: string, target: string): boolean {
  const from = stripTrailingSeparators(resolve(root))
  const to = stripTrailingSeparators(resolve(target))
  if (process.platform === 'win32') {
    const fromKey = from.toLowerCase()
    const toKey = to.toLowerCase()
    return toKey === fromKey || toKey.startsWith(`${fromKey}\\`)
  }
  const child = relative(from, to)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

/**
 * Resolve a workspace path that stays inside the allowed roots after realpath.
 * @param path - absolute path already passed through {@link validateWorkspaceFilePath}.
 * @param allowedRoots - workspace directories that may be read or overwritten, or a live registry snapshot.
 * @returns the confined path, or undefined when the path is outside every root.
 */
export async function resolveAllowedWorkspacePath(
  path: string,
  allowedRoots: DesktopWorkspaceAllowedRoots | undefined,
): Promise<string | undefined> {
  const roots = rootList(allowedRoots)
  if (roots === undefined) return path
  for (const root of roots) {
    if (!isInside(root, path)) continue
    try {
      const realRoot = await realpath(root)
      try {
        const realTarget = await realpath(path)
        if (isInside(realRoot, realTarget)) return realTarget
      } catch {
        if (isInside(realRoot, path)) return path
      }
    } catch {
      continue
    }
  }
  return undefined
}

async function handleTree(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  allowedRoots: DesktopWorkspaceAllowedRoots | undefined,
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
  const directory = await resolveAllowedWorkspacePath(requested, allowedRoots)
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
  allowedRoots: DesktopWorkspaceAllowedRoots | undefined,
): Promise<void> {
  if (req.method === 'PUT') {
    await handleFileWrite(req, res, allowedRoots)
    return
  }
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET, PUT')
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', rendererOrigin)
  const requested = validateWorkspaceFilePath(url.searchParams.get('path'))
  if (requested === undefined) return finish(res, 400, { error: 'invalid path' })
  const filePath = await resolveAllowedWorkspacePath(requested, allowedRoots)
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

class BodyTooLargeError extends Error {}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) throw new SyntaxError('invalid content length')
    if (Number(declaredLength) > maxBytes) throw new BodyTooLargeError()
  }
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new SyntaxError('invalid content type')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > maxBytes) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function parseWriteBody(value: unknown): { path: string, content: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('path') || !keys.includes('content')) return undefined
  const record = value as { path: unknown, content: unknown }
  if (typeof record.path !== 'string' || typeof record.content !== 'string') return undefined
  return { path: record.path, content: record.content }
}

async function handleFileWrite(
  req: IncomingMessage,
  res: ServerResponse,
  allowedRoots: DesktopWorkspaceAllowedRoots | undefined,
): Promise<void> {
  let value: unknown
  try {
    value = await readJsonBody(req, MAX_WRITE_BODY_BYTES)
  } catch (cause) {
    if (cause instanceof BodyTooLargeError) return finish(res, 413, { error: 'file is too large' })
    return finish(res, 400, { error: 'invalid body' })
  }
  const body = parseWriteBody(value)
  if (body === undefined) return finish(res, 400, { error: 'invalid body' })
  if (Buffer.byteLength(body.content, 'utf8') > MAX_FILE_BYTES) {
    return finish(res, 413, { error: 'file is too large' })
  }
  const requested = validateWorkspaceFilePath(body.path)
  if (requested === undefined) return finish(res, 400, { error: 'invalid path' })
  const filePath = await resolveAllowedWorkspacePath(requested, allowedRoots)
  if (filePath === undefined) return finish(res, 403, { error: 'path is outside the workspace' })
  try {
    const metadata = await stat(filePath)
    if (!metadata.isFile()) return finish(res, 400, { error: 'path is not a file' })
    await writeFile(filePath, body.content, 'utf8')
    return finish(res, 200, { path: filePath, saved: true })
  } catch {
    return finish(res, 404, { error: 'file unavailable' })
  }
}

/** Serve one workspace tree, file read, or file write request from the loopback renderer. */
export async function handleDesktopWorkspaceFileRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  allowedRoots?: DesktopWorkspaceAllowedRoots,
): Promise<void> {
  if (!isSameOriginLoopbackRequest(req, rendererOrigin, req.method !== 'GET')) {
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
