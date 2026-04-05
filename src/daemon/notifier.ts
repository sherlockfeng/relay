import notifier from 'node-notifier';

export function notifySessionCompleted(sessionId: string, platform: string): void {
  notifier.notify({
    title: 'AI Chat Digest',
    message: `${platform} session completed (${sessionId.slice(0, 8)}…)`,
    sound: false,
  });
}

export function notifySummaryReady(title: string, tags: string[]): void {
  const tagLine = tags.length > 0 ? `Tags: ${tags.join(', ')}` : '';
  notifier.notify({
    title: 'Summary ready',
    message: tagLine ? `${title}\n${tagLine}` : title,
    sound: false,
  });
}
