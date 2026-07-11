type DonePayload = {
  title?: string;
  message?: string;
};

type NotificationStatus = {
  state: 'success' | 'denied' | 'error';
  message: string;
  updatedAt: number;
};

type NotificationTarget = {
  tabId: number;
  createdAt: number;
};

export default defineBackground(() => {
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';
  const NOTIFICATION_STATUS_KEY = 'chatgpt_notifier_notification_status';
  const NOTIFICATION_TARGET_PREFIX = 'chatgpt_notifier_target_';

  function writeStatus(state: NotificationStatus['state'], message: string) {
    chrome.storage.local.set({
      [NOTIFICATION_STATUS_KEY]: {
        state,
        message,
        updatedAt: Date.now(),
      } satisfies NotificationStatus,
    });
  }

  function targetStorageKey(notificationId: string) {
    return `${NOTIFICATION_TARGET_PREFIX}${notificationId}`;
  }

  function createSystemNotification(payload: DonePayload = {}, tabId?: number) {
    const title = payload.title || 'ChatGPT 已完成';
    const message = payload.message || '回复已生成。';

    // Keep this call intentionally identical to the original extension:
    // let Chromium generate the notification ID and use normal toast timing.
    chrome.notifications.create(
      {
        type: 'basic',
        iconUrl: 'logo.png',
        title,
        message,
        priority: 1,
      },
      (notificationId) => {
        const error = chrome.runtime.lastError?.message;
        if (error) {
          writeStatus('error', `通知创建失败：${error}`);
          return;
        }

        if (typeof tabId === 'number' && notificationId) {
          chrome.storage.local.set({
            [targetStorageKey(notificationId)]: {
              tabId,
              createdAt: Date.now(),
            } satisfies NotificationTarget,
          });
        }

        writeStatus('success', 'Edge 已创建通知；是否显示横幅由 Windows 通知设置决定。');
      },
    );
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
        message: '如果你看到这条消息，Windows 通知横幅工作正常。',
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

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    clearUnreadMarker(tabId);
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    const storageKey = targetStorageKey(notificationId);

    chrome.storage.local.get([storageKey], (result) => {
      const target = result[storageKey] as NotificationTarget | undefined;
      const tabId = target?.tabId;

      if (!Number.isInteger(tabId)) {
        chrome.notifications.clear(notificationId);
        chrome.storage.local.remove(storageKey);
        return;
      }

      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          chrome.notifications.clear(notificationId);
          chrome.storage.local.remove(storageKey);
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
        chrome.storage.local.remove(storageKey);
      });
    });
  });

  chrome.notifications.onClosed.addListener((notificationId) => {
    chrome.storage.local.remove(targetStorageKey(notificationId));
  });
});
