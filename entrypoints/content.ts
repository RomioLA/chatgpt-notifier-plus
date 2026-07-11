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
    let baseTitle = stripUnreadPrefix(document.title) || 'ChatGPT';

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

    function syncUnreadTitle() {
      const cleanTitle = stripUnreadPrefix(document.title);
      if (cleanTitle) baseTitle = cleanTitle;

      if (!unread) return;

      const desiredTitle = `${UNREAD_PREFIX}${baseTitle}`;
      if (document.title !== desiredTitle) {
        document.title = desiredTitle;
      }
    }

    function markUnread() {
      unread = true;
      baseTitle = stripUnreadPrefix(document.title) || baseTitle;
      syncUnreadTitle();
    }

    function clearUnread() {
      if (!unread) return;

      unread = false;
      baseTitle = stripUnreadPrefix(document.title) || baseTitle;
      if (document.title !== baseTitle) {
        document.title = baseTitle;
      }
    }

    // Keep the unread dot even if ChatGPT updates the page title after a reply.
    const titleObserver = new MutationObserver(syncUnreadTitle);
    titleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // A completed reply stays marked until the user actually returns/interacts.
    window.addEventListener('focus', clearUnread);
    window.addEventListener('pointerdown', clearUnread, { capture: true });
    window.addEventListener('keydown', clearUnread, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) clearUnread();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'CHATGPT_CLEAR_UNREAD') {
        clearUnread();
      }
    });

    // Initialize volume and sound from storage.
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

    // Listen for changes from the popup.
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

    /**
     * All known "streaming" DOM selectors.
     * If OpenAI changes the UI again, add new selectors here.
     */
    const STREAM_SELECTORS = [
      '.result-streaming',
      'button[data-testid$="stop-button"]',
      '[data-testid="assistant-response-spinner"]',
    ].join(',');

    let isStreaming = false;
    let doneTimerId: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 300;

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

            chrome.runtime.sendMessage({
              type: 'CHATGPT_REPLY_DONE',
              payload: {
                title: `ChatGPT 已完成：${conversationTitle}`,
                message: `任务：${taskSummary}`,
              },
            });
            isStreaming = false;
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
