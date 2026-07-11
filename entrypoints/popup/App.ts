import { SOUNDS, playTone } from '@/lib/sounds';

type NotificationStatus = {
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
  const notificationStatus = document.getElementById('notificationStatus')!;
  const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';
  const NOTIFICATION_STATUS_KEY = 'chatgpt_notifier_notification_status';
  const SOUND_STORAGE_KEY = 'chatgpt_notifier_sound_id';
  const SOUND_COLLAPSED_KEY = 'chatgpt_notifier_sound_collapsed';

  const defaultAudio = new Audio(chrome.runtime.getURL('notification.mp3'));

  // Set version from manifest.
  const versionLabel = document.getElementById('versionLabel')!;
  versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

  function renderNotificationStatus(status?: NotificationStatus) {
    notificationStatus.className = 'notification-status';

    if (!status) {
      notificationStatus.textContent = 'Use the test button to verify Windows notifications.';
      return;
    }

    notificationStatus.classList.add(status.state);
    notificationStatus.textContent = status.message;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const statusChange = changes[NOTIFICATION_STATUS_KEY];
    if (statusChange) {
      renderNotificationStatus(statusChange.newValue as NotificationStatus | undefined);
    }
  });

  testNotificationButton.addEventListener('click', () => {
    notificationStatus.className = 'notification-status pending';
    notificationStatus.textContent = 'Sending test notification…';
    chrome.runtime.sendMessage({ type: 'CHATGPT_TEST_NOTIFICATION' });
  });

  // --- Sound collapsible ---
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

  // --- Sound list ---
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

  // --- Volume ---
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
    ],
    (result) => {
      let vol: number = result[VOLUME_STORAGE_KEY] as number;
      if (typeof vol !== 'number') vol = 0.5;
      slider.value = String(vol);
      defaultAudio.volume = vol;
      updateDisplay(vol);
      updateSliderBackground(slider);

      systemNotifyToggle.checked = result[SYSTEM_NOTIFICATION_KEY] === true;
      renderNotificationStatus(result[NOTIFICATION_STATUS_KEY] as NotificationStatus | undefined);

      activeSoundId = (result[SOUND_STORAGE_KEY] as string) || 'default';
      setSoundOpen(result[SOUND_COLLAPSED_KEY] !== false);
      renderSoundList();
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
