# ChatGPT Notifier Plus

A Chrome/Edge extension that makes parallel ChatGPT tasks easier to identify when replies finish.

## Features

- 9 notification sounds with adjustable volume
- Optional system notifications
- Notification title includes the ChatGPT conversation title
- Notification body includes a summary of the latest user request
- Notifications remain visible until clicked or dismissed
- Clicking a notification focuses the exact ChatGPT tab that produced it
- Background tabs receive a `●` unread marker in the tab title
- The unread marker is removed when the tab is viewed

## Build and install locally

```bash
pnpm install
pnpm build
```

Then open `edge://extensions` or `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
.output/chrome-mv3
```

Enable **System notification** in the extension popup to use task-aware clickable notifications. Sound and unread-tab marking continue to work independently.

## Development

```bash
pnpm dev
pnpm build
pnpm zip
```

Forked from [Taragryen/chatgpt-notifier](https://github.com/Taragryen/chatgpt-notifier).
