import { describe, expect, it } from 'vitest'
import { PetActivityTracker } from '../src/pet-events.ts'

const SESSION = { header: { id: 's1' } }
const SUBAGENT = { header: { id: 's2', origin: 'subagent' } }

function turnStart(turn = 1) {
  return { type: 'turn/start', data: { turn } }
}

function userMessage() {
  return { type: 'user/message', data: { source: { kind: 'user' } } }
}

function turnEnd(turn: number, kind: string) {
  return { type: 'turn/end', data: { turn, reason: { kind } } }
}

describe('PetActivityTracker', () => {
  it('cheers for a completed user-initiated turn', () => {
    const tracker = new PetActivityTracker()
    expect(tracker.noteSessionEvent(SESSION, turnStart())).toBeUndefined()
    expect(tracker.noteSessionEvent(SESSION, userMessage())).toBeUndefined()
    expect(tracker.noteSessionEvent(SESSION, turnEnd(1, 'completed'))).toBe('cheer')
  })

  it('is sad for failed turns', () => {
    const tracker = new PetActivityTracker()
    tracker.noteSessionEvent(SESSION, turnStart())
    tracker.noteSessionEvent(SESSION, userMessage())
    expect(tracker.noteSessionEvent(SESSION, turnEnd(1, 'error'))).toBe('sad')
    tracker.noteSessionEvent(SESSION, turnStart(2))
    tracker.noteSessionEvent(SESSION, userMessage())
    expect(tracker.noteSessionEvent(SESSION, turnEnd(2, 'max-tokens'))).toBe('sad')
  })

  it('resets to idle when a turn ends any other way', () => {
    const tracker = new PetActivityTracker()
    tracker.noteSessionEvent(SESSION, turnStart())
    tracker.noteSessionEvent(SESSION, userMessage())
    expect(tracker.noteSessionEvent(SESSION, turnEnd(1, 'cancelled'))).toBe('idle')
  })

  it('ignores turns the user never initiated', () => {
    const tracker = new PetActivityTracker()
    tracker.noteSessionEvent(SESSION, turnStart())
    expect(tracker.noteSessionEvent(SESSION, turnEnd(1, 'completed'))).toBeUndefined()
  })

  it('ignores subagent sessions entirely', () => {
    const tracker = new PetActivityTracker()
    tracker.noteSessionEvent(SUBAGENT, turnStart())
    tracker.noteSessionEvent(SUBAGENT, userMessage())
    expect(tracker.noteSessionEvent(SUBAGENT, turnEnd(1, 'completed'))).toBeUndefined()
  })

  it('ignores mismatched turn numbers', () => {
    const tracker = new PetActivityTracker()
    tracker.noteSessionEvent(SESSION, turnStart(7))
    tracker.noteSessionEvent(SESSION, userMessage())
    expect(tracker.noteSessionEvent(SESSION, turnEnd(6, 'completed'))).toBeUndefined()
  })

  it('forgets pending turns when a session is disposed', () => {
    const tracker = new PetActivityTracker()
    tracker.noteSessionEvent(SESSION, turnStart())
    tracker.noteSessionEvent(SESSION, userMessage())
    tracker.noteSessionDisposed(SESSION)
    expect(tracker.noteSessionEvent(SESSION, turnEnd(1, 'completed'))).toBeUndefined()
  })

  it('maps job outcomes', () => {
    const tracker = new PetActivityTracker()
    expect(tracker.noteJobStatus('completed')).toBe('cheer')
    expect(tracker.noteJobStatus('failed')).toBe('sad')
    expect(tracker.noteJobStatus('running')).toBeUndefined()
  })
})
