/**
 * Browser half of dsh-open-branch.
 *
 * One side conversation per session. Opening it the first time forks the
 * current session once at its latest completed turn; every later open reuses
 * that same side session, so clicking the entry again never piles up forks.
 *
 * The side session is an ordinary DSH Session, so the panel is fully writable:
 * you can keep asking there and the main conversation keeps running untouched.
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
    /** One address per host session: this is what makes the panel a singleton. */
    const ADDRESS_PREFIX = `dsh-resource://${PROTOCOL}/for/`
    /** Child slot declared by this tab body; distinct from ui-subagent's. */
    const CONVERSATION_SLOT = 'sidebranch.conversation'
    /** Remembers which side session belongs to which host session. */
    const STORE_KEY = 'dsh-open-branch/side-sessions/v1'

    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language)
    const LABELS = ZH
      ? {
        open: '侧边对话',
        openTip: '在主对话旁边开一个可写的侧边对话；主任务不受影响',
        creating: '正在创建侧边对话…',
        failed: '侧边对话打开失败',
        panel: '侧边对话',
      }
      : {
        open: 'Side conversation',
        openTip: 'Open a writable side conversation beside the main task; the main task keeps running',
        creating: 'Preparing the side conversation…',
        failed: 'Could not open the side conversation',
        panel: 'Side conversation',
      }

    /**
     * Build the canonical address of the one side conversation of a session.
     * @param hostSessionId - the session whose sidebar hosts the panel.
     * @returns a `dsh-resource://` address this plugin's type claims.
     */
    function sideConversationAddress(hostSessionId) {
      return `${ADDRESS_PREFIX}${encodeURIComponent(hostSessionId)}`
    }

    /**
     * Parse one side-conversation address.
     * @param value - candidate resource address.
     * @returns the host session id, or undefined for another or malformed address.
     */
    function parseSideConversationAddress(value) {
      let url
      try {
        url = new URL(value)
      } catch (_invalidUrl) {
        return undefined
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== PROTOCOL) return undefined
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'for') return undefined
      try {
        return decodeURIComponent(parts[1])
      } catch (_invalidEncoding) {
        return undefined
      }
    }

    /** Read the durable host-to-side mapping; an unavailable store degrades to empty. */
    function readMapping() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '{}')
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch (_unavailableStorage) {
        return {}
      }
    }

    /** Persist one host-to-side binding; failure only costs reuse across reloads. */
    function rememberMapping(hostSessionId, sideSessionId) {
      try {
        const mapping = readMapping()
        mapping[hostSessionId] = sideSessionId
        window.localStorage.setItem(STORE_KEY, JSON.stringify(mapping))
      } catch (_unavailableStorage) {
        /* the page-lifetime map still reuses the session */
      }
    }

    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve()
      return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }

    /**
     * The one-side-session-per-host-session store.
     *
     * Creation is serialized so two rapid opens cannot fork twice, and the
     * binding is remembered for the page's lifetime plus across reloads, which
     * is what makes the panel a singleton instead of a fork per click.
     *
     * @param ctx - the plugin's client context.
     * @returns the `ensure` operation and the resource provider built on it.
     */
    function sideConversationStore(ctx) {
      const live = new Map()
      let queue = Promise.resolve()
      const isKnown = id => id !== undefined && ctx.sessions.list.getSnapshot().byId[id] !== undefined

      const ensure = (hostSessionId) => {
        const remembered = live.get(hostSessionId) ?? readMapping()[hostSessionId]
        if (isKnown(remembered)) {
          live.set(hostSessionId, remembered)
          return Promise.resolve(remembered)
        }
        const run = queue.then(async () => {
          const again = live.get(hostSessionId) ?? readMapping()[hostSessionId]
          if (isKnown(again)) {
            live.set(hostSessionId, again)
            return again
          }
          // Fork once, at the host session's latest completed turn.
          const created = await ctx.sessions.fork({ sessionId: hostSessionId, increaseTitle: true })
          live.set(hostSessionId, created)
          rememberMapping(hostSessionId, created)
          return created
        })
        queue = run.then(() => undefined, () => undefined)
        return run
      }

      const provider = {
        protocol: PROTOCOL,
        async *open(resourceAddress, { signal }) {
          const hostSessionId = parseSideConversationAddress(resourceAddress)
          if (hostSessionId === undefined) throw new Error(`dsh-open-branch: invalid address "${resourceAddress}"`)
          if (signal.aborted) return
          const sideSessionId = await ensure(hostSessionId)
          if (signal.aborted) return
          const reference = ctx.sessions.retain(sideSessionId, { source: 'sideBranch', signal })
          try {
            yield { ok: true, value: { hostSessionId, reference } }
            await waitForAbort(signal)
          } finally {
            reference.release()
          }
        },
      }

      return { ensure, provider }
    }

    /** Force the embedded Conversation onto its Chat view. */
    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    /** The Conversation body of the side session. */
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

    /** Tab body: bind the retained side Session around its Conversation. */
    function SideConversationTab(props) {
      const { useResource, useTabInfo, SessionProvider, renderSlot } = props
      const { tab } = useTabInfo()
      const resource = useResource(tab.contentId)
      return h('div', {
        'data-dsh-open-branch': '',
        // Must bound this box, or the embedded Conversation has no measurable
        // height and its scroll container never becomes scrollable.
        style: { display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0 },
      },
      resource.value === undefined
        ? h('div', {
          style: { padding: '12px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
        }, LABELS.creating)
        : h(SessionProvider, { session: resource.value.reference },
          renderSlot(CONVERSATION_SLOT, {})))
    }

    /** Composer-toolbar entry: open the one side conversation of this session. */
    function SideConversationButton(props) {
      const { sessionId, openSide, useSession } = props
      const [state, setState] = React.useState('idle')
      const blank = useSession(value => value.blank)
      // A blank session has no completed turn to fork from, so there is nothing
      // to open yet: contributing nothing is better than an entry that fails.
      if (sessionId === undefined || sessionId === null || sessionId === '' || blank === true) return null
      return h('button', {
        type: 'button',
        title: state === 'failed' ? LABELS.failed : LABELS.openTip,
        'aria-label': LABELS.open,
        'data-dsh-open-branch-action': state,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          padding: 0,
          border: 'none',
          borderRadius: '6px',
          background: 'transparent',
          cursor: 'pointer',
          color: state === 'failed'
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-label-secondary)',
        },
        onClick: () => {
          if (state === 'pending') return
          setState('pending')
          openSide(sessionId)
            .then(() => { setState('idle') })
            .catch(() => { setState('failed') })
        },
      }, h('svg', {
        viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, style: { display: 'block' },
      },
      h('rect', {
        x: 1.4, y: 2.6, width: 7.2, height: 10.8, rx: 1.4,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
      }),
      h('path', {
        d: 'M10.6 8h3.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
      }),
      h('circle', { cx: 14.2, cy: 8, r: 0.9, fill: 'currentColor' })))
    }

    return {
      inject: ['slots', 'sessions', 'resources', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        const sideSessions = sideConversationStore(ctx)

        ctx.effect(
          () => ctx.resources.register(sideSessions.provider),
          'dsh-open-branch: resources',
        )

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          patterns: [`${ADDRESS_PREFIX}**`],
          canOpen: address => parseSideConversationAddress(address) !== undefined,
          title: () => LABELS.panel,
        }), 'dsh-open-branch: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
        }, SideConversationTab)), 'dsh-open-branch: tab body')

        ctx.effect(() => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
          name: CONVERSATION_SLOT,
        }, ConversationPanel)), 'dsh-open-branch: conversation')

        ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: `${TAB_ID}:open`,
          order: 30,
          inject: () => ({
            // One address per host session, so repeats reveal the same tab.
            // Create first, so a failure surfaces on the button instead of
            // leaving an empty panel behind.
            openSide: async (hostSessionId) => {
              await sideSessions.ensure(hostSessionId)
              ctx.sidebarRight.openResource(sideConversationAddress(hostSessionId))
            },
          }),
        }, SideConversationButton)), 'dsh-open-branch: composer entry')
      },
    }
  },
})
