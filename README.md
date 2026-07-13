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
- Every completed reply receives a unique task ID and a 60-second pending record
- Viewing the exact ChatGPT tab acknowledges only the matching task ID and cancels its Feishu push
- Stale tab events and stale alarms cannot cancel or send a newer task
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
5. Click **Test Feishu** to verify direct delivery.
6. Click **Test delayed Feishu (30s)** to verify alarms and service-worker wake-up.

For real replies, the extension first registers the exact task and then waits approximately 60 seconds. Staying on the completed conversation or opening its tab acknowledges that task and cancels the pending push. If it is still unacknowledged when its matching alarm fires, the extension sends the Feishu message.

## Development

```bash
pnpm dev
pnpm build
pnpm zip
```

Forked from [Taragryen/chatgpt-notifier](https://github.com/Taragryen/chatgpt-notifier).