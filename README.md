# dsh-reedit

Double-click any of your own messages to rewrite it and resend from that point.
The original conversation is untouched.

## What it does

Hovering one of your messages shows the hint; **double-click** it to open an
editor prefilled with that message. Confirming:

1. forks the session at the event **before** the original message, so neither it
   nor any later message is carried into the new branch,
2. sends the edited text into that branch, and
3. opens the branch in the **main panel**.

Clicking anywhere outside the editor leaves edit mode without saving.

The original session is never modified — nothing is rewritten in place, because a
session log is append-only. Editing message *n*-1 is therefore the reason message
*n* does not appear in the new branch: the branch starts before *n*-1.

Your messages also get a faint blue bubble, so a user message cannot be mistaken
for an assistant reply.

## Why it owns the user bubble

Double-click and the hover hint need the bubble's own DOM, and the shipped
renderer keeps its action row internal and exposes no hook. This plugin
registers `conversation.chat.node` for key `user` at `priority: -1`, shadowing
that renderer.

A keyed cell accepts a second registration only at a **different** priority; at
priority 0 it throws
`keyed slot ... already has an entry for key "user" at priority 0`, and a throw
in a client entry makes the web boot audit refuse to mount the whole GUI. The
priority is load-bearing.

The replacement reproduces text, reference labels, image attachments (through
the shared `renderMessageImages` owner prop), extra blocks and the time/copy row;
file cards and bubble styling are hand-written and may differ slightly from the
host. `@deepseek-ai/dsh-client-ui-primitives` is read behind a `try/catch`, so a
missing kit degrades to plain text instead of blanking the conversation.

## Install

    dsh plugin --profile <profile> add github:Arbeiter-bit/dsh-reedit

Pinned:

    dsh plugin --profile <profile> add github:Arbeiter-bit/dsh-reedit#v0.1.0

## Verification

The web boot audit (`assertEntriesActive`) refuses to mount the **whole GUI**
when any client entry fails to activate, so every release is checked by loading
the composed profile in a fresh browser page with an empty module table and
reading the console:

    v0.1.0  title: DeepSeek Harness   console errors: 0

## Known limitations

- The bubble colour is a literal blue (`#2563eb` at 12%), mixed against the
  layered surface so it stays readable in light and dark themes. The theme
  exposes no blue alias token — `--dsw-alias-brand-primary` resolves to the
  neutral primary-action colour, which mixes to grey.
- The action row is a reimplementation; file cards and spacing are hand-written.
- Editing cannot edit a message in place, because session logs are append-only.

## License

MIT
