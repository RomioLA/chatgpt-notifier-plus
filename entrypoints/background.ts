type DonePayload = {
  title?: string;
  message?: string;
};

type NotificationStatus = {
  state: 'success' | 'denied' | 'error';
  message: string;
  updatedAt: number;
};

export default defineBackground(() => {
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';
  const NOTIFICATION_STATUS_KEY = 'chatgpt_notifier_notification_status';

  function writeStatus(state: NotificationStatus['state'], message: string) {
    chrome.storage.local.set({
      [NOTIFICATION_STATUS_KEY]: {
        state,
        message,
        updatedAt: Date.now(),
      } satisfies NotificationStatus,
    });
  }

  function createSystemNotification(payload: DonePayload = {}) {
    const title = payload.title || 'ChatGPT Notifier';
    const message = payload.message || 'ChatGPT has finished responding.';

    // Keep notification creation aligned with the original extension.
    chrome.notifications.create(
      {
        type: 'basic',
        iconUrl: 'logo.png',
        title,
        message,
        priority: 1,
      },
      () => {
        const error = chrome.runtime.lastError?.message;
        if (error) {
          writeStatus('error', `通知创建失败：${error}`);
          return;
        }

        writeStatus('success', '已按原版方式请求 Windows 通知。');
      },
    );
  }

  function clearUnreadMarker(tabId: number) {
    chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_CLEAR_UNREAD' }, () => {
      void chrome.runtime.lastError;
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;

    if (message.type === 'CHATGPT_TEST_NOTIFICATION') {
      createSystemNotification({
        title: 'ChatGPT Notifier Plus 测试',
        message: '这是使用原版通知逻辑创建的测试通知。',
      });
      return;
    }

    if (message.type !== 'CHATGPT_REPLY_DONE') {
      return;
    }

    chrome.storage.local.get([SYSTEM_NOTIFICATION_KEY], (result) => {
      if (result[SYSTEM_NOTIFICATION_KEY] === true) {
        // Only the notification content differs from the original extension.
        createSystemNotification(message.payload);
      }
    });
  });

  // Keep the unread marker until the user actually switches to that tab.
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    clearUnreadMarker(tabId);
  });
});
