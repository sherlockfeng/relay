import type { AppConfig } from '../config.js';
import { summarizeSession } from '../summarizer/index.js';
import * as notifications from './notifier.js';
import {
  SessionTracker,
  type SessionLifecyclePayload,
} from './session-tracker.js';
import { TranscriptWatcher } from './watcher.js';

export class Daemon {
  private readonly config: AppConfig;
  private readonly watcher: TranscriptWatcher;
  private readonly tracker: SessionTracker;
  private started = false;

  constructor(config: AppConfig) {
    this.config = config;
    this.watcher = new TranscriptWatcher(config);
    this.tracker = new SessionTracker();
    this.wireEvents();
  }

  private wireEvents(): void {
    this.watcher.on('new-session', (payload) => {
      this.tracker.trackFile(payload.filePath, payload.platform);
    });

    this.watcher.on('session-changed', (payload) => {
      this.tracker.handleFileChange(payload.filePath);
    });

    this.tracker.on('session:completed', (payload: SessionLifecyclePayload) => {
      void this.onSessionCompleted(payload);
    });
  }

  private async onSessionCompleted(payload: SessionLifecyclePayload): Promise<void> {
    const { sessionId, platform, filePath } = payload;

    if (this.config.notifications.enabled) {
      notifications.notifySessionCompleted(sessionId, platform);
    }

    try {
      const summary = await summarizeSession({
        transcriptPath: filePath,
        platform,
        config: this.config,
      });
      if (summary && this.config.notifications.enabled) {
        notifications.notifySummaryReady(summary.title, summary.tags);
      }
    } catch (err) {
      console.error('[ai-chat-digest] summarization failed:', err);
    }
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.watcher.start();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    await this.watcher.stop();
    this.tracker.dispose();
  }

  getStatus(): {
    running: boolean;
    sessions: ReturnType<SessionTracker['getActiveSessions']>;
  } {
    return {
      running: this.started,
      sessions: this.tracker.getActiveSessions(),
    };
  }
}
