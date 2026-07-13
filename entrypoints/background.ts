type DonePayload = {
  title?: string;
  message?: string;
  conversationTitle?: string;
  taskSummary?: string;
  url?: string;
  needsFeishuPush?: boolean;
};

type StatusRecord = {
  state: 'success' | 'denied' | 'error';
  message: string;
  updatedAt: number;
};

type PendingFeishuNotification = {
  tabId: number;
  conversationTitle: string;
  taskSummary: string;
  url: string;
  createdAt: number;
  dueAt: number;
  isTest?: boolean;
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
  const FEISHU_TEST_DELAY_MS = 30_000;
  const TEST_TAB_ID = -1;

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
    customText?: string,
  ) {
    const text =
      customText ||
      [
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

  function cancelPendingFeishu(tabId: number, statusMessage?: string) {
    chrome.alarms.clear(alarmName(tabId));
    chrome.storage.local.remove(pendingStorageKey(tabId));

    if (statusMessage) {
      writeStatus(FEISHU_STATUS_KEY, 'success', statusMessage);
    }
  }

  function clearUnreadMarker(tabId: number) {
    chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_CLEAR_UNREAD' }, () => {
      void chrome.runtime.lastError;
    });
  }

  function storeAndSchedulePending(pending: PendingFeishuNotification, delayLabel: string) {
    const storageKey = pendingStorageKey(pending.tabId);
    const alarm = alarmName(pending.tabId);

    chrome.alarms.clear(alarm, () => {
      void chrome.runtime.lastError;

      chrome.storage.local.set({ [storageKey]: pending }, () => {
        const storageError = chrome.runtime.lastError?.message;
        if (storageError) {
          writeStatus(FEISHU_STATUS_KEY, 'error', `保存待推送任务失败：${storageError}`);
          return;
        }

        chrome.alarms.create(alarm, { when: pending.dueAt });
        chrome.alarms.get(alarm, (createdAlarm) => {
          const alarmError = chrome.runtime.lastError?.message;
          if (alarmError || !createdAlarm) {
            writeStatus(FEISHU_STATUS_KEY, 'error', `创建延迟闹钟失败：${alarmError || '未返回闹钟记录'}`);
            chrome.storage.local.remove(storageKey);
            return;
          }

          writeStatus(FEISHU_STATUS_KEY, 'success', `${delayLabel}已建立；返回对应标签页会取消推送。`);
        });
      });
    });
  }

  function scheduleFeishuNotification(payload: DonePayload, tab?: chrome.tabs.Tab) {
    if (payload.needsFeishuPush !== true) {
      writeStatus(FEISHU_STATUS_KEY, 'success', '任务完成时页面已在查看，不安排飞书推送。');
      return;
    }

    const tabId = tab?.id;
    if (typeof tabId !== 'number') {
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

      const dueAt = Date.now() + FEISHU_DELAY_MS;
      const pending: PendingFeishuNotification = {
        tabId,
        conversationTitle:
          payload.conversationTitle || payload.title?.replace(/^ChatGPT 已完成：/, '') || 'ChatGPT 对话',
        taskSummary: payload.taskSummary || payload.message?.replace(/^任务：/, '') || '回复已生成。',
        url: payload.url || tab?.url || 'https://chatgpt.com/',
        createdAt: Date.now(),
        dueAt,
      };

      storeAndSchedulePending(pending, '飞书通知 60 秒倒计时');
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
        'ChatGPT 测试通知：飞书 Webhook 已连接。',
      )
        .then(() => writeStatus(FEISHU_STATUS_KEY, 'success', '飞书即时测试通知发送成功。'))
        .catch((error: unknown) =>
          writeStatus(FEISHU_STATUS_KEY, 'error', `飞书发送失败：${error instanceof Error ? error.message : String(error)}`),
        );
    });
  }

  function testDelayedFeishuNotification() {
    chrome.storage.local.get([FEISHU_WEBHOOK_KEY], (result) => {
      const webhook = result[FEISHU_WEBHOOK_KEY];
      if (!isValidFeishuWebhook(webhook)) {
        writeStatus(FEISHU_STATUS_KEY, 'error', '飞书 Webhook 无效，请先保存正确地址。');
        return;
      }

      const pending: PendingFeishuNotification = {
        tabId: TEST_TAB_ID,
        conversationTitle: 'ChatGPT Notifier Plus',
        taskSummary: '30 秒延迟链路测试',
        url: 'https://chatgpt.com/',
        createdAt: Date.now(),
        dueAt: Date.now() + FEISHU_TEST_DELAY_MS,
        isTest: true,
      };

      storeAndSchedulePending(pending, '飞书延迟测试 30 秒倒计时');
    });
  }

  function handleFeishuAlarm(alarm: chrome.alarms.Alarm) {
    if (!alarm.name.startsWith(FEISHU_ALARM_PREFIX)) return;

    const tabId = Number(alarm.name.slice(FEISHU_ALARM_PREFIX.length));
    if (!Number.isInteger(tabId)) return;

    const storageKey = pendingStorageKey(tabId);
    chrome.storage.local.get([storageKey, FEISHU_ENABLED_KEY, FEISHU_WEBHOOK_KEY], (result) => {
      const pending = result[storageKey] as PendingFeishuNotification | undefined;
      if (!pending) {
        writeStatus(FEISHU_STATUS_KEY, 'error', '延迟闹钟已触发，但未找到对应待推送任务。');
        return;
      }

      if (!pending.isTest && result[FEISHU_ENABLED_KEY] !== true) {
        cancelPendingFeishu(tabId, '飞书通知已关闭，待推送任务已取消。');
        return;
      }

      const webhook = result[FEISHU_WEBHOOK_KEY];
      if (!isValidFeishuWebhook(webhook)) {
        writeStatus(FEISHU_STATUS_KEY, 'error', '延迟闹钟已触发，但 Webhook 无效。');
        cancelPendingFeishu(tabId);
        return;
      }

      writeStatus(FEISHU_STATUS_KEY, 'success', '延迟闹钟已触发，正在发送飞书通知…');

      const customText = pending.isTest ? 'ChatGPT 延迟测试通知：30 秒闹钟与后台唤醒链路正常。' : undefined;
      void sendFeishuWebhook(webhook, pending, customText)
        .then(() =>
          writeStatus(
            FEISHU_STATUS_KEY,
            'success',
            pending.isTest ? '飞书延迟测试通知发送成功。' : `已向飞书推送：${pending.conversationTitle}`,
          ),
        )
        .catch((error: unknown) =>
          writeStatus(
            FEISHU_STATUS_KEY,
            'error',
            `飞书发送失败：${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => cancelPendingFeishu(tabId));
    });
  }

  function restorePendingAlarms() {
    chrome.storage.local.get(null, (items) => {
      for (const [key, value] of Object.entries(items)) {
        if (!key.startsWith(FEISHU_PENDING_PREFIX)) continue;

        const pending = value as PendingFeishuNotification | undefined;
        if (!pending || !Number.isInteger(pending.tabId) || typeof pending.dueAt !== 'number') continue;

        const name = alarmName(pending.tabId);
        chrome.alarms.get(name, (existing) => {
          if (chrome.runtime.lastError || existing) return;
          chrome.alarms.create(name, { when: Math.max(Date.now() + 1_000, pending.dueAt) });
        });
      }
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

    if (message.type === 'CHATGPT_TEST_FEISHU_DELAYED') {
      testDelayedFeishuNotification();
      return;
    }

    if (message.type === 'CHATGPT_TAB_VIEWED') {
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number') {
        clearUnreadMarker(tabId);
        cancelPendingFeishu(tabId, '已查看对应 ChatGPT 标签页，飞书推送已取消。');
      }
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

  chrome.alarms.onAlarm.addListener(handleFeishuAlarm);

  chrome.tabs.onRemoved.addListener((tabId) => {
    cancelPendingFeishu(tabId);
  });

  restorePendingAlarms();
});