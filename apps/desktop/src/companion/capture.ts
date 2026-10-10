/**
 * The picture on a decision card — README section 3.5, ADR 0066.
 *
 * The shell filed the capture when it took it (`page_screenshot`, ADR 0025); the card only names
 * the id. This reads the row back from the store and spells it as a `data:` URL, and says in a
 * sentence why when there is nothing to show. Outside the shell there is no store, so a card with
 * an id says it cannot be read here instead of drawing a stand-in.
 */
import { hasShell } from "@/lib/ipc";
import { storeGet, type CaptureRow } from "@/lib/store";

/** What reading one capture came to: a picture, or why not. */
export type CaptureRead = { src: string; problem: null } | { src: null; problem: string };

export async function readCapture(id: string): Promise<CaptureRead> {
  if (!hasShell()) return { src: null, problem: "this window cannot read the store" };
  try {
    const row = await storeGet<CaptureRow>("captures", id);
    if (!row?.png) return { src: null, problem: "the capture is no longer kept" };
    return { src: `data:image/png;base64,${row.png}`, problem: null };
  } catch (error) {
    return {
      src: null,
      problem: `the capture could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
