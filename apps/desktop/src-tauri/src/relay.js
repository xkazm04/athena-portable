/**
 * The relay's half of the bridge, in the page (packages/athena-bridge/protocol.md).
 *
 * `inject.js` is injected beside this file and owns `document.modelContext`; it decides nothing and
 * speaks only `window.postMessage`, because the same file has to run under an extension, a webview
 * and whatever surface comes next. This file is the shell-specific half: it carries those messages
 * across the process boundary and back.
 *
 *   surface → page   a `page:request` Tauri event → `postMessage({ dir: "to-page", … })`
 *   page → surface   a `to-ext` message → a `page:reply` Tauri event
 *
 * Both guards from the protocol are applied here as well as in `inject.js`, and that is deliberate
 * duplication rather than an oversight. `inject.js` guards what it *reads*; this file guards what it
 * *forwards to the shell*, and an iframe that could reach the shell through the relay would not be
 * made safe by the other file's caution.
 *
 * The capability that grants this script its two Tauri permissions is `capabilities/page-bridge.json`,
 * and it grants exactly two: emit an event, and listen for one. A page cannot reach any command.
 */

(() => {
  const NS = "athena-webmcp";
  const REQUEST = "page:request";
  const REPLY = "page:reply";

  // A frame is not the page. `inject.js` installs nothing in one; the relay forwards nothing
  // from one either, so an advertisement cannot answer a `list` on the page's behalf.
  if (window.top !== window) return;

  const tauri = window.__TAURI__;
  if (!tauri || !tauri.event) return;

  const label = window.__ATHENA_WEBVIEW__ || "";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.__ns !== NS || message.dir !== "to-ext") return;
    // The webview label rides along because one shell holds several pages and a reply that did
    // not say which page it came from would be matched to whichever request was pending.
    tauri.event.emit(REPLY, { label, message }).catch(() => {});
  });

  tauri.event
    .listen(REQUEST, (event) => {
      const payload = event && event.payload;
      if (!payload || (payload.label && payload.label !== label)) return;
      const message = payload.message;
      if (!message || message.__ns !== NS || message.dir !== "to-page") return;
      window.postMessage(message, location.origin);
    })
    .catch(() => {});

  // Tell the shell the page is ready to be asked. A relay that waited for the shell to poll would
  // miss the tools a page registers during load, which is when most pages register them.
  const announce = () => {
    tauri.event.emit(REPLY, { label, message: { __ns: NS, dir: "to-ext", id: null, type: "ready" } }).catch(() => {});
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announce, { once: true });
  } else {
    announce();
  }
})();
