document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('volumeSlider');
    const valueDisplay = document.getElementById('volumeValue');
    const systemNotifyToggle = document.getElementById('systemNotifyToggle');
    const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
    const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';

    // 初始化：获取已存储设置
    chrome.storage.local.get([VOLUME_STORAGE_KEY, SYSTEM_NOTIFICATION_KEY], (result) => {
        let vol = result[VOLUME_STORAGE_KEY];
        // 如果未定义或为 null，默认为 0.5
        if (typeof vol !== 'number') {
            vol = 0.5;
        }
        slider.value = vol;
        updateDisplay(vol);
        updateSliderBackground(slider);

        systemNotifyToggle.checked = result[SYSTEM_NOTIFICATION_KEY] === true;
    });

    // 监听滑块变化
    slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        updateDisplay(val);
        updateSliderBackground(e.target);
        // 保存到 chrome.storage
        chrome.storage.local.set({ [VOLUME_STORAGE_KEY]: val });
    });

    systemNotifyToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ [SYSTEM_NOTIFICATION_KEY]: e.target.checked });
    });

    function updateDisplay(val) {
        valueDisplay.textContent = Math.round(val * 100);
    }

    function updateSliderBackground(target) {
        const val = parseFloat(target.value);
        const percentage = val * 100;
        // 深灰色 #343541，背景灰 #ececf1
        target.style.background = `linear-gradient(to right, #343541 ${percentage}%, #ececf1 ${percentage}%)`;
    }
});
