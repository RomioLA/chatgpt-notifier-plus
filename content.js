const AUDIO_URL = chrome.runtime.getURL('notification.mp3');
let audio = new Audio(AUDIO_URL);
const STORAGE_KEY = 'chatgpt_notifier_volume';

// 从存储初始化音量
chrome.storage.local.get([STORAGE_KEY], (result) => {
    const vol = result[STORAGE_KEY];

    if (typeof vol === 'number') {
        audio.volume = vol;
    }
    else {
        audio.volume = 0.5;
    }
});

// 监听来自 popup 的音量变化
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
        // 直接更新音量属性，无需重建对象
        // 这能确保更流畅的体验，且避免潜在的加载延迟
        const newVol = changes[STORAGE_KEY].newValue;
        if (typeof newVol === 'number') {
            audio.volume = newVol;
        }
    }
});

/**
 * 所有已知的「正在写作」DOM 选择器
 * 如果 OpenAI 以后再改，只要在这里加新的 selector 即可
 */
const STREAM_SELECTORS = [
    '.result-streaming',                          // 旧版：reply 容器
    'button[data-testid$="stop-button"]',         // 2024-04 以后：Stop generating
    '[data-testid="assistant-response-spinner"]'  // A/B 测试的新 spinner
].join(',');
  

// 记录当前是否处于流式输出
let isStreaming = false;
let doneTimerId = null;
const DEBOUNCE_MS = 300;

function checkStreaming() {
    const stillStreaming = document.querySelector(STREAM_SELECTORS) !== null;

    if (stillStreaming) {
        isStreaming = true;

        // 只要又检测到流式，就取消结束计时
        clearTimeout(doneTimerId);

        doneTimerId = null;
    }
    else if (isStreaming && !doneTimerId) {
        // 第一次检测到 “似乎结束”，启动消抖计时器
        doneTimerId = setTimeout(() => {
            // 再次确认页面上确实已经没有流式节点
            if (document.querySelector(STREAM_SELECTORS) === null) {
                audio.play().catch(() => {/* 忽略自动播放限制 */});
                isStreaming = false;
            }

            doneTimerId = null;
        }, DEBOUNCE_MS);
    }
}


// 用一个 Observer 全局监听：节点增删、属性变动都触发回调
const observer = new MutationObserver(() => {
    // 使用微任务队列防抖，避免一次大批量 DOM 变动时触发多次
    queueMicrotask(checkStreaming);
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-testid', 'aria-busy']
});

// 初始检查（页面刚加载或刷新时）
checkStreaming();
