import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'ChatGPT Notifier Plus',
    version: '1.6.4',
    description:
      'Task-aware ChatGPT completion notifications with unread tab markers.',
    permissions: ['storage', 'notifications'],
    icons: {
      '128': '/logo.png',
    },
    web_accessible_resources: [
      {
        resources: ['notification.mp3'],
        matches: ['https://chatgpt.com/*'],
      },
    ],
  },
});
