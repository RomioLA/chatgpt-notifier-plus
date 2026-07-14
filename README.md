# ChatGPT Notifier Plus

[English](#english) | [简体中文](#简体中文)

---

## English

### Overview

ChatGPT Notifier Plus is a Chrome/Edge extension designed for people who run several ChatGPT tasks at the same time.

When a reply finishes, the extension can play a sound, show a Windows notification, mark the background tab with a `●`, and optionally send a delayed notification to Feishu. If you return to the corresponding ChatGPT tab before the delay expires, the Feishu notification is cancelled.

The project is intended to make long-running and parallel ChatGPT workflows easier to monitor without repeatedly checking every tab.

> Current status: personal beta. Core functions are usable, but ChatGPT page changes, browser focus behavior, and extension reloads may still affect completion detection or delayed notification behavior.

### Features

- Detects when a ChatGPT reply finishes.
- Provides 9 notification sounds.
- Adjustable notification volume.
- Optional Windows desktop notifications.
- Windows notification titles include the ChatGPT conversation title.
- Windows notification bodies include a summary of the latest user request.
- Adds a `●` unread marker to completed background tabs.
- Removes the unread marker after the corresponding tab is viewed.
- Optional Feishu custom-bot Webhook notifications.
- Delays Feishu delivery for approximately 60 seconds.
- Cancels the pending Feishu notification when the matching ChatGPT tab is viewed.
- Uses per-task identifiers to reduce interference between stale events, newer replies, and multiple tabs.
- Includes direct and delayed Feishu test buttons.
- Feishu messages include the conversation title, task summary, and conversation URL.
- Stores the Webhook only in the browser extension's local storage.

### Typical use cases

- Running several ChatGPT conversations in parallel.
- Waiting for long code, research, or document-generation tasks.
- Working in another application while ChatGPT is responding.
- Receiving a remote notification only when a completed task has not been checked on the computer.

### Installation

This repository currently provides source code for local installation.

Requirements:

- Node.js
- pnpm through Corepack
- Chrome or Microsoft Edge

Build the extension:

```bash
pnpm install
pnpm build
```

Then:

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select:

```text
.output/chrome-mv3
```

After rebuilding the extension, reload it from the extensions page and refresh any ChatGPT tabs that were already open.

### Feishu setup

1. Create or open a Feishu group.
2. Add a **Custom Bot** to the group.
3. Copy the bot Webhook URL.
4. Open the extension popup.
5. Enable **Feishu Notification**.
6. Paste the Webhook URL and click **Save**.
7. Use **Test Feishu** to verify direct delivery.
8. Use **Test delayed Feishu (30s)** to verify the alarm and service-worker wake-up path.

For normal ChatGPT replies, the extension waits approximately 60 seconds before sending. Returning to the corresponding conversation during that period cancels the pending Feishu notification.

### Privacy

- The Feishu Webhook is stored in `chrome.storage.local` on the current browser profile.
- The Webhook is not included in the source code or repository.
- Notification content can include the conversation title, the latest user request summary, and the ChatGPT conversation URL.
- Data sent to Feishu is subject to Feishu's own service and privacy policies.

Do not commit a personal Webhook URL to a public repository.

### Known limitations

- Only `https://chatgpt.com/*` is supported.
- Completion detection depends on the current ChatGPT page structure and may need adjustment after major website updates.
- Existing ChatGPT tabs must be refreshed after the extension is rebuilt or reloaded.
- Browser tab visibility and focus events can behave differently across browser versions and window states.
- The delayed Feishu workflow remains a beta feature and may require further refinement for unusual multi-window or rapid-task scenarios.

### Project references and acknowledgements

This project is based on and extends:

- [Taragryen/chatgpt-notifier](https://github.com/Taragryen/chatgpt-notifier) — the original notification extension and the foundation of this fork.

The project is built with or relies on:

- [WXT](https://wxt.dev/) — browser extension development framework.
- [Chrome Extensions APIs](https://developer.chrome.com/docs/extensions/reference/api/) — storage, notifications, tabs, windows, and alarms.
- [Feishu Custom Bot Webhook](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot) — optional remote notification delivery.

ChatGPT, Chrome, Microsoft Edge, Feishu, and WXT are trademarks or products of their respective owners. This project is not officially affiliated with OpenAI, Google, Microsoft, or Feishu.

### Development

```bash
pnpm dev
pnpm build
pnpm zip
```

---

## 简体中文

### 项目介绍

ChatGPT Notifier Plus 是一个面向 Chrome 和 Microsoft Edge 的浏览器扩展，主要用于管理多个并行运行的 ChatGPT 任务。

当 ChatGPT 完成回复时，插件可以播放提示音、显示 Windows 系统通知、在后台标签标题前增加 `●` 未读标记，并可选择在一段时间后通过飞书推送远程通知。如果你在延迟时间内回到对应的 ChatGPT 标签页，飞书通知会自动取消。

这个项目适合同时打开多个 ChatGPT 对话、等待长时间代码任务、资料调查或文档生成的用户，减少反复切换标签检查任务是否完成的操作。

> 当前状态：个人测试版。核心功能已经基本可用，但 ChatGPT 页面结构变化、浏览器焦点行为和扩展重新加载，仍可能影响完成检测或延迟通知。

### 项目功能

- 检测 ChatGPT 回复完成状态。
- 提供 9 种可选提示音。
- 支持调节提示音音量。
- 可选 Windows 桌面通知。
- Windows 通知标题显示 ChatGPT 对话标题。
- Windows 通知正文显示最近一次用户任务摘要。
- 后台任务完成后，在标签标题前增加 `●` 未读标记。
- 查看对应标签页后自动移除未读标记。
- 支持飞书自定义机器人 Webhook 通知。
- 飞书通知默认延迟约 60 秒发送。
- 在延迟期间查看对应 ChatGPT 标签页，可取消该次飞书推送。
- 使用独立任务编号，降低旧事件、旧闹钟、新回复和多标签任务互相干扰的概率。
- 提供即时飞书测试和 30 秒延迟飞书测试。
- 飞书消息可包含对话标题、任务摘要和对话链接。
- Webhook 仅保存在当前浏览器的本地扩展存储中。

### 适用场景

- 同时运行多个 ChatGPT 对话。
- 等待较长的代码、研究、分析或文档生成任务。
- ChatGPT 回复期间切换到其他软件工作。
- 仅在电脑上长时间未查看任务时，通过飞书接收远程提醒。

### 本地安装

当前仓库主要提供源码，需要在本地构建并以解压扩展方式安装。

环境要求：

- Node.js
- 通过 Corepack 使用 pnpm
- Chrome 或 Microsoft Edge

构建插件：

```bash
pnpm install
pnpm build
```

然后执行：

1. 打开 `edge://extensions` 或 `chrome://extensions`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择以下目录：

```text
.output/chrome-mv3
```

每次重新构建后，需要在扩展管理页重新加载插件，并刷新已经打开的 ChatGPT 标签页。

### 飞书配置

1. 新建或打开一个飞书群。
2. 在群设置中添加“自定义机器人”。
3. 复制机器人的 Webhook 地址。
4. 打开插件弹窗。
5. 开启 **Feishu Notification**。
6. 粘贴 Webhook，然后点击 **Save**。
7. 点击 **Test Feishu** 验证即时发送。
8. 点击 **Test delayed Feishu (30s)** 验证延迟闹钟与后台唤醒链路。

正常使用时，ChatGPT 回复完成后会等待约 60 秒。等待期间回到对应对话，会取消该次飞书推送；未查看时则发送远程通知。

### 隐私说明

- 飞书 Webhook 保存在当前浏览器配置的 `chrome.storage.local` 中。
- Webhook 不会写入源码，也不应提交到公开仓库。
- 发送到飞书的内容可能包括对话标题、最近一次用户任务摘要和 ChatGPT 对话链接。
- 已发送到飞书的数据同时受飞书自身服务条款和隐私政策约束。

不要把个人 Webhook 地址提交到公开 GitHub 仓库。

### 已知限制

- 当前仅支持 `https://chatgpt.com/*`。
- 回复完成检测依赖 ChatGPT 当前页面结构；网站大幅更新后可能需要适配。
- 插件重新构建或重新加载后，已有 ChatGPT 标签页需要刷新。
- 不同浏览器版本、多个窗口和窗口焦点状态可能产生不同的标签事件行为。
- 飞书延迟推送仍属于测试功能，在多窗口、快速连续任务等特殊场景下可能需要继续优化。

### 项目参考与致谢

本项目基于并扩展自：

- [Taragryen/chatgpt-notifier](https://github.com/Taragryen/chatgpt-notifier) —— 原始通知扩展，也是本项目的主要基础。

项目使用或参考了：

- [WXT](https://wxt.dev/) —— 浏览器扩展开发框架。
- [Chrome Extensions APIs](https://developer.chrome.com/docs/extensions/reference/api/) —— 存储、系统通知、标签页、窗口和闹钟能力。
- [飞书自定义机器人 Webhook](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot) —— 可选的远程通知渠道。

ChatGPT、Chrome、Microsoft Edge、飞书和 WXT 分别属于其对应权利人。本项目与 OpenAI、Google、Microsoft 或飞书不存在官方隶属或合作关系。

### 开发命令

```bash
pnpm dev
pnpm build
pnpm zip
```
