import { SOUNDS, playTone } from '@/lib/sounds';

type AckResponse = {
  ok?: boolean;
  cancelled?: boolean;
  reason?: string;
};

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],

  main() {
    const AUDIO_URL = chrome.runtime.getURL('notification.mp3');
    const audio = new Audio(AUDIO_URL);
    const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
    const SOUND_STORAGE_KEY = 'chatgpt_notifier_sound_id';
    const UNREAD_PREFIX = '● ';
    const MAX_TASK_LENGTH = 160;

    let currentSoundId = 'default';
    let currentVolume = 0.5;
    let unread = false;
    let unreadTimerId: ReturnType<typeof setInterval> | null = null;

    let latestCompletedTaskId: string | null = null;
    let latestCompletedAt = 0;
    let registeredTaskId: string | null = null;
    let viewedAfterCompletionAt = 0;
    let ackInFlightTaskId: string | null = null;

    function stripUnreadPrefix(title: string) {
      return title.replace(/^●\s*/, '').trim();
    }

    function normalizeText(text: string) {
      return text.replace(/\s+/g, ' ').trim();
    }

    function truncate(text: string, maxLength: number) {
      if (text.length <= maxLength) return text;
      return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
    }

    function getConversationTitle() {
      const title = stripUnreadPrefix(document.title);
      return title && title !== 'ChatGPT' ? truncate(title, 80) : 'ChatGPT 对话';
    }

    function getLatestUserMessage() {
      const messages = document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]');
      const latest = messages.item(messages.length - 1);
      const text = normalizeText(latest?.innerText || latest?.textContent || '');
      return text ? truncate(text, MAX_TASK_LENGTH) : '回复已生成。';
    }

    function createTaskId() {
      const randomPart =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      return `reply-${Date.now()}-${randomPart}`;
    }

    function isExtensionContextAlive() {
      try {
        return Boolean(chrome.runtime?.id);
      } catch {
        return false;
      }
    }

    function applyUnreadMarker() {
      if (!unread) return;

      // An unpacked extension reload invalidates the old content-script context.
      // Stop old scripts from leaving a permanent dot behind.
      if (!isExtensionContextAlive()) {
        clearUnread();
        return;
      }

      const cleanTitle = stripUnreadPrefix(document.title) || 'ChatGPT';
      const desiredTitle = `${UNREAD_PREFIX}${cleanTitle}`;
      if (document.title !== desiredTitle) {
        document.title = desiredTitle;
      }
    }

    function markUnread(force = false) {
      if (!force && !document.hidden) return;

      unread = true;
      applyUnreadMarker();

      if (!unreadTimerId) {
        unreadTimerId = setInterval(applyUnreadMarker, 500);
      }
    }

    function clearUnread() {
      unread = false;

      if (unreadTimerId) {
        clearInterval(unreadTimerId);
        unreadTimerId = null;
      }

      const cleanTitle = stripUnreadPrefix(document.title);
      if (document.title !== cleanTitle) {
        document.title = cleanTitle;
      }
    }

    function sendRuntimeMessage(message: Record<string, unknown>) {
      if (!isExtensionContextAlive()) return;

      try {
        chrome.runtime.sendMessage(message, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        // The extension may have been reloaded while this page remained open.
      }
    }

    function sendTaskAck(taskId: string) {
      if (!isExtensionContextAlive() || ackInFlightTaskId === taskId) return;

      ackInFlightTaskId = taskId;
      try {
        chrome.runtime.sendMessage(
          {
            type: 'CHATGPT_TASK_ACK',
            taskId,
          },
          (response: AckResponse | undefined) => {
            const error = chrome.runtime.lastError?.message;
            if (ackInFlightTaskId === taskId) ackInFlightTaskId = null;

            if (error) return;
            if (response?.ok && registeredTaskId === taskId) {
              registeredTaskId = null;
            }
          },
        );
      } catch {
        if (ackInFlightTaskId === taskId) ackInFlightTaskId = null;
      }
    }

    function confirmViewedAndAck() {
      if (document.hidden || !document.hasFocus()) return;

      if (latestCompletedTaskId) {
        viewedAfterCompletionAt = Date.now();
      }

      if (
        registeredTaskId &&
        registeredTaskId === latestCompletedTaskId &&
        viewedAfterCompletionAt >= latestCompletedAt
      ) {
        sendTaskAck(registeredTaskId);
      }
    }

    function reportViewed() {
      if (document.hidden) return;

      // Clear the visual marker immediately. Focus can settle shortly after a
      // tab switch, so retry the task acknowledgement a few times.
      clearUnread();
      confirmViewedAndAck();
      window.setTimeout(confirmViewedAndAck, 80);
      window.setTimeout(confirmViewedAndAck, 250);
    }

    document.addEventListener('visibilitychange', reportViewed);
    window.addEventListener('focus', reportViewed);
    window.addEventListener('pageshow', reportViewed);
    window.addEventListener('pointerdown', reportViewed, { capture: true });
    window.addEventListener('keydown', reportViewed, { capture: true });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'CHATGPT_CLEAR_UNREAD') {
        clearUnread();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'CHATGPT_TEST_MARKER') {
        markUnread(true);
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'CHATGPT_TASK_REGISTERED') {
        const taskId = message.taskId;
        if (typeof taskId !== 'string' || !taskId || taskId !== latestCompletedTaskId) {
          sendResponse({ ok: false, reason: 'task-not-current' });
          return;
        }

        registeredTaskId = taskId;
        sendResponse({ ok: true });

        // The user may have opened this tab during the short registration
        // window. In that case acknowledge the exact task immediately.
        if (viewedAfterCompletionAt >= latestCompletedAt) {
          sendTaskAck(taskId);
        } else {
          reportViewed();
        }
      }
    });

    chrome.storage.local.get([VOLUME_STORAGE_KEY, SOUND_STORAGE_KEY], (result) => {
      const vol = result[VOLUME_STORAGE_KEY];
      if (typeof vol === 'number') {
        currentVolume = vol;
        audio.volume = vol;
      }

      const soundId = result[SOUND_STORAGE_KEY] as string | undefined;
      if (soundId) {
        currentSoundId = soundId;
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes[VOLUME_STORAGE_KEY]) {
        const newVol = changes[VOLUME_STORAGE_KEY].newValue;
        if (typeof newVol === 'number') {
          currentVolume = newVol;
          audio.volume = newVol;
        }
      }

      if (changes[SOUND_STORAGE_KEY]) {
        const newSound = changes[SOUND_STORAGE_KEY].newValue as string | undefined;
        currentSoundId = newSound || 'default';
      }
    });

    function playNotification() {
      const sound = SOUNDS.find((s) => s.id === currentSoundId);
      if (sound && sound.freqs.length > 0) {
        playTone(sound.freqs, currentVolume, sound.type);
      } else {
        audio.play().catch(() => {
          /* ignore autoplay restrictions */
        });
      }
    }

    const STREAM_SELECTORS = [
      '.result-streaming',
      'button[data-testid$="stop-button"]',
      '[data-testid="assistant-response-spinner"]',
    ].join(',');

    let isStreaming = false;
    let doneTimerId: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 300;

    function sendCompletionMessage(
      taskId: string,
      conversationTitle: string,
      taskSummary: string,
    ) {
      sendRuntimeMessage({
        type: 'CHATGPT_REPLY_DONE',
        payload: {
          taskId,
          title: `ChatGPT 已完成：${conversationTitle}`,
          message: `任务：${taskSummary}`,
          conversationTitle,
          taskSummary,
          url: location.href,
        },
      });
    }

    function checkStreaming() {
      const stillStreaming = document.querySelector(STREAM_SELECTORS) !== null;

      if (stillStreaming) {
        isStreaming = true;
        if (doneTimerId) clearTimeout(doneTimerId);
        doneTimerId = null;
      } else if (isStreaming && !doneTimerId) {
        doneTimerId = setTimeout(() => {
          if (document.querySelector(STREAM_SELECTORS) === null) {
            const conversationTitle = getConversationTitle();
            const taskSummary = getLatestUserMessage();
            const taskId = createTaskId();
            const viewedAtCompletion = !document.hidden && document.hasFocus();

            latestCompletedTaskId = taskId;
            latestCompletedAt = Date.now();
            registeredTaskId = null;
            ackInFlightTaskId = null;
            viewedAfterCompletionAt = viewedAtCompletion ? latestCompletedAt : 0;

            playNotification();
            markUnread(!viewedAtCompletion);
            isStreaming = false;
            sendCompletionMessage(taskId, conversationTitle, taskSummary);
          }
          doneTimerId = null;
        }, DEBOUNCE_MS);
      }
    }

    const observer = new MutationObserver(() => {
      queueMicrotask(checkStreaming);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-testid', 'aria-busy'],
    });

    // Remove a stale prefix left by a previous extension reload.
    if (!document.hidden) {
      clearUnread();
    }

    checkStreaming();
  },
});