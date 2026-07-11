type DonePayload = {
  title?: string;
  message?: string;
};

export default defineBackground(() => {
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';
  const NOTIFICATION_PREFIX = 'chatgpt-reply';

  function createSystemNotification(payload: DonePayload = {}, tabId?: number) {
    const title = payload.title || 'ChatGPT 已完成';
    const message = payload.message || '回复已生成。';
    const target = typeof tabId === 'number' ? String(tabId) : 'none';
    const notificationId = `${NOTIFICATION_PREFIX}:${target}:${Date.now()}`;

    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'logo.png',
      title,
      message,
      priority: 1,
      requireInteraction: true,
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== 'CHATGPT_REPLY_DONE') {
      return;
    }

    chrome.storage.local.get([SYSTEM_NOTIFICATION_KEY], (result) => {
      if (result[SYSTEM_NOTIFICATION_KEY] === true) {
        createSystemNotification(message.payload, sender.tab?.id);
      }
    });
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(`${NOTIFICATION_PREFIX}:`)) {
      return;
    }

    const [, rawTabId] = notificationId.split(':');
    const tabId = Number(rawTabId);

    if (!Number.isInteger(tabId)) {
      chrome.notifications.clear(notificationId);
      return;
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        chrome.notifications.clear(notificationId);
        return;
      }

      chrome.tabs.update(tabId, { active: true }, () => {
        void chrome.runtime.lastError;
      });

      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
      });

      chrome.notifications.clear(notificationId);
    });
  });
});
