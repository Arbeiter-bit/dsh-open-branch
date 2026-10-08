# dsh-open-branch

One writable **side conversation** per session, in the right Sidebar — the main
conversation keeps running untouched.

## What it does

A small entry in the composer toolbar opens a side conversation. The first open
forks the current session once, at its latest completed turn; **every later open
reuses that same side session**, so opening it again never piles up forks.

The side session is an ordinary DSH Session, so the panel is fully writable: you
can keep asking there, and the main conversation is unaffected.

The entry is not contributed for a blank session — there is no completed turn to
fork from yet, so contributing nothing is better than an entry that fails.

## Status

v0.2.0. Cold boot verified in a fresh browser page, not inferred from
registration.

The web boot audit (`assertEntriesActive`) refuses to mount the **whole GUI**
when any client entry fails to activate, so a broken plugin here costs the user
their whole editor, not just the plugin. Every release is checked against that
audit by loading the composed profile in a fresh page with an empty module
table and reading the console:

```
v0.2.0  title: DeepSeek Harness   nodes: 387   console errors: 0
        composer entry absent on a blank session (correct)
        composer entry present with its tooltip on a session with history
```

**v0.1.1 and earlier are known-bad.** The package was renamed without renaming
the `__ModuleLoader__` factory id, so the client entry failed to import and the
GUI refused to boot (`web boot: 1 entry did not activate`).

Known gap: the open → panel → scroll path has not been exercised end to end by a
human. Earlier releases mounted the panel but its conversation could not be
scrolled; v0.1.1 added the `display:flex / width:100% / height:100% /
min-height:0` tab box the shipped sidebar chat uses, and that fix is still
awaiting hands-on confirmation.

## Why it is different

| | dsh-sidebar-qa | dsh-nested-followups | dsh-side-branch (Side Ask) | **dsh-open-branch** |
|---|---|---|---|---|
| Panel per session | one | branches in its own Tree View | one, rebuilt every turn | **one, created once** |
| Side conversation | writable | read-only tools | **read-only by design** | **writable** |
| Where it lives | right Sidebar | its own Tree View | right Sidebar | **right Sidebar** |
| Shadows shipped UI | no | no | no | **no** |
| Writes custom session events | — | — | — | **no** |

Design commitments, each chosen against a failure mode observed in a competitor:

1. **No custom session event type.** The plugin appends nothing to the session
   log. Several community plugins that do have documented log-corruption and
   reopen failures; this one keeps the log owned by the Harness, so fork,
   resume, replay and export keep working.
2. **No shadowing of shipped UI.** It registers its own tab type and its own
   child slot (`sidebranch.conversation`) instead of replacing
   `sidebar.chat.conversation`, and it disables no built-in component.
3. **One side session, created once.** The host-to-side binding is kept in
   memory and mirrored to `localStorage`, and creation is serialized, so a
   second open reveals the same tab instead of forking again.
4. **Official fork lifecycle.** Forking goes through the shipped
   `remote.session.fork`, so the child carries real lineage and the Harness owns
   the cut, the synthetic closers, and the title.
5. **Reference-scoped lifetime.** The side Session is retained through the
   resource provider for exactly as long as its tab exists, and released on the
   tab's abort signal.

## How it works

- Host half (`index.js`): contributes nothing. No route, no service, no state.
- Browser half (`client.js`):
  - registers a `sidebranch` resource protocol whose address is **one per host
    session** (`dsh-resource://sidebranch/for/<hostSessionId>`), which is what
    makes the panel a singleton and makes a repeat open reveal the same tab;
  - registers the `sidebranch` right-Sidebar tab type and its body;
  - declares and fills the `sidebranch.conversation` child slot with the shared
    `conversation.content` factory, so the embedded conversation is the real one;
  - adds one `conversation.input.right` entry — the composer-toolbar button.

## Install

This plugin is distributed through GitHub only; it is not published to npm.

```sh
dsh plugin --profile <profile> add github:Arbeiter-bit/dsh-open-branch
```

Pin a revision when you want a reproducible install:

```sh
dsh plugin --profile <profile> add github:Arbeiter-bit/dsh-open-branch#v0.2.0
```

The GUI **Plugins → Add plugin** dialog accepts the same spec. Restart or
refresh the page afterwards so the browser half loads.

Uninstall:

```sh
dsh plugin --profile <profile> remove dsh-open-branch
```

## Limitations

- A blank session contributes no entry; the first side conversation needs one
  completed turn in the main session.
- The side session is a fork at the main session's latest completed turn at the
  moment it is created. Later turns of the main session are **not** visible in
  the side conversation — that is the price of a real, independent, writable
  session, and it is the opposite trade from plugins that rebuild the branch
  from the main session every turn.
- Deleting the side session outside the plugin leaves a stale binding in
  `localStorage`; the next open detects the missing session and forks a new one.
- Localized labels are chosen from `navigator.language` (zh/en); the Client
  locale service is not wired yet.

## Roadmap

- Edit a sent message and continue from that point (the `rewrite` origin kind
  the Client already reserves but nothing produces).
- An explicit "the side session sees the main session as of creation" note in
  the panel, so the frozen-context trade is visible rather than surprising.

## License

MIT
