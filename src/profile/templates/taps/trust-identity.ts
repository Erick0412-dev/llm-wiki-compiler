/**
 * @file src/profile/templates/taps/trust-identity.ts
 * @description The trust identity of a configured tap source: its index URL,
 * origin, and current TAP key. Re-adding a retained source (template taps and
 * provider sources alike) may only proceed when this identity is unchanged, so
 * that a re-add can never silently reset trust to a different publisher.
 */
import type { TapSourceState } from "./state-types.js";

/** Whether two source records name the same index, origin, and TAP key. */
export function sameTapTrustIdentity(existing: TapSourceState, proposed: TapSourceState): boolean {
  return existing.indexUrl === proposed.indexUrl && existing.origin === proposed.origin
    && existing.currentTapKey.keyId === proposed.currentTapKey.keyId
    && existing.currentTapKey.publicKey === proposed.currentTapKey.publicKey;
}
