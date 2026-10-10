/**
 * Host half of dsh-reedit.
 *
 * It contributes nothing on the Host plane on purpose:
 *
 * - Editing and resending use the shipped `remote.session.fork` and the
 *   session prompt entry, so the Host needs no new route and this plugin owns
 *   no Host state.
 * - The plugin appends no session event type of its own. Several community
 *   plugins that write custom events into the log are the ones documented to
 *   break session reopening; this one keeps the log owned by the Harness.
 *
 * The whole feature lives in the browser half (`client.js`).
 */

/** Host entry point; no Host-side registration. */
export function apply() {}
