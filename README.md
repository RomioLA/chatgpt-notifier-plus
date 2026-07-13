# ChatGPT Notifier Plus

A Chrome/Edge extension that makes parallel ChatGPT tasks easier to identify when replies finish.

## Features

- 9 notification sounds with adjustable volume
- Optional Windows system notifications
- System notification title includes the ChatGPT conversation title
- System notification body includes a summary of the latest user request
- Background tabs receive a `●` unread marker in the tab title
- The unread marker remains until the corresponding tab is viewed
- Optional Feishu custom-bot Webhook notifications
- Feishu delivery waits 60 seconds and is cancelled when the corresponding ChatGPT tab is viewed
- Feishu messages include the conversation title, task summary, and ChatGPT conversation URL
- Webhook configuration is stored only in the browser's local extension storage

## Build and install locally

```bash
pnpm install
pnpm build
```

Then open `edge://extensions` or `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
.output/chrome-mv3
```

After rebuilding, reload the extension and refresh already-open ChatGPT tabs so the new content script is injected.

## Feishu setup

1. Add a custom bot to a Feishu group and copy its Webhook URL.
2. Open the extension popup.
3. Enable **Feishu Notification**.
4. Paste the Webhook URL and click **Save**.
5. Click **Test Feishu** to verify delivery.

If a ChatGPT reply finishes in a background tab, the extension schedules a Feishu push for approximately 60 seconds later. Selecting that tab in a focused browser window cancels the pending push.

## Development

```bash
pnpm dev
pnpm build
pnpm zip
```

Forked from [Taragryen/chatgpt-notifier](https://github.com/Taragryen/chatgpt-notifier).