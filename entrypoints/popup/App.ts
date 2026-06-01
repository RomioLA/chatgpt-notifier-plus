document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('volumeSlider') as HTMLInputElement;
  const valueDisplay = document.getElementById('volumeValue')!;
  const systemNotifyToggle = document.getElementById('systemNotifyToggle') as HTMLInputElement;
  const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';

  const audio = new Audio(chrome.runtime.getURL('notification.mp3'));

  // Set version from manifest
  const versionLabel = document.getElementById('versionLabel')!;
  versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

  // Initialize from stored settings
  chrome.storage.local.get([VOLUME_STORAGE_KEY, SYSTEM_NOTIFICATION_KEY], (result) => {
    let vol: number = result[VOLUME_STORAGE_KEY] as number;
    if (typeof vol !== 'number') {
      vol = 0.5;
    }
    slider.value = String(vol);
    audio.volume = vol;
    updateDisplay(vol);
    updateSliderBackground(slider);

    systemNotifyToggle.checked = result[SYSTEM_NOTIFICATION_KEY] === true;
  });

  slider.addEventListener('input', (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    updateDisplay(val);
    updateSliderBackground(e.target as HTMLInputElement);
    chrome.storage.local.set({ [VOLUME_STORAGE_KEY]: val });
  });

  slider.addEventListener('change', () => {
    audio.volume = parseFloat(slider.value);
    audio.currentTime = 0;
    audio.play().catch(() => {
      /* ignore autoplay restrictions */
    });
  });

  systemNotifyToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ [SYSTEM_NOTIFICATION_KEY]: (e.target as HTMLInputElement).checked });
  });

  function updateDisplay(val: number) {
    valueDisplay.textContent = String(Math.round(val * 100));
  }

  function updateSliderBackground(target: HTMLInputElement) {
    const val = parseFloat(target.value);
    const percentage = val * 100;
    target.style.background = `linear-gradient(to right, #343541 ${percentage}%, #ececf1 ${percentage}%)`;
  }
});
