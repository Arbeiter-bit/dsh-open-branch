/**
 * Host half of dsh-side-branch.
 *
 * v0.1 contributes nothing on the Host plane on purpose:
 * - Forking uses the shipped `remote.session.fork` API, so the Host needs no
 *   new route and the plugin needs no Host state.
 * - The plugin appends no session event type of its own. Competitors that
 *   write custom events into the log are the ones documented to break session
 *   reopening; this plugin keeps the log owned by the Harness.
 *
 * The whole feature lives in the browser half (`client.js`).
 */

/** Host entry point; no Host-side registration in v0.1. */
export function apply() {}
