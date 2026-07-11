import { SOUNDS, playTone } from '@/lib/sounds';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],

  main() {
    const AUDIO_URL = chrome.runtime.getURL('notification.mp3');
    const audio = new Audio(AUDIO_URL);
    const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
    const SOUND_STORAGE_KEY = 'chatgpt_notifier_sound_id';
    const UNREAD_PREFIX = '● ';
    const UNREAD_ICON_ID = 'chatgpt-notifier-unread-icon';
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

    function ensureUnreadIcon() {
      let icon = document.getElementById(UNREAD_ICON_ID) as HTMLLinkElement | null;
      if (!icon) {
        icon = document.createElement('link');
        icon.id = UNREAD_ICON_ID;
        icon.rel = 'icon';
        icon.type = 'image/svg+xml';
        icon.href =
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#d93025"/><circle cx="32" cy="32" r="12" fill="#ffffff"/></svg>',
          );
        document.head.appendChild(icon);
      }
    }

    function applyUnreadMarker() {
      if (!unread) return;

      const cleanTitle = stripUnreadPrefix(document.title) || 'ChatGPT';
      const desiredTitle = `${UNREAD_PREFIX}${cleanTitle}`;
      if (document.title !== desiredTitle) {
        document.title = desiredTitle;
      }

      ensureUnreadIcon();
    }

    function markUnread() {
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

      document.getElementById(UNREAD_ICON_ID)?.remove();
    }

    window.addEventListener('pointerdown', clearUnread, { capture: true });
    window.addEventListener('keydown', clearUnread, { capture: true });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'CHATGPT_CLEAR_UNREAD') {
        clearUnread();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'CHATGPT_TEST_MARKER') {
        markUnread();
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

    function sendCompletionMessage(conversationTitle: string, taskSummary: string) {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'CHATGPT_REPLY_DONE',
            payload: {
              title: `ChatGPT 已完成：${conversationTitle}`,
              message: `任务：${taskSummary}`,
            },
          },
          () => {
            void chrome.runtime.lastError;
          },
        );
      } catch {
        // The extension was reloaded while this page was still open.
      }
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

            playNotification();
            markUnread();
            isStreaming = false;
            sendCompletionMessage(conversationTitle, taskSummary);
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
