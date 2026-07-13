import { SOUNDS, playTone } from '@/lib/sounds';

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

    function applyUnreadMarker() {
      if (!unread) return;

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
      try {
        chrome.runtime.sendMessage(message, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        // The extension may have been reloaded while this page remained open.
      }
    }

    function reportViewed() {
      if (document.hidden || !document.hasFocus()) return;

      clearUnread();
      sendRuntimeMessage({ type: 'CHATGPT_TAB_VIEWED' });
    }

    document.addEventListener('visibilitychange', reportViewed);
    window.addEventListener('focus', reportViewed);

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'CHATGPT_CLEAR_UNREAD') {
        clearUnread();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'CHATGPT_TEST_MARKER') {
        markUnread(true);
        sendResponse({ ok: true });
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
      conversationTitle: string,
      taskSummary: string,
      needsFeishuPush: boolean,
    ) {
      sendRuntimeMessage({
        type: 'CHATGPT_REPLY_DONE',
        payload: {
          title: `ChatGPT 已完成：${conversationTitle}`,
          message: `任务：${taskSummary}`,
          conversationTitle,
          taskSummary,
          url: location.href,
          needsFeishuPush,
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
            const needsFeishuPush = document.hidden || !document.hasFocus();

            playNotification();
            markUnread(needsFeishuPush);
            isStreaming = false;
            sendCompletionMessage(conversationTitle, taskSummary, needsFeishuPush);
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

    checkStreaming();
  },
});