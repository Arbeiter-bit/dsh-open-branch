# dsh-open-branch

Fork a **writable** side conversation from **any completed turn** of the current
DSH session, in the right Sidebar — without interrupting the main task.

## Status

v0.1.1. The fork action and the sidebar tab are verified registered and live
(Inspect: `dsh-open-branch` in `sidebar.right.pane.tab`,
`dsh-open-branch:branch-here` in `conversation.chat.turnTail`).

v0.1.0 shipped with a layout defect: the tab body had no height constraint, so
the embedded conversation could not be scrolled with the wheel. v0.1.1 adds the
`display:flex / width:100% / height:100% / min-height:0` box the shipped
sidebar chat tab uses. **That fix has not yet been confirmed in a browser.**

## What it does

Every completed turn gains an action: **Branch in sidebar**. Clicking it forks
the current session at that turn's own event seq and opens the child in a right
Sidebar tab. The child is an ordinary DSH Session, so it is fully writable: you
can keep asking there, and the main conversation keeps running untouched.

## Why it is different

| | dsh-sidebar-qa | dsh-nested-followups | **dsh-open-branch** |
|---|---|---|---|
| Fork point | last completed turn only | any answer, but only inside its own Tree View | **any completed turn, in place** |
| Side conversation | writable | read-only branch tools | **writable** |
| Where it lives | right Sidebar | its own Tree View | **right Sidebar** |
| Shadows shipped UI | no | no | **no** |
| Writes custom session events | — | — | **no** |

Design commitments, each chosen against a failure mode observed in a
competitor:

1. **No custom session event type.** The plugin appends nothing to the session
   log. Several community plugins that do have documented log-corruption and
   reopen failures; this one keeps the log owned by the Harness, so fork,
   resume, replay and export keep working.
2. **No shadowing of shipped UI.** It registers its own tab type and its own
   child slot (`sidebranch.conversation`) instead of replacing
   `sidebar.chat.conversation`, and it disables no built-in component.
3. **Official fork lifecycle.** Forking goes through the shipped
   `remote.session.fork`, so the child carries real lineage and the Harness owns
   the cut, the synthetic closers, and the title.
4. **Reference-scoped lifetime.** The child Session is retained through the
   resource provider for exactly as long as its tab exists, and released on the
   tab's abort signal.

## How it works

- Host half (`index.js`): contributes nothing. No route, no service, no state.
- Browser half (`client.js`):
  - registers a `sidebranch` resource protocol that retains the forked Session;
  - registers the `sidebranch` right-Sidebar tab type and its body;
  - declares and fills the `sidebranch.conversation` child slot with the shared
    `conversation.content` factory, so the embedded conversation is the real one;
  - adds one `conversation.chat.turnTail` entry ordered at 40.

## Install

This plugin is distributed through GitHub only; it is not published to npm.

```sh
dsh plugin --profile <profile> add github:Arbeiter-bit/dsh-open-branch
```

Pin a revision when you want a reproducible install:

```sh
dsh plugin --profile <profile> add github:Arbeiter-bit/dsh-open-branch#v0.1.1
```

The GUI **Plugins → Add plugin** dialog accepts the same spec. Restart or
refresh the page afterwards so the browser half loads.

Uninstall:

```sh
dsh plugin --profile <profile> remove dsh-open-branch
```

## Limitations (v0.1)

- The action appears on completed turns; an in-flight turn has no fork boundary.
- A fork cut at a turn's closing assistant message leaves that turn's own
  `turn/end` out of the child, which the Harness closes with a synthetic
  `forked` closer. The branch therefore continues as a resume, not as a
  mid-turn replay.
- No UI to pick an arbitrary event seq, only whole turns.
- Localized labels are chosen from `navigator.language` (zh/en); the Client
  locale service is not wired yet.

## Roadmap

- v0.2 — edit a sent message and fork from that point (the `rewrite` origin kind
  the Client already reserves but nothing produces).
- v0.3 — file-state restore points anchored to the same fork boundaries, with an
  explicit "shell side effects are not covered" statement.

## License

MIT
