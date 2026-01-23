document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('volumeSlider');
    const valueDisplay = document.getElementById('volumeValue');
    const STORAGE_KEY = 'chatgpt_notifier_volume';

    // 初始化：获取已存储的音量（默认为 0.5）
    chrome.storage.local.get([STORAGE_KEY], (result) => {
        let vol = result[STORAGE_KEY];
        // 如果未定义或为 null，默认为 0.5
        if (typeof vol !== 'number') {
            vol = 0.5;
        }
        slider.value = vol;
        updateDisplay(vol);
        updateSliderBackground(slider);
    });

    // 监听滑块变化
    slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        updateDisplay(val);
        updateSliderBackground(e.target);
        // 保存到 chrome.storage
        chrome.storage.local.set({ [STORAGE_KEY]: val });
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