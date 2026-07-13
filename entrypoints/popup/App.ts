import { SOUNDS, playTone } from '@/lib/sounds';

type StatusRecord = {
  state: 'success' | 'denied' | 'error';
  message: string;
  updatedAt: number;
};

document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('volumeSlider') as HTMLInputElement;
  const valueDisplay = document.getElementById('volumeValue')!;
  const systemNotifyToggle = document.getElementById('systemNotifyToggle') as HTMLInputElement;
  const soundList = document.getElementById('soundList')!;
  const testNotificationButton = document.getElementById('testNotificationButton') as HTMLButtonElement;
  const testMarkerButton = document.getElementById('testMarkerButton') as HTMLButtonElement;
  const notificationStatus = document.getElementById('notificationStatus')!;
  const feishuEnabledToggle = document.getElementById('feishuEnabledToggle') as HTMLInputElement;
  const feishuWebhookInput = document.getElementById('feishuWebhookInput') as HTMLInputElement;
  const saveFeishuButton = document.getElementById('saveFeishuButton') as HTMLButtonElement;
  const testFeishuButton = document.getElementById('testFeishuButton') as HTMLButtonElement;
  const testDelayedFeishuButton = document.getElementById('testDelayedFeishuButton') as HTMLButtonElement;
  const feishuStatus = document.getElementById('feishuStatus')!;

  const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';
  const NOTIFICATION_STATUS_KEY = 'chatgpt_notifier_notification_status';
  const SOUND_STORAGE_KEY = 'chatgpt_notifier_sound_id';
  const SOUND_COLLAPSED_KEY = 'chatgpt_notifier_sound_collapsed';
  const FEISHU_ENABLED_KEY = 'chatgpt_notifier_feishu_enabled';
  const FEISHU_WEBHOOK_KEY = 'chatgpt_notifier_feishu_webhook';
  const FEISHU_STATUS_KEY = 'chatgpt_notifier_feishu_status';

  const defaultAudio = new Audio(chrome.runtime.getURL('notification.mp3'));

  const versionLabel = document.getElementById('versionLabel')!;
  versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

  function setStatus(target: HTMLElement, message: string, state?: StatusRecord['state'] | 'pending') {
    target.className = 'notification-status';
    if (state) target.classList.add(state);
    target.textContent = message;
  }

  function renderStatus(target: HTMLElement, status?: StatusRecord, emptyMessage = '') {
    if (!status) {
      setStatus(target, emptyMessage);
      return;
    }

    setStatus(target, status.message, status.state);
  }

  function isValidFeishuWebhook(value: string) {
    try {
      const url = new URL(value.trim());
      const supportedHost = url.hostname === 'open.feishu.cn' || url.hostname === 'open.larksuite.com';
      return url.protocol === 'https:' && supportedHost && url.pathname.startsWith('/open-apis/bot/v2/hook/');
    } catch {
      return false;
    }
  }

  function saveWebhookThen(messageType: string, pendingMessage: string) {
    const webhook = feishuWebhookInput.value.trim();
    if (!isValidFeishuWebhook(webhook)) {
      setStatus(feishuStatus, 'Webhook 地址无效，请检查后重试。', 'error');
      return;
    }

    setStatus(feishuStatus, pendingMessage, 'pending');
    chrome.storage.local.set({ [FEISHU_WEBHOOK_KEY]: webhook }, () => {
      const saveError = chrome.runtime.lastError?.message;
      if (saveError) {
        setStatus(feishuStatus, `保存失败：${saveError}`, 'error');
        return;
      }

      chrome.runtime.sendMessage({ type: messageType }, () => {
        const sendError = chrome.runtime.lastError?.message;
        if (sendError) setStatus(feishuStatus, `Background error: ${sendError}`, 'error');
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const notificationStatusChange = changes[NOTIFICATION_STATUS_KEY];
    if (notificationStatusChange) {
      renderStatus(notificationStatus, notificationStatusChange.newValue as StatusRecord | undefined);
    }

    const feishuStatusChange = changes[FEISHU_STATUS_KEY];
    if (feishuStatusChange) {
      renderStatus(feishuStatus, feishuStatusChange.newValue as StatusRecord | undefined);
    }
  });

  testNotificationButton.addEventListener('click', () => {
    setStatus(notificationStatus, 'Sending test notification…', 'pending');
    chrome.runtime.sendMessage({ type: 'CHATGPT_TEST_NOTIFICATION' }, () => {
      const error = chrome.runtime.lastError?.message;
      if (error) setStatus(notificationStatus, `Background error: ${error}`, 'error');
    });
  });

  testMarkerButton.addEventListener('click', () => {
    setStatus(notificationStatus, 'Testing the current ChatGPT tab marker…', 'pending');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError?.message;
      const tabId = tabs[0]?.id;

      if (error || typeof tabId !== 'number') {
        setStatus(notificationStatus, `Cannot find the active tab: ${error || 'unknown error'}`, 'error');
        return;
      }

      chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_TEST_MARKER' }, (response) => {
        const sendError = chrome.runtime.lastError?.message;
        if (sendError || !response?.ok) {
          setStatus(notificationStatus, 'Marker test failed. Refresh the current ChatGPT page and try again.', 'error');
          return;
        }

        setStatus(
          notificationStatus,
          'Tab marker applied. It will remain until you leave this tab and switch back to it.',
          'success',
        );
      });
    });
  });

  saveFeishuButton.addEventListener('click', () => {
    const webhook = feishuWebhookInput.value.trim();
    const enabled = feishuEnabledToggle.checked;

    if (enabled && !isValidFeishuWebhook(webhook)) {
      setStatus(feishuStatus, 'Webhook 地址无效，无法启用飞书通知。', 'error');
      return;
    }

    chrome.storage.local.set(
      {
        [FEISHU_ENABLED_KEY]: enabled,
        [FEISHU_WEBHOOK_KEY]: webhook,
      },
      () => {
        const error = chrome.runtime.lastError?.message;
        if (error) {
          setStatus(feishuStatus, `保存失败：${error}`, 'error');
          return;
        }

        setStatus(
          feishuStatus,
          enabled ? '已保存。任务完成 60 秒后仍未查看时会推送飞书。' : '已保存，飞书通知当前关闭。',
          'success',
        );
      },
    );
  });

  testFeishuButton.addEventListener('click', () => {
    saveWebhookThen('CHATGPT_TEST_FEISHU', '正在发送飞书即时测试通知…');
  });

  testDelayedFeishuButton.addEventListener('click', () => {
    saveWebhookThen('CHATGPT_TEST_FEISHU_DELAYED', '正在建立 30 秒延迟测试…');
  });

  const soundHeader = document.getElementById('soundHeader')!;
  const soundChevron = document.getElementById('soundChevron')!;

  function setSoundOpen(open: boolean) {
    soundList.classList.toggle('collapsed', !open);
    soundChevron.classList.toggle('open', open);
  }

  soundHeader.addEventListener('click', () => {
    const collapsed = soundList.classList.contains('collapsed');
    setSoundOpen(collapsed);
    chrome.storage.local.set({ [SOUND_COLLAPSED_KEY]: collapsed });
  });

  let activeSoundId = 'default';

  function preview(soundId: string) {
    const vol = parseFloat(slider.value);
    const sound = SOUNDS.find((s) => s.id === soundId)!;
    if (sound.freqs.length > 0) {
      playTone(sound.freqs, vol, sound.type);
    } else {
      defaultAudio.volume = vol;
      defaultAudio.currentTime = 0;
      defaultAudio.play().catch(() => {});
    }
  }

  function renderSoundList() {
    soundList.innerHTML = '';
    SOUNDS.forEach((sound) => {
      const item = document.createElement('div');
      item.className = `sound-item${sound.id === activeSoundId ? ' active' : ''}`;
      item.innerHTML = `<span class="sound-dot"></span><span class="sound-name">${sound.name}</span>`;

      item.addEventListener('click', () => {
        activeSoundId = sound.id;
        chrome.storage.local.set({ [SOUND_STORAGE_KEY]: sound.id });
        renderSoundList();
        preview(sound.id);
      });

      soundList.appendChild(item);
    });
  }

  function updateDisplay(val: number) {
    valueDisplay.textContent = String(Math.round(val * 100));
  }

  function updateSliderBackground(target: HTMLInputElement) {
    const val = parseFloat(target.value);
    const percentage = val * 100;
    target.style.background = `linear-gradient(to right, #343541 ${percentage}%, #ececf1 ${percentage}%)`;
  }

  slider.addEventListener('change', () => {
    defaultAudio.volume = parseFloat(slider.value);
    preview(activeSoundId);
  });

  chrome.storage.local.get(
    [
      VOLUME_STORAGE_KEY,
      SYSTEM_NOTIFICATION_KEY,
      NOTIFICATION_STATUS_KEY,
      SOUND_STORAGE_KEY,
      SOUND_COLLAPSED_KEY,
      FEISHU_ENABLED_KEY,
      FEISHU_WEBHOOK_KEY,
      FEISHU_STATUS_KEY,
    ],
    (result) => {
      let vol: number = result[VOLUME_STORAGE_KEY] as number;
      if (typeof vol !== 'number') vol = 0.5;
      slider.value = String(vol);
      defaultAudio.volume = vol;
      updateDisplay(vol);
      updateSliderBackground(slider);

      systemNotifyToggle.checked = result[SYSTEM_NOTIFICATION_KEY] === true;
      renderStatus(notificationStatus, result[NOTIFICATION_STATUS_KEY] as StatusRecord | undefined, '');

      activeSoundId = (result[SOUND_STORAGE_KEY] as string) || 'default';
      setSoundOpen(result[SOUND_COLLAPSED_KEY] !== false);
      renderSoundList();

      feishuEnabledToggle.checked = result[FEISHU_ENABLED_KEY] === true;
      feishuWebhookInput.value = (result[FEISHU_WEBHOOK_KEY] as string) || '';
      renderStatus(
        feishuStatus,
        result[FEISHU_STATUS_KEY] as StatusRecord | undefined,
        'Webhook 仅保存在当前浏览器本机。',
      );
    },
  );

  slider.addEventListener('input', (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    updateDisplay(val);
    updateSliderBackground(e.target as HTMLInputElement);
    chrome.storage.local.set({ [VOLUME_STORAGE_KEY]: val });
  });

  systemNotifyToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({
      [SYSTEM_NOTIFICATION_KEY]: (e.target as HTMLInputElement).checked,
    });
  });
});