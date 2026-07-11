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
  const NOTIFICATION_PREFIX = 'chatgpt-reply';

  function writeStatus(state: NotificationStatus['state'], message: string) {
    chrome.storage.local.set({
      [NOTIFICATION_STATUS_KEY]: {
        state,
        message,
        updatedAt: Date.now(),
      } satisfies NotificationStatus,
    });
  }

  function createNotificationAttempt(
    notificationId: string,
    payload: Required<DonePayload>,
    requireInteraction: boolean,
    onComplete: (error?: string) => void,
  ) {
    chrome.notifications.create(
      notificationId,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('logo.png'),
        title: payload.title,
        message: payload.message,
        priority: 2,
        requireInteraction,
      },
      () => {
        const error = chrome.runtime.lastError?.message;
        onComplete(error);
      },
    );
  }

  function createSystemNotification(payload: DonePayload = {}, tabId?: number) {
    const resolvedPayload: Required<DonePayload> = {
      title: payload.title || 'ChatGPT 已完成',
      message: payload.message || '回复已生成。',
    };
    const target = typeof tabId === 'number' ? String(tabId) : 'none';
    const notificationId = `${NOTIFICATION_PREFIX}:${target}:${Date.now()}`;

    chrome.notifications.getPermissionLevel((permission) => {
      const permissionError = chrome.runtime.lastError?.message;
      if (permissionError) {
        writeStatus('error', `无法读取通知权限：${permissionError}`);
        return;
      }

      if (permission !== 'granted') {
        writeStatus('denied', '浏览器或系统已禁止此扩展显示通知。');
        return;
      }

      // Prefer a sticky notification. Some Chromium variants reject this option,
      // so retry once with a normal system notification if needed.
      createNotificationAttempt(notificationId, resolvedPayload, true, (stickyError) => {
        if (!stickyError) {
          writeStatus('success', 'Windows 通知已发送（持续显示模式）。');
          return;
        }

        createNotificationAttempt(notificationId, resolvedPayload, false, (fallbackError) => {
          if (!fallbackError) {
            writeStatus('success', 'Windows 通知已发送（系统默认停留时间）。');
            return;
          }

          writeStatus('error', `通知发送失败：${fallbackError || stickyError}`);
        });
      });
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message) return;

    if (message.type === 'CHATGPT_TEST_NOTIFICATION') {
      createSystemNotification(
        {
          title: 'ChatGPT Notifier Plus 测试',
          message: 'Windows 通知功能正常。',
        },
        sender.tab?.id,
      );
      return;
    }

    if (message.type !== 'CHATGPT_REPLY_DONE') {
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
        chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_CLEAR_UNREAD' }, () => {
          void chrome.runtime.lastError;
        });
      });

      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
      });

      chrome.notifications.clear(notificationId);
    });
  });
});
