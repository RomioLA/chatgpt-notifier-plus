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

  function createSystemNotification(payload: DonePayload = {}, tabId?: number) {
    const title = payload.title || 'ChatGPT 已完成';
    const message = payload.message || '回复已生成。';
    const target = typeof tabId === 'number' ? String(tabId) : 'none';
    const notificationId = `${NOTIFICATION_PREFIX}:${target}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;

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

      // Use the same normal notification mode as the original extension.
      // Edge/Windows controls how long the toast remains visible.
      chrome.notifications.create(
        notificationId,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('logo.png'),
          title,
          message,
          priority: 1,
        },
        () => {
          const error = chrome.runtime.lastError?.message;
          if (error) {
            writeStatus('error', `通知发送失败：${error}`);
            return;
          }

          writeStatus('success', 'Windows 通知请求已提交（系统默认停留时间）。');
        },
      );
    });
  }

  function clearUnreadMarker(tabId: number) {
    chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_CLEAR_UNREAD' }, () => {
      void chrome.runtime.lastError;
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message) return;

    if (message.type === 'CHATGPT_TEST_NOTIFICATION') {
      createSystemNotification({
        title: 'ChatGPT Notifier Plus 测试',
        message: 'Windows 通知功能正常。',
      });
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

  // Clear the marker when the user actually switches to that tab.
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    clearUnreadMarker(tabId);
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
        clearUnreadMarker(tabId);
      });

      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
      });

      chrome.notifications.clear(notificationId);
    });
  });
});