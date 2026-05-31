export default defineContentScript({
  matches: ['https://chatgpt.com/*'],

  main() {
    const AUDIO_URL = chrome.runtime.getURL('notification.mp3');
    const audio = new Audio(AUDIO_URL);
    const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';

    // Initialize volume from storage
    chrome.storage.local.get([VOLUME_STORAGE_KEY], (result) => {
      const vol = result[VOLUME_STORAGE_KEY];
      if (typeof vol === 'number') {
        audio.volume = vol;
      } else {
        audio.volume = 0.5;
      }
    });

    // Listen for volume changes from popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes[VOLUME_STORAGE_KEY]) {
        const newVol = changes[VOLUME_STORAGE_KEY].newValue;
        if (typeof newVol === 'number') {
          audio.volume = newVol;
        }
      }
    });

    /**
     * All known "streaming" DOM selectors.
     * If OpenAI changes the UI again, just add new selectors here.
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
        clearTimeout(doneTimerId!);
        doneTimerId = null;
      } else if (isStreaming && !doneTimerId) {
        doneTimerId = setTimeout(() => {
          if (document.querySelector(STREAM_SELECTORS) === null) {
            audio.play().catch(() => {
              /* ignore autoplay restrictions */
            });
            chrome.runtime.sendMessage({
              type: 'CHATGPT_REPLY_DONE',
              payload: {
                title: 'ChatGPT Notifier',
                message: 'ChatGPT has finished responding.',
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
