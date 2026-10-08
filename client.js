/**
 * Browser half of dsh-side-branch.
 *
 * What it adds:
 * - One action on every completed turn: open that turn in a side conversation.
 * - A right-Sidebar tab type that hosts that side conversation and stays
 *   writable, because it is an ordinary DSH Session (an official fork), not a
 *   read-only transcript.
 *
 * It writes no session event type of its own, shadows no shipped UI, and adds
 * no Host route: forking uses the shipped `remote.session.fork`.
 */
window.__ModuleLoader__.load({
  // MUST equal the package name in package.json and the row `name` in
  // cordis.patch.yml. The module system matches this factory to the Loader row
  // by this exact id; a mismatch makes the client entry fail to import, and the
  // web boot audit then refuses to mount the whole GUI.
  id: 'dsh-open-branch',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Implementation identity of this tab type inside the Sidebar registry. */
    const TAB_ID = 'dsh-open-branch'
    /** Page kind this plugin owns. */
    const TAB_KIND = 'sidebranch'
    /** Resource protocol claimed by this plugin. */
    const PROTOCOL = 'sidebranch'
    /** Canonical address prefix for one side-branch conversation. */
    const ADDRESS_PREFIX = `dsh-resource://${PROTOCOL}/session/`
    /** Child slot declared by this tab body; distinct from ui-subagent's. */
    const CONVERSATION_SLOT = 'sidebranch.conversation'

    const LABELS = (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language))
      ? {
        branch: '在侧栏分叉',
        branchTip: '从这一轮开一个可写的侧边对话，主任务不受影响',
        title: '侧分支',
        failed: '分叉失败',
      }
      : {
        branch: 'Branch in sidebar',
        branchTip: 'Open a writable side conversation from this turn; the main task keeps running',
        title: 'Side branch',
        failed: 'Fork failed',
      }

    /**
     * Build the canonical address of one side-branch tab.
     * @param childSessionId - the forked Session.
     * @param originSessionId - the Session it was forked from.
     * @param seq - inclusive source event seq of the fork cut.
     * @returns a `dsh-resource://` address this plugin's type claims.
     */
    function sideBranchAddress(childSessionId, originSessionId, seq) {
      const query = new URLSearchParams({ origin: originSessionId, seq: String(seq) })
      return `${ADDRESS_PREFIX}${encodeURIComponent(childSessionId)}?${query}`
    }

    /**
     * Parse one side-branch address.
     * @param value - candidate resource address.
     * @returns the decoded facts, or undefined for another or malformed address.
     */
    function parseSideBranchAddress(value) {
      let url
      try {
        url = new URL(value)
      } catch (_invalidUrl) {
        return undefined
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== PROTOCOL) return undefined
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'session') return undefined
      try {
        return {
          childSessionId: decodeURIComponent(parts[1]),
          originSessionId: url.searchParams.get('origin') ?? '',
          seq: Number(url.searchParams.get('seq') ?? '0'),
        }
      } catch (_invalidEncoding) {
        return undefined
      }
    }

    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve()
      return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }

    /** Retain the forked Session for exactly as long as its tab is open. */
    function sideBranchResourceProvider(sessions) {
      return {
        protocol: PROTOCOL,
        async *open(resourceAddress, { signal }) {
          const parsed = parseSideBranchAddress(resourceAddress)
          if (parsed === undefined) throw new Error(`dsh-side-branch: invalid address "${resourceAddress}"`)
          if (signal.aborted) return
          const reference = sessions.retain(parsed.childSessionId, { source: 'sideBranch', signal })
          try {
            yield { ok: true, value: { parsed, reference } }
            await waitForAbort(signal)
          } finally {
            reference.release()
          }
        },
      }
    }

    /** Force the embedded Conversation onto its Chat view. */
    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    /** The Conversation body of one side-branch Session. */
    function ConversationPanel(props) {
      const { sessionId, useSession, useConversation, useSessions, renderFactorySlot } = props
      const session = useSession(value => value)
      const conversation = useConversation(value => value)
      const active = conversation.activeTargets.size > 0
        || (!session.blank && !session.awaitingFirstTurn)
        || session.running
      const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
      const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
      const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
      const phase = settling ? 'settling' : hero ? 'hero' : 'active'
      return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
        slots: { views: FixedChatConversationView },
      })
    }

    /** Tab body: bind the retained child Session around its Conversation. */
    function SideBranchTab(props) {
      const { useResource, useTabInfo, SessionProvider, renderSlot } = props
      const { tab } = useTabInfo()
      const resource = useResource(tab.contentId)
      return h('div', {
        'data-side-branch': '',
        // Must bound this box, or the embedded Conversation has no measurable
        // height and its scroll container never becomes scrollable.
        style: { display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0 },
      },
      resource.value === undefined
        ? null
        : h(SessionProvider, { session: resource.value.reference },
          renderSlot(CONVERSATION_SLOT, {})))
    }

    /** Per-turn action: fork here and open the side conversation. */
    function BranchTurnAction(props) {
      const { sessionId, seq, forkAt } = props
      const [state, setState] = React.useState('idle')
      return h('button', {
        type: 'button',
        title: state === 'failed' ? LABELS.failed : LABELS.branchTip,
        'aria-label': LABELS.branch,
        'data-side-branch-action': state,
        onClick: () => {
          if (state === 'pending') return
          setState('pending')
          forkAt(sessionId, seq)
            .then(() => { setState('idle') })
            .catch(() => { setState('failed') })
        },
      }, LABELS.branch)
    }

    return {
      inject: ['slots', 'sessions', 'resources', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        // The provider holds one session reference per open side-branch tab.
        ctx.effect(
          () => ctx.resources.register(sideBranchResourceProvider(ctx.sessions)),
          'dsh-side-branch: resources',
        )

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          patterns: [`${ADDRESS_PREFIX}**`],
          priority: 'extension',
          canOpen: address => parseSideBranchAddress(address) !== undefined,
          title: () => LABELS.title,
        }), 'dsh-side-branch: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
        }, SideBranchTab)), 'dsh-side-branch: tab body')

        ctx.effect(() => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
          name: CONVERSATION_SLOT,
        }, ConversationPanel)), 'dsh-side-branch: conversation')

        ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: `${TAB_ID}:branch-here`,
          order: 40,
          inject: () => ({
            // Fork at this turn's own seq, then show the child in the Sidebar.
            forkAt: async (sessionId, seq) => {
              const childId = await ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })
              ctx.sidebarRight.openResource(sideBranchAddress(childId, sessionId, seq))
              return childId
            },
          }),
        }, BranchTurnAction)), 'dsh-side-branch: per-turn action')
      },
    }
  },
})
