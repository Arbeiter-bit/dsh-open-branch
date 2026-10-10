/**
 * Browser half of dsh-reedit.
 *
 * Double-click any of your own messages to rewrite it. Confirming forks the
 * session at the event BEFORE the original message, sends the edited text into
 * that branch, and opens the branch in the main panel. The source session is
 * never modified, because a session log is append-only.
 *
 * Why this owns the user bubble: double-click and the hover hint need the
 * bubble's own DOM, and the shipped renderer keeps its action row internal and
 * exposes no hook. This registers `conversation.chat.node` for key `user` at
 * `priority: -1`, shadowing that renderer. A keyed cell accepts a second
 * registration only at a DIFFERENT priority; at 0 it throws.
 */
window.__ModuleLoader__.load({
  // MUST equal the package name in package.json and the row `name` in
  // cordis.patch.yml. The module system matches this factory to the Loader row
  // by this exact id; a mismatch makes the client entry fail to import, and the
  // web boot audit then refuses to mount the whole GUI.
  id: 'dsh-reedit',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * Shared primitive kit, read behind a guard. It is a baseline module for
     * dynamic bundles, but if it is ever unavailable the user bubble must fall
     * back to plain text rather than blank the whole conversation.
     */
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives')
      } catch (_unavailablePrimitives) {
        return undefined
      }
    })()

    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language)
    const LABELS = ZH
      ? {
        edit: '编辑并重发',
        editHint: '双击编辑；保存后会从这条消息之前重新开始，它之后的消息不会进入新分支',
        branchHint: '已从你修改的这条消息重新开始。原对话完整保留在左侧会话列表里。',
        editFailed: '重发失败，点此重试',
        cancel: '取消',
        confirm: '确认重发',
        sending: '正在重发…',
        copy: '复制',
        copied: '已复制',
      }
      : {
        edit: 'Edit and resend',
        editHint: 'Double-click to edit. Saving continues from before this message, so later messages are not carried into the new branch',
        branchHint: 'Restarted from the message you edited. The original conversation is kept in the session list.',
        editFailed: 'Resend failed, click to retry',
        cancel: 'Cancel',
        confirm: 'Resend',
        sending: 'Resending…',
        copy: 'Copy',
        copied: 'Copied',
      }

    /**
     * Which branch came from an edit, and with which message text.
     *
     * This is viewing state, not session data: it exists so the branch can say
     * why it starts where it does. Nothing is appended to the session log — a
     * session log is append-only and no new event type may be written into it.
     */
    const EDITED_BRANCHES_KEY = 'dsh-reedit/branches/v1'

    function readEditedBranches() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(EDITED_BRANCHES_KEY) ?? '{}')
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch (_unavailableStorage) {
        return {}
      }
    }

    function rememberEditedBranch(sessionId, text) {
      try {
        const branches = readEditedBranches()
        branches[sessionId] = text
        window.localStorage.setItem(EDITED_BRANCHES_KEY, JSON.stringify(branches))
      } catch (_unavailableStorage) {
        /* the branch still works; only the hint is lost */
      }
    }

    /** Split one user message's blocks exactly as the shipped bubble does. */
    function userContentParts(content) {
      const texts = []
      const attachments = []
      const rest = []
      for (const block of Array.isArray(content) ? content : []) {
        if (block === null || typeof block !== 'object') { rest.push(block); continue }
        if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
        else if (block.type === 'image' && block.attachment !== undefined) {
          attachments.push({ type: 'image', image: { attachment: block.attachment } })
        } else if (block.type === 'file' && block.attachment !== undefined) {
          attachments.push({ type: 'file', file: block.attachment })
        } else rest.push(block)
      }
      return { text: texts.join(''), attachments, rest }
    }

    /** Local HH:MM for one epoch-ms stamp without pulling in a locale service. */
    function clockText(time) {
      if (typeof time !== 'number') return ''
      const d = new Date(time)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    /**
     * Replacement renderer for the `user` Chat node.
     *
     * Everything the shipped bubble shows is reproduced here: text, reference
     * labels, image attachments through the shared `renderMessageImages` owner
     * prop, file attachments, extra blocks, and the time/copy row.
     */
    function UserMessageRow(props) {
      const { node, sessionId, editResend, renderMessageImages } = props
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [state, setState] = React.useState('idle')
      const [copied, setCopied] = React.useState(false)
      const boxRef = React.useRef(null)
      const data = node.data
      const { text, attachments, rest } = userContentParts(data.content)
      const labels = Array.isArray(data.referenceLabels) ? data.referenceLabels : []
      // This branch was opened by an edit, and this is the message it starts from.
      const isEditedRoot = readEditedBranches()[sessionId] === text && text !== ''

      // Clicking anywhere outside the editor leaves edit mode.
      React.useEffect(() => {
        if (!editing) return undefined
        const onPointerDown = (event) => {
          const box = boxRef.current
          if (box !== null && box.contains(event.target) === false) {
            setEditing(false)
            setState('idle')
          }
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => { document.removeEventListener('mousedown', onPointerDown) }
      }, [editing])

      const iconStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px',
        border: 'none',
        background: 'transparent',
        borderRadius: '4px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)',
      }
      const pencil = h('svg', {
        viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true, style: { display: 'block' },
      },
      h('path', {
        d: 'M11.2 1.9a1.6 1.6 0 0 1 2.3 2.3l-7.2 7.2-3.1.8.8-3.1z',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
      }),
      h('path', { d: 'M10 3.1l2.9 2.9', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }))

      if (editing) {
        return h('div', {
          ref: boxRef,
          'data-dsh-reedit-editor': '',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            margin: '4px 0',
            padding: '8px',
            borderRadius: '8px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
          },
        },
        h('textarea', {
          value: draft,
          rows: 3,
          autoFocus: true,
          onChange: event => { setDraft(event.target.value) },
          style: {
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: '6px',
            padding: '6px',
            font: 'inherit',
            fontSize: '13px',
            color: 'var(--dsw-alias-label-primary)',
            background: 'var(--dsw-alias-bg-base)',
          },
        }),
        h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
        h('button', {
          type: 'button',
          style: { ...iconStyle, fontSize: '12px', padding: '3px 8px' },
          onClick: () => { setEditing(false); setState('idle') },
        }, LABELS.cancel),
        h('button', {
          type: 'button',
          style: { ...iconStyle, fontSize: '12px', padding: '3px 8px', color: 'var(--dsw-alias-brand-primary)' },
          onClick: () => {
            if (state === 'pending' || draft.trim() === '') return
            setState('pending')
            editResend(sessionId, data.seq, draft)
              .then(() => { setEditing(false); setState('idle') })
              .catch(() => { setState('failed') })
          },
        }, state === 'pending' ? LABELS.sending : LABELS.confirm)))
      }

      const bubbleText = typeof primitives?.projectUserText === 'function'
        ? primitives.projectUserText(text, labels, [], 'skill', { openFile: props.openFile, openSkill: props.openSkill })
        : text

      return h('div', {
        'data-dsh-reedit-user': '',
        style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' },
      },
      isEditedRoot && h('div', {
        'data-dsh-reedit-hint': '',
        style: {
          alignSelf: 'flex-end',
          maxWidth: '100%',
          padding: '4px 10px',
          borderRadius: '8px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: 'var(--dsw-alias-label-secondary)',
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px dashed var(--dsw-alias-border-l2)',
        },
      }, LABELS.branchHint),
      attachments.length > 0 && h('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-end' },
      }, attachments.map((attachment, index) => attachment.type === 'image' && typeof renderMessageImages === 'function'
        ? h(React.Fragment, { key: `image:${index}` },
          renderMessageImages({ images: [attachment.image], align: 'end', compact: attachments.length > 1 }))
        : h('span', {
          key: `file:${index}`,
          title: attachment.file?.name ?? '',
          style: {
            padding: '2px 8px',
            borderRadius: '6px',
            fontSize: '12px',
            border: '1px solid var(--dsw-alias-border-l1)',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, attachment.file?.name ?? ''))),
      (text !== '' || rest.length > 0) && h('div', {
        title: LABELS.editHint,
        onDoubleClick: () => { setDraft(text); setEditing(true) },
        style: {
          maxWidth: '100%',
          padding: '8px 12px',
          borderRadius: '12px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '14px',
          lineHeight: 1.5,
          color: 'var(--dsw-alias-label-primary)',
          // A faint blue wash so a user message cannot be mistaken for an
          // assistant reply. The theme exposes no blue alias token
          // (`--dsw-alias-brand-primary` resolves to the neutral primary-action
          // colour, which mixes to grey), so this is a literal blue mixed
          // against the layered surface: opaque and readable in both themes.
          // The 12% is the one number worth tuning.
          background: 'color-mix(in srgb, #2563eb 12%, var(--dsw-alias-bg-layer-2))',
          cursor: 'text',
        },
      }, bubbleText, rest.map((block, index) => h('pre', {
        key: index,
        style: { margin: '6px 0 0', fontSize: '12px', whiteSpace: 'pre-wrap', opacity: 0.7 },
      }, JSON.stringify(block, null, 2)))),
      labels.length > 0 && h('div', {
        style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      }, labels.join('、')),
      h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          color: 'var(--dsw-alias-label-secondary)',
        },
      },
      h('span', null, clockText(data.time)),
      h('button', {
        type: 'button',
        title: copied ? LABELS.copied : LABELS.copy,
        'aria-label': LABELS.copy,
        style: iconStyle,
        onClick: () => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            window.setTimeout(() => { setCopied(false) }, 1200)
          }).catch(() => undefined)
        },
      }, h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 5, y: 5, width: 8, height: 9, rx: 1.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M3.5 10.5V3.2A1.2 1.2 0 0 1 4.7 2h6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }))),
      h('button', {
        type: 'button',
        title: state === 'failed' ? LABELS.editFailed : LABELS.editHint,
        'aria-label': LABELS.edit,
        style: {
          ...iconStyle,
          color: state === 'failed' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
        },
        'data-dsh-reedit-edit': state,
        onClick: () => { setDraft(text); setEditing(true) },
      }, pencil)))
    }

    return {
      inject: ['slots', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        // Rewrite one turn's user message: fork at the event BEFORE the original
        // so the branch never contains it, send the edited text into that branch,
        // then show the branch in the main panel. The source is left untouched.
        const editResend = async (hostSessionId, userSeq, text) => {
          const cwd = ctx.sessions.list.getSnapshot().byId[hostSessionId]?.cwd
          const childId = userSeq > 0
            ? await ctx.sessions.fork({ sessionId: hostSessionId, atSeq: userSeq - 1, increaseTitle: true })
            : await ctx.sessions.create(cwd === undefined ? {} : { cwd })
          const outcome = await ctx.sessions.using(childId, { source: 'editResend' }, reference =>
            reference.binding.session.prompt([{ type: 'text', text }], 'queue'))
          if (outcome === null || typeof outcome !== 'object' || outcome.ok !== true) {
            throw new Error(`dsh-reedit: the resend was not accepted (${JSON.stringify(outcome)})`)
          }
          ctx.uiWorkspace.openSession(childId)
          // Record the viewing hint before the branch renders.
          rememberEditedBranch(childId, text)
        }

        // Own the `user` Chat node: only the bubble's own DOM can carry
        // double-click editing and the hover hint, which the shipped bubble
        // keeps internal. The lowest priority wins the cell.
        ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'user',
          priority: -1,
          inject: () => ({ editResend }),
        }, UserMessageRow)), 'dsh-reedit: user message renderer')
      },
    }
  },
})
