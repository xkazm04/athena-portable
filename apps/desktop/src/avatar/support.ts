/**
 * Whether this computer can draw her face at all - ADR 0120 decision 6, measured rather than declared.
 *
 * A picker asks before it offers a form: a WebGL2 context is made once per window on a throwaway
 * canvas, the answer kept, and the probe's context released at once so it never holds one of the
 * browser's few GL contexts. No WebGL2 constructor (an old engine, jsdom) answers no without a probe.
 * It says nothing about a form that fails to load later; `<Avatar fallback>` covers that.
 */
let answer: boolean | null = null;

export function canDrawFace(): boolean {
  if (answer !== null) return answer;
  answer = probe();
  return answer;
}

function probe(): boolean {
  if (typeof WebGL2RenderingContext === "undefined" || typeof document === "undefined") return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
