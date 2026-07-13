type DonePayload = {
  taskId?: string;
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
  taskId: string;
  conversationTitle: string;
  taskSummary: string;
  url: string;
  createdAt: number;
  dueAt: number;
  isTest?: boolean;
};

type AckResponse = {
  ok: boolean;
  cancelled: boolean;
  reason?: string;
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

  function createTaskId(prefix = 'task') {
    const randomPart =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${Date.now()}-${randomPart}`;
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

  function alarmName(tabId: number, taskId: string) {
    return `${FEISHU_ALARM_PREFIX}${tabId}:${taskId}`;
  }

  function legacyAlarmName(tabId: number) {
    return `${FEISHU_ALARM_PREFIX}${tabId}`;
  }

  function parseAlarmName(name: string) {
    if (!name.startsWith(FEISHU_ALARM_PREFIX)) return null;

    const suffix = name.slice(FEISHU_ALARM_PREFIX.length);
    const separatorIndex = suffix.indexOf(':');
    if (separatorIndex <= 0) return null;

    const tabId = Number(suffix.slice(0, separatorIndex));
    const taskId = suffix.slice(separatorIndex + 1);
    if (!Number.isInteger(tabId) || !taskId) return null;

    return { tabId, taskId };
  }

  function clearUnreadMarker(tabId: number) {
    chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_CLEAR_UNREAD' }, () => {
      void chrome.runtime.lastError;
    });
  }

  function cancelPendingFeishu(
    tabId: number,
    expectedTaskId?: string,
    statusMessage?: string,
    callback?: (cancelled: boolean) => void,
  ) {
    const storageKey = pendingStorageKey(tabId);

    chrome.storage.local.get([storageKey], (result) => {
      const pending = result[storageKey] as PendingFeishuNotification | undefined;
      if (!pending || !pending.taskId) {
        callback?.(false);
        return;
      }

      if (expectedTaskId && pending.taskId !== expectedTaskId) {
        callback?.(false);
        return;
      }

      chrome.alarms.clear(alarmName(tabId, pending.taskId), () => {
        void chrome.runtime.lastError;
        chrome.alarms.clear(legacyAlarmName(tabId), () => {
          void chrome.runtime.lastError;
          chrome.storage.local.remove(storageKey, () => {
            const error = chrome.runtime.lastError?.message;
            if (error) {
              writeStatus(FEISHU_STATUS_KEY, 'error', `取消待推送任务失败：${error}`);
              callback?.(false);
              return;
            }

            if (statusMessage) writeStatus(FEISHU_STATUS_KEY, 'success', statusMessage);
            callback?.(true);
          });
        });
      });
    });
  }

  function cancelCurrentPendingForTab(tabId: number, statusMessage: string) {
    const storageKey = pendingStorageKey(tabId);
    chrome.storage.local.get([storageKey], (result) => {
      const pending = result[storageKey] as PendingFeishuNotification | undefined;
      if (!pending?.taskId || pending.isTest) return;
      cancelPendingFeishu(tabId, pending.taskId, statusMessage);
    });
  }

  function notifyTaskRegistered(pending: PendingFeishuNotification) {
    if (pending.isTest || pending.tabId < 0) return;

    chrome.tabs.sendMessage(
      pending.tabId,
      {
        type: 'CHATGPT_TASK_REGISTERED',
        taskId: pending.taskId,
        dueAt: pending.dueAt,
      },
      () => {
        const error = chrome.runtime.lastError?.message;
        if (error) {
          writeStatus(
            FEISHU_STATUS_KEY,
            'error',
            `任务已登记，但页面确认通道失败：${error}。若未切换标签，60 秒后仍会推送。`,
          );
        }
      },
    );
  }

  function storeAndSchedulePending(pending: PendingFeishuNotification, delayLabel: string) {
    const storageKey = pendingStorageKey(pending.tabId);

    chrome.storage.local.get([storageKey], (result) => {
      const previous = result[storageKey] as PendingFeishuNotification | undefined;

      const storeNewPending = () => {
        chrome.storage.local.set({ [storageKey]: pending }, () => {
          const storageError = chrome.runtime.lastError?.message;
          if (storageError) {
            writeStatus(FEISHU_STATUS_KEY, 'error', `保存待推送任务失败：${storageError}`);
            return;
          }

          const name = alarmName(pending.tabId, pending.taskId);
          chrome.alarms.create(name, { when: pending.dueAt });
          chrome.alarms.get(name, (createdAlarm) => {
            const alarmError = chrome.runtime.lastError?.message;
            if (alarmError || !createdAlarm) {
              writeStatus(FEISHU_STATUS_KEY, 'error', `创建延迟闹钟失败：${alarmError || '未返回闹钟记录'}`);
              chrome.storage.local.remove(storageKey);
              return;
            }

            writeStatus(
              FEISHU_STATUS_KEY,
              'success',
              `${delayLabel}已登记；任务编号 ${pending.taskId.slice(-8)}。查看对应标签页会取消。`,
            );
            notifyTaskRegistered(pending);
          });
        });
      };

      if (previous?.taskId) {
        chrome.alarms.clear(alarmName(previous.tabId, previous.taskId), () => {
          void chrome.runtime.lastError;
          storeNewPending();
        });
        return;
      }

      chrome.alarms.clear(legacyAlarmName(pending.tabId), () => {
        void chrome.runtime.lastError;
        storeNewPending();
      });
    });
  }

  function scheduleFeishuNotification(payload: DonePayload, tab?: chrome.tabs.Tab) {
    const tabId = tab?.id;
    const taskId = payload.taskId;

    if (typeof tabId !== 'number') {
      writeStatus(FEISHU_STATUS_KEY, 'error', '检测到任务完成，但无法确定对应标签页。');
      return;
    }

    if (typeof taskId !== 'string' || !taskId) {
      writeStatus(FEISHU_STATUS_KEY, 'error', '检测到任务完成，但缺少任务编号。请刷新 ChatGPT 页面后重试。');
      return;
    }

    writeStatus(FEISHU_STATUS_KEY, 'success', `已检测任务完成，正在登记：${taskId.slice(-8)}`);

    chrome.storage.local.get([FEISHU_ENABLED_KEY, FEISHU_WEBHOOK_KEY], (result) => {
      if (result[FEISHU_ENABLED_KEY] !== true) {
        writeStatus(FEISHU_STATUS_KEY, 'success', '已检测任务完成，但飞书通知当前关闭。');
        return;
      }

      const webhook = result[FEISHU_WEBHOOK_KEY];
      if (!isValidFeishuWebhook(webhook)) {
        writeStatus(FEISHU_STATUS_KEY, 'error', '飞书 Webhook 无效，请在插件设置中重新保存。');
        return;
      }

      const pending: PendingFeishuNotification = {
        tabId,
        taskId,
        conversationTitle:
          payload.conversationTitle || payload.title?.replace(/^ChatGPT 已完成：/, '') || 'ChatGPT 对话',
        taskSummary: payload.taskSummary || payload.message?.replace(/^任务：/, '') || '回复已生成。',
        url: payload.url || tab?.url || 'https://chatgpt.com/',
        createdAt: Date.now(),
        dueAt: Date.now() + FEISHU_DELAY_MS,
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
        taskId: createTaskId('test'),
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
    const parsed = parseAlarmName(alarm.name);
    if (!parsed) return;

    const { tabId, taskId } = parsed;
    const storageKey = pendingStorageKey(tabId);

    chrome.storage.local.get([storageKey, FEISHU_ENABLED_KEY, FEISHU_WEBHOOK_KEY], (result) => {
      const pending = result[storageKey] as PendingFeishuNotification | undefined;
      if (!pending || pending.taskId !== taskId) {
        return;
      }

      if (!pending.isTest && result[FEISHU_ENABLED_KEY] !== true) {
        cancelPendingFeishu(tabId, taskId, '飞书通知已关闭，待推送任务已取消。');
        return;
      }

      const webhook = result[FEISHU_WEBHOOK_KEY];
      if (!isValidFeishuWebhook(webhook)) {
        writeStatus(FEISHU_STATUS_KEY, 'error', `任务 ${taskId.slice(-8)} 的闹钟已触发，但 Webhook 无效。`);
        cancelPendingFeishu(tabId, taskId);
        return;
      }

      writeStatus(FEISHU_STATUS_KEY, 'success', `任务 ${taskId.slice(-8)} 的闹钟已触发，正在发送…`);

      const customText = pending.isTest ? 'ChatGPT 延迟测试通知：30 秒闹钟与后台唤醒链路正常。' : undefined;
      void sendFeishuWebhook(webhook, pending, customText)
        .then(() =>
          writeStatus(
            FEISHU_STATUS_KEY,
            'success',
            pending.isTest
              ? '飞书延迟测试通知发送成功。'
              : `飞书通知已发送：${pending.conversationTitle}（${taskId.slice(-8)}）`,
          ),
        )
        .catch((error: unknown) =>
          writeStatus(
            FEISHU_STATUS_KEY,
            'error',
            `飞书发送失败：${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => cancelPendingFeishu(tabId, taskId));
    });
  }

  function restorePendingAlarms() {
    chrome.storage.local.get(null, (items) => {
      for (const [key, value] of Object.entries(items)) {
        if (!key.startsWith(FEISHU_PENDING_PREFIX)) continue;

        const pending = value as PendingFeishuNotification | undefined;
        const tabId = Number(key.slice(FEISHU_PENDING_PREFIX.length));
        if (
          !pending ||
          !Number.isInteger(tabId) ||
          !Number.isInteger(pending.tabId) ||
          typeof pending.taskId !== 'string' ||
          !pending.taskId ||
          typeof pending.dueAt !== 'number'
        ) {
          chrome.storage.local.remove(key);
          if (Number.isInteger(tabId)) chrome.alarms.clear(legacyAlarmName(tabId));
          continue;
        }

        const name = alarmName(pending.tabId, pending.taskId);
        chrome.alarms.get(name, (existing) => {
          if (chrome.runtime.lastError || existing) return;
          chrome.alarms.create(name, { when: Math.max(Date.now() + 1_000, pending.dueAt) });
        });
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    if (message.type === 'CHATGPT_TASK_ACK') {
      const tabId = sender.tab?.id;
      const taskId = message.taskId;

      if (typeof tabId !== 'number' || typeof taskId !== 'string' || !taskId) {
        sendResponse({ ok: false, cancelled: false, reason: 'invalid-ack' } satisfies AckResponse);
        return;
      }

      cancelPendingFeishu(
        tabId,
        taskId,
        `已查看对应 ChatGPT 标签页，任务 ${taskId.slice(-8)} 的飞书推送已取消。`,
        (cancelled) => {
          sendResponse({
            ok: true,
            cancelled,
            reason: cancelled ? undefined : 'task-not-current',
          } satisfies AckResponse);
        },
      );
      return true;
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

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    clearUnreadMarker(tabId);
    cancelCurrentPendingForTab(tabId, '已切换到对应 ChatGPT 标签页，飞书推送已取消。');
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;

    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (typeof tabId !== 'number') return;
      clearUnreadMarker(tabId);
      cancelCurrentPendingForTab(tabId, '已返回对应 ChatGPT 窗口，飞书推送已取消。');
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    cancelCurrentPendingForTab(tabId, '对应 ChatGPT 标签页已关闭，飞书推送已取消。');
  });

  restorePendingAlarms();
});