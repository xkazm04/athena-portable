/**
 * Plain words for a refusal — README section 3.1 (surfaces), UAT backlog B13 and B1.
 *
 * The daemon answers in one closed vocabulary (`ERROR_REASONS`); a person should never have to read
 * it. These are pure functions from a reason code to one sentence, so a screen shows the sentence
 * and keeps the code only in the expanded record. No sentence here may use the words the user never
 * chose: origin, manifest, session, daemon, engine_error, or a Python exception name.
 */

/** The clause after "That answer was refused:". Lower case, no full stop. */
export function plainReason(reason: string): string {
  switch (reason) {
    case "foreign_origin":
      return "this decision belongs to a different app than the one in front of you";
    case "no_manifest":
    case "manifest_invalid":
      return "Athena has not been shown what this app can do";
    case "foreign_token":
      return "the request did not come from Athena's own window";
    case "unknown_ref":
      return "that decision is no longer waiting";
    case "expired":
      return "it ran out of time";
    case "pending_approval":
      return "it is still waiting for an answer";
    case "validator_failed":
      return "the details no longer match what was asked";
    case "user_denied":
      return "it was already declined";
    case "disabled_origin":
    case "origin_disabled":
      return "Athena was told not to act on this app";
    case "not_ready":
      return "Athena is still starting";
    case "unreachable":
      return "Athena did not answer";
    default:
      return "Athena could not carry it out";
  }
}

/** The one sentence shown under the buttons when an answer did not go through. */
export function refusalSentence(reason: string): string {
  return `That answer was refused: ${plainReason(reason)}. Focus the app this decision is about and try again.`;
}

/** The reason code an error from the daemon client carries, or a stand-in for one that never arrived. */
export function reasonOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const { reason, status } = error as { reason: unknown; status?: unknown };
    if (typeof reason === "string" && reason !== "unknown") return reason;
    if (status === 0) return "not_ready";
  }
  if (error instanceof TypeError) return "unreachable";
  return "unknown";
}

/**
 * What a stopped turn says to a person. `engine` is the engine's name for a person ("Claude Code");
 * the technical detail is kept by the caller for the expanded record and is never part of this.
 */
export function plainFailure(reason: string, engine: string): string {
  switch (reason) {
    case "engine_error":
      return `Athena could not start ${engine} on this computer. Check Setup.`;
    case "foreign_origin":
      return "Athena could not work on this tab. Click the app you want her to work on, then ask again.";
    case "no_manifest":
    case "manifest_invalid":
      return "Athena has not been shown what this app can do. Reload the app and ask again.";
    case "disabled_origin":
    case "origin_disabled":
      return "Athena was told not to act on this app. Press Act here again in Main to ask again.";
    case "not_ready":
    case "unreachable":
      return "Athena is still starting. Try again in a moment.";
    case "no_page":
      return "Open a page first. Athena works inside the app you are looking at.";
    case "timeout":
      return "That took too long, so Athena stopped it.";
    case "budget_exhausted":
      return "Athena stopped after too many steps on one request.";
    case "parse_error":
      return "Athena could not read the answer she got back.";
    case "cancelled":
      return "That request was cancelled.";
    case "unknown_ref":
      return "Athena could not find what that request pointed at.";
    default:
      return "Something went wrong and Athena stopped. The technical detail is in the record.";
  }
}
