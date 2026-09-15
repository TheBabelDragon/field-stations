/** Decoder state machine. Lost sync always returns to SEARCH. */

export const STATE = {
  NO_SIGNAL: "NO SIGNAL",
  SIGNAL_FOUND: "SIGNAL FOUND",
  SEARCHING: "SEARCHING FOR LED",
  SYNC_FOUND: "SYNC FOUND",
  CLOCK_LOCK: "CLOCK LOCK",
  FRAME_START: "FRAME START",
  FRAME_CORRUPT: "FRAME CORRUPT",
  FRAME_RECOVERED: "FRAME RECOVERED",
  FRAME_VALID: "FRAME VALID",
  FRAME_LOST: "FRAME LOST",
};

export function nextState({ brightness, variance, decoded }) {
  if (brightness < 0.04 && variance < 0.002) return STATE.NO_SIGNAL;
  if (!decoded || decoded.rejected === "sync-not-found") return STATE.SIGNAL_FOUND;
  if (decoded.rejected === "crc-mismatch" || decoded.rejected === "ecc-uncorrectable") {
    return STATE.FRAME_CORRUPT;
  }
  if (decoded.rejected) return STATE.FRAME_LOST;
  if (decoded.frame?.recovered) return STATE.FRAME_RECOVERED;
  if (decoded.frame) return STATE.FRAME_VALID;
  return STATE.SEARCHING;
}
