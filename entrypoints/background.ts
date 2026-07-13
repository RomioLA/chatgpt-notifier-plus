type DonePayload = {
  title?: string;
  message?: string;
  conversationTitle?: string;
  taskSummary?: string;
  url?: string;
};

type StatusRecord = {
  state: 'success' | 'denied' | 'error';
  message: string;
  updatedAt: number;
};

type PendingFeishuNotification = {
  tabId: number;
  windowId: number;
  conversationTitle: string;
  taskSummary: string;
  url: string;
  createdAt: number;
};

export default defineBackground(() => {
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';
  const NOTIFICATION_STATUS_KEY = 'chatgpt_notifier_notification_status';
  const FEISHU_ENABLED_KEY = 'chatgpt_notifier_feishu_enabled';
  const FEISHU_WEBHOOK_KEY = 'chatgpt_notifier_feishu_webhook';
  const FEISHU_STATUS_KEY = 'chatgpt_notifier_feishu_status';
  const FEISHU_PENDING_PREFIX = 'chatgpt_notifier_feishu_pending_';
  const FEISHU_ALARM_PREFIX = 'chatgpt_notifier_feishu_alarm_';
  const FEISHU_DELAY_MS = 60_000;

  function writeStatus(storageKey: string, state: StatusRecord['state'], message: string) {
    chrome.storage.local.set({
      [storageKey]: {
        state,
        message,
        updatedAt: Date.now(),
      } satisfies StatusRecord,
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
          writeStatus(NOTIFICATION_STATUS_KEY, 'error', `通知创建失败：${error}`);
          return;
        }

        writeStatus(NOTIFICATION_STATUS_KEY, 'success', '已按原版方式请求 Windows 通知。');
      },
    );
  }

  function isValidFeishuWebhook(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim()) return false;

    try {
      const url = new URL(value.trim());
      const supportedHost = url.hostname === 'open.feishu.cn' || url.hostname === 'open.larksuite.com';
      return url.protocol === 'https:' && supportedHost && url.pathname.startsWith('/open-apis/bot/v2/hook/');
    } catch {
      return false;
    }
  }

  async function sendFeishuWebhook(
    webhook: string,
    payload: Pick<PendingFeishuNotification, 'conversationTitle' | 'taskSummary' | 'url'>,
    isTest = false,
  ) {
    const text = isTest
      ? 'ChatGPT 测试通知：飞书 Webhook 已连接。'
      : [
          'ChatGPT 任务已完成',
          '',
          `对话：${payload.conversationTitle}`,
          `任务：${payload.taskSummary}`,
          `打开对话：${payload.url}`,
        ].join('\n');

    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text },
      }),
    });

    const raw = await response.text();
    let result: Record<string, unknown> = {};

    if (raw) {
      try {
        result = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
    }

    if (!response.ok) {
      throw new Error(String(result.msg || result.StatusMessage || `HTTP ${response.status}`));
    }

    const code = typeof result.code === 'number' ? result.code : result.StatusCode;
    if (typeof code === 'number' && code !== 0) {
      throw new Error(String(result.msg || result.StatusMessage || `飞书返回错误 ${code}`));
    }
  }

  function pendingStorageKey(tabId: number) {
    return `${FEISHU_PENDING_PREFIX}${tabId}`;
  }

  function alarmName(tabId: number) {
    return `${FEISHU_ALARM_PREFIX}${tabId}`;
  }

  function cancelPendingFeishu(tabId: number) {
    chrome.alarms.clear(alarmName(tabId));
    chrome.storage.local.remove(pendingStorageKey(tabId));
  }

  function clearUnreadMarker(tabId: number) {
    chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_CLEAR_UNREAD' }, () => {
      void chrome.runtime.lastError;
    });
  }

  function isTabActuallyViewed(tabId: number, windowId: number, callback: (viewed: boolean) => void) {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || tab.active !== true) {
        callback(false);
        return;
      }

      chrome.windows.get(windowId, (window) => {
        if (chrome.runtime.lastError || !window) {
          callback(false);
          return;
        }

        callback(window.focused === true);
      });
    });
  }

  function scheduleFeishuNotification(payload: DonePayload, tab?: chrome.tabs.Tab) {
    const tabId = tab?.id;
    const windowId = tab?.windowId;

    if (typeof tabId !== 'number' || typeof windowId !== 'number') {
      writeStatus(FEISHU_STATUS_KEY, 'error', '无法确定任务对应的标签页，未安排飞书通知。');
      return;
    }

    chrome.storage.local.get([FEISHU_ENABLED_KEY, FEISHU_WEBHOOK_KEY], (result) => {
      if (result[FEISHU_ENABLED_KEY] !== true) return;

      const webhook = result[FEISHU_WEBHOOK_KEY];
      if (!isValidFeishuWebhook(webhook)) {
        writeStatus(FEISHU_STATUS_KEY, 'error', '飞书 Webhook 无效，请在插件设置中重新保存。');
        return;
      }

      isTabActuallyViewed(tabId, windowId, (viewed) => {
        if (viewed) {
          cancelPendingFeishu(tabId);
          return;
        }

        const pending: PendingFeishuNotification = {
          tabId,
          windowId,
          conversationTitle:
            payload.conversationTitle || payload.title?.replace(/^ChatGPT 已完成：/, '') || 'ChatGPT 对话',
          taskSummary: payload.taskSummary || payload.message?.replace(/^任务：/, '') || '回复已生成。',
          url: payload.url || 'https://chatgpt.com/',
          createdAt: Date.now(),
        };

        chrome.storage.local.set({ [pendingStorageKey(tabId)]: pending }, () => {
          chrome.alarms.create(alarmName(tabId), { when: Date.now() + FEISHU_DELAY_MS });
          writeStatus(FEISHU_STATUS_KEY, 'success', '飞书通知已等待 60 秒；打开对应标签页会自动取消。');
        });
      });
    });
  }

  function testFeishuNotification() {
    chrome.storage.local.get([FEISHU_WEBHOOK_KEY], (result) => {
      const webhook = result[FEISHU_WEBHOOK_KEY];
      if (!isValidFeishuWebhook(webhook)) {
        writeStatus(FEISHU_STATUS_KEY, 'error', '飞书 Webhook 无效，请先保存正确地址。');
        return;
      }

      void sendFeishuWebhook(
        webhook,
        {
          conversationTitle: 'ChatGPT Notifier Plus',
          taskSummary: '测试飞书通知',
          url: 'https://chatgpt.com/',
        },
        true,
      )
        .then(() => writeStatus(FEISHU_STATUS_KEY, 'success', '飞书测试通知发送成功。'))
        .catch((error: unknown) =>
          writeStatus(FEISHU_STATUS_KEY, 'error', `飞书发送失败：${error instanceof Error ? error.message : String(error)}`),
        );
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message) return;

    if (message.type === 'CHATGPT_TEST_NOTIFICATION') {
      createSystemNotification({
        title: 'ChatGPT Notifier Plus 测试',
        message: '这是使用原版通知逻辑创建的测试通知。',
      });
      return;
    }

    if (message.type === 'CHATGPT_TEST_FEISHU') {
      testFeishuNotification();
      return;
    }

    if (message.type !== 'CHATGPT_REPLY_DONE') return;

    chrome.storage.local.get([SYSTEM_NOTIFICATION_KEY], (result) => {
      if (result[SYSTEM_NOTIFICATION_KEY] === true) {
        createSystemNotification(message.payload);
      }
    });

    scheduleFeishuNotification(message.payload || {}, sender.tab);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(FEISHU_ALARM_PREFIX)) return;

    const tabId = Number(alarm.name.slice(FEISHU_ALARM_PREFIX.length));
    if (!Number.isInteger(tabId)) return;

    const storageKey = pendingStorageKey(tabId);
    chrome.storage.local.get([storageKey, FEISHU_ENABLED_KEY, FEISHU_WEBHOOK_KEY], (result) => {
      const pending = result[storageKey] as PendingFeishuNotification | undefined;
      if (!pending) return;

      if (result[FEISHU_ENABLED_KEY] !== true) {
        cancelPendingFeishu(tabId);
        return;
      }

      const webhook = result[FEISHU_WEBHOOK_KEY];
      if (!isValidFeishuWebhook(webhook)) {
        writeStatus(FEISHU_STATUS_KEY, 'error', '飞书 Webhook 无效，延迟通知未发送。');
        cancelPendingFeishu(tabId);
        return;
      }

      isTabActuallyViewed(pending.tabId, pending.windowId, (viewed) => {
        if (viewed) {
          cancelPendingFeishu(tabId);
          return;
        }

        void sendFeishuWebhook(webhook, pending)
          .then(() => writeStatus(FEISHU_STATUS_KEY, 'success', `已向飞书推送：${pending.conversationTitle}`))
          .catch((error: unknown) =>
            writeStatus(
              FEISHU_STATUS_KEY,
              'error',
              `飞书发送失败：${error instanceof Error ? error.message : String(error)}`,
            ),
          )
          .finally(() => cancelPendingFeishu(tabId));
      });
    });
  });

  // The task is considered handled only after its tab is selected in a focused Edge window.
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    clearUnreadMarker(tabId);

    chrome.windows.get(windowId, (window) => {
      if (!chrome.runtime.lastError && window?.focused) {
        cancelPendingFeishu(tabId);
      }
    });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;

    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (typeof tabId === 'number') {
        clearUnreadMarker(tabId);
        cancelPendingFeishu(tabId);
      }
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    cancelPendingFeishu(tabId);
  });
});