/** Map user-initiated turns and background jobs onto pet activity states. */

import type { PetState } from './contracts.ts'

/** Structural subset of the session events the pet reacts to. */
export interface PetSessionEventLike {
  readonly type: string
  readonly data?: unknown
}

/** Structural session header used to ignore subagent sessions. */
export interface PetSessionLike {
  readonly header: { readonly id: string | number, readonly origin?: string }
}

/** Pet states an activity source can request; `idle` resets a stuck state. */
export type PetActivityEvent = Extract<PetState, 'work' | 'cheer' | 'sad' | 'idle'>

interface OpenTurn {
  readonly turn: number
  userInitiated: boolean
}

function eventFields(event: PetSessionEventLike): Record<string, unknown> {
  return (event.data ?? {}) as Record<string, unknown>
}

/**
 * Track open turns per session and decide which pet state each event requests.
 * Mirrors the desktop notifications row: only direct, user-initiated turns
 * attract attention; subagent sessions never do.
 */
export class PetActivityTracker {
  private readonly openTurns = new Map<string, OpenTurn>()

  /** Observe one session lifecycle event. */
  noteSessionEvent(session: PetSessionLike, event: PetSessionEventLike): PetActivityEvent | undefined {
    if (session.header.origin === 'subagent') return undefined
    const sessionId = String(session.header.id)
    const fields = eventFields(event)

    if (event.type === 'turn/start') {
      const turn = fields.turn
      if (typeof turn !== 'number') return undefined
      this.openTurns.set(sessionId, { turn, userInitiated: false })
      return undefined
    }
    if (event.type === 'user/message') {
      const open = this.openTurns.get(sessionId)
      const source = fields.source as Record<string, unknown> | undefined
      if (open !== undefined && source?.kind === 'user') open.userInitiated = true
      return undefined
    }
    if (event.type === 'turn/end') {
      const open = this.openTurns.get(sessionId)
      if (open === undefined || open.turn !== fields.turn) return undefined
      this.openTurns.delete(sessionId)
      if (!open.userInitiated) return undefined
      const reason = fields.reason as Record<string, unknown> | undefined
      const kind = reason?.kind
      if (kind === 'completed') return 'cheer'
      if (kind === 'error' || kind === 'max-tokens') return 'sad'
      // Cancelled or interrupted turns should still release a "working" pet.
      return 'idle'
    }
    return undefined
  }

  /** Forget one disposed session's pending turn. */
  noteSessionDisposed(session: PetSessionLike): void {
    this.openTurns.delete(String(session.header.id))
  }

  /** Map one background-job outcome onto a pet state. */
  noteJobStatus(status: string): PetActivityEvent | undefined {
    if (status === 'completed') return 'cheer'
    if (status === 'failed') return 'sad'
    return undefined
  }
}
