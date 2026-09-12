/**
 * What a user types into an address field is rarely a URL — README section 3.1, the browsing
 * surface.
 *
 * Bare hosts get a scheme; anything that already has one is left alone and `Url::parse` on the
 * Rust side is the judge of it. The one trap worth a rule: `localhost:3004` has the shape of a
 * scheme exactly as `https:` does, so a colon followed by a digit is read as a port, not a
 * scheme. Everything else keeps the shape test rather than an allowlist, so `file:`, `about:` and
 * `mailto:` still pass through untouched.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SCHEME_THEN_PORT = /^[a-z][a-z0-9+.-]*:\d/i;

export function normaliseUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (HAS_SCHEME.test(text) && !SCHEME_THEN_PORT.test(text)) return text;
  return `http://${text}`;
}

/** The host of a URL, for a label that must not be a whole address. Falls back to the input. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
