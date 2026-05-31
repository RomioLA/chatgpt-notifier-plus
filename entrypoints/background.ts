export default defineBackground(() => {
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';

  function createSystemNotification(payload: { title?: string; message?: string } = {}) {
    const title = payload.title || 'ChatGPT Notifier';
    const message = payload.message || 'ChatGPT has finished responding.';

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'logo.png',
      title,
      message,
      priority: 1,
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'CHATGPT_REPLY_DONE') {
      return;
    }

    chrome.storage.local.get([SYSTEM_NOTIFICATION_KEY], (result) => {
      if (result[SYSTEM_NOTIFICATION_KEY] === true) {
        createSystemNotification(message.payload);
      }
    });
  });
});
