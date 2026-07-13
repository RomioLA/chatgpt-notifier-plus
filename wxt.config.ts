import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'ChatGPT Notifier Plus',
    version: '1.7.2',
    description:
      'Task-aware ChatGPT completion notifications with unread tab markers and delayed Feishu delivery.',
    permissions: ['storage', 'notifications', 'alarms'],
    host_permissions: ['https://open.feishu.cn/*', 'https://open.larksuite.com/*'],
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