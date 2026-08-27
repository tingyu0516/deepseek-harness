/** Map user-initiated turns and background jobs onto pet activity states. */
import type { PetState } from './contracts.ts';
/** Structural subset of the session events the pet reacts to. */
export interface PetSessionEventLike {
    readonly type: string;
    readonly data?: unknown;
}
/** Structural session header used to ignore subagent sessions. */
export interface PetSessionLike {
    readonly header: {
        readonly id: string | number;
        readonly origin?: string;
    };
}
/** Pet states an activity source can request; `idle` resets a stuck state. */
export type PetActivityEvent = Extract<PetState, 'work' | 'cheer' | 'sad' | 'idle'>;
/**
 * Track open turns per session and decide which pet state each event requests.
 * Mirrors the desktop notifications row: only direct, user-initiated turns
 * attract attention; subagent sessions never do.
 */
export declare class PetActivityTracker {
    private readonly openTurns;
    /** Observe one session lifecycle event. */
    noteSessionEvent(session: PetSessionLike, event: PetSessionEventLike): PetActivityEvent | undefined;
    /** Forget one disposed session's pending turn. */
    noteSessionDisposed(session: PetSessionLike): void;
    /** Map one background-job outcome onto a pet state. */
    noteJobStatus(status: string): PetActivityEvent | undefined;
}
