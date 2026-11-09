// @ts-check
// lib/composition/chat-runtime.mjs —— 聊天/推送/主动消息/作品机会运行时（W2）
import path from 'node:path'
import { createChatBridge } from '../domain/chat/chat-bridge.mjs'
import { createGuiPush } from '../domain/chat/gui-push.mjs'
import { createOutbox } from '../domain/chat/outbox.mjs'
import { startProactiveChat } from '../domain/chat/proactive-chat.mjs'
import { createAttentionStore } from '../domain/relationship/attention.mjs'
import { startWorkLoop } from '../domain/works/work-loop.mjs'

export function createChatRuntime(deps) {
  const chatBridge = createChatBridge({
    getLlm: deps.getLlm,
    policy: deps.modelPolicy,
    journal: deps.journal,
    selfState: deps.selfState,
    recall: deps.memoryRecall,
    voice: () => deps.voiceService.get(),
    events: deps.selfEvents,
    worldFeedback: deps.worldFeedback,
    modelErrorsPath: deps.modelErrorsPath,
    logger: deps.logger,
    stateDir: deps.settingsDir,
    channelLabel: '对话',
    takePending: (peerId) => (peerId === 'gui' ? deps.guiInbox.drain(5).map((item) => item.text) : []),
    onStateChanged: async () => {
      try {
        deps.moodAiService.clearCache()
        await deps.moodAiService.generate(
          {
            selfState: deps.selfState.snapshot(),
            recentMoodLabels:
              typeof deps.moodAiService.peekRecentLabels === 'function' ? deps.moodAiService.peekRecentLabels() : [],
            readings: deps.readingHint(),
          },
          { force: true },
        )
      } catch {
        /* 心情刷新失败不影响聊天 */
      }
    },
  })

  const attention = createAttentionStore({ file: path.join(deps.settingsDir, 'attention.json'), logger: deps.logger })
  if (typeof deps.selfProjects.bindAttention === 'function') deps.selfProjects.bindAttention(attention)

  const guiPush = createGuiPush({
    schedule: {
      list: (request, signal) => {
        const service = deps.getHostService('schedule')
        if (!service || typeof service.list !== 'function') throw new Error('schedule 不可用')
        return service.list(request, signal)
      },
      create: (sessionId, request, signal) => {
        const service = deps.getHostService('schedule')
        if (!service || typeof service.create !== 'function') throw new Error('schedule 不可用')
        return service.create(sessionId, request, signal)
      },
    },
    logger: deps.logger,
    env: deps.env,
    workspaceFile: path.join(deps.home, '.dsh', 'storages', 'workspace.json'),
    sessionsRoot: path.join(deps.home, '.dsh', 'sessions'),
    workspacePath: String(deps.env.DSH_POETRY_PUSH_WORKSPACE || path.join(deps.home, 'Documents', 'little-whale-chat')),
    getPendingCount: () => {
      try {
        return deps.guiInbox.peek().length
      } catch {
        return 0
      }
    },
    stateFile: path.join(deps.settingsDir, 'gui-push-state.json'),
    sendPrompt: async (sessionId, text) => {
      const controller = deps.getHostService('sessionController')
      if (!controller || typeof controller.prompt !== 'function') throw new Error('sessionController 不可用')
      const abort = new AbortController()
      await controller.prompt(
        {
          requestId: `whale-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
          clientTimeZone: 'Asia/Shanghai',
        },
        abort.signal,
      )
    },
  })
  guiPush.start()

  let lastWhaleShareAt = 0
  const queueGuiMessage = (text, meta = {}) => {
    try {
      deps.guiInbox.push({
        text,
        kind: typeof meta.kind === 'string' && meta.kind.length > 0 ? meta.kind : 'proactive',
        reason: typeof meta.reason === 'string' ? meta.reason : '',
      })
      guiPush.ping().catch(() => {})
      return { ok: true, status: 'queued' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const outbox = createOutbox({
    file: path.join(deps.settingsDir, 'outbox.json'),
    logger: deps.logger,
    senders: { gui: async (item) => queueGuiMessage(item.text, item.meta) },
    onSent: async (item) => {
      if (item.meta && typeof item.meta.attentionId === 'string') attention.markSent(item.meta.attentionId)
      if (typeof chatBridge.recordProactive === 'function') chatBridge.recordProactive('gui', item.text)
    },
  })
  const outboxTimer = setInterval(() => {
    outbox.flush().catch(() => {})
  }, 15000)
  outboxTimer.unref?.()

  const proactiveChat = startProactiveChat({
    chat: chatBridge,
    attention,
    stateFile: path.join(deps.settingsDir, 'proactive-chat-state.json'),
    logger: deps.logger,
    env: deps.env,
    peerId: 'gui',
    sendMessage: (text, meta = {}) => outbox.deliverNow({ source: 'gui', text, kind: 'proactive', meta }),
  })

  const workLoop = startWorkLoop({
    works: deps.selfWorks,
    selfState: deps.selfState,
    metabolism: deps.selfMetabolism,
    worldFeedback: deps.worldFeedback,
    logger: deps.logger,
    env: deps.env,
  })

  return {
    chatBridge,
    attention,
    guiPush,
    outbox,
    proactiveChat,
    workLoop,
    queueGuiMessage,
    shareGate: {
      get: () => lastWhaleShareAt,
      set: (value) => {
        lastWhaleShareAt = value
      },
    },
    dispose() {
      try {
        guiPush.stop()
      } catch {
        /* ignore */
      }
      try {
        proactiveChat.stop()
      } catch {
        /* ignore */
      }
      try {
        workLoop.stop()
      } catch {
        /* ignore */
      }
      clearInterval(outboxTimer)
    },
  }
}
