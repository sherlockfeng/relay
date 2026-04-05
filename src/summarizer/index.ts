import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { parseTranscript } from '../parsers/index.js';
import { getDatabase } from '../storage/database.js';
import type { ChatSummary, Platform, UnifiedMessage, UnifiedTranscript } from '../types/index.js';
import { LLMClient } from './llm-client.js';
import { enhanceTags } from './tagger.js';

const LONG_TRANSCRIPT_THRESHOLD = 100;
const HEAD_TAIL_COUNT = 20;

function truncateMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  if (messages.length <= LONG_TRANSCRIPT_THRESHOLD) return messages;

  const omitted = messages.length - HEAD_TAIL_COUNT * 2;
  const head = messages.slice(0, HEAD_TAIL_COUNT);
  const tail = messages.slice(-HEAD_TAIL_COUNT);
  const marker: UnifiedMessage = {
    role: 'system',
    content: `... ${omitted} messages omitted ...`,
  };
  return [...head, marker, ...tail];
}

function withTruncatedMessages(transcript: UnifiedTranscript): UnifiedTranscript {
  return {
    ...transcript,
    messages: truncateMessages(transcript.messages),
  };
}

export { SYSTEM_PROMPT, buildUserPrompt, SUMMARY_JSON_SCHEMA } from './prompts.js';
export { LLMClient, parseChatSummaryJson } from './llm-client.js';
export type { LLMClientOptions, LLMProvider } from './llm-client.js';
export { enhanceTags } from './tagger.js';

export interface SummarizeSessionParams {
  transcriptPath: string;
  platform: Platform;
  config: AppConfig;
}

export async function summarizeSession(params: SummarizeSessionParams): Promise<ChatSummary | null> {
  const { transcriptPath, platform, config } = params;
  if (!config.llm.apiKey) {
    console.warn('[ai-chat-digest] No LLM API key configured, skipping summarization');
    return null;
  }

  const transcript = await parseTranscript(transcriptPath, platform);
  if (transcript.messages.length === 0) {
    return null;
  }

  const client = new LLMClient({
    provider: config.llm.provider as 'openai' | 'anthropic',
    model: config.llm.model,
    apiKey: config.llm.apiKey,
  });
  const generator = new SummaryGenerator(client);
  const summary = await generator.summarize(transcript);

  const db = getDatabase();
  db.insertSummary({
    id: randomUUID(),
    sessionId: transcript.id,
    title: summary.title,
    topics: summary.topics,
    tags: summary.tags,
    contextProvided: summary.contextProvided,
    discussionProcess: summary.discussionProcess,
    problemsDiscovered: summary.problemsDiscovered,
    decidedSolutions: summary.decidedSolutions,
    domainKnowledge: summary.domainKnowledge,
    actionItems: summary.actionItems,
    rawSummary: JSON.stringify(summary),
    createdAt: new Date().toISOString(),
    modelUsed: config.llm.model,
  });
  db.addSessionTags(transcript.id, summary.tags);
  db.markSummarized(transcript.id);

  return summary;
}

/** Orchestrates summarization: optional transcript truncation, LLM call, rule-based tags. */
export class SummaryGenerator {
  constructor(private readonly llmClient: LLMClient) {}

  async summarize(transcript: UnifiedTranscript): Promise<ChatSummary> {
    const forModel = withTruncatedMessages(transcript);
    const summary = await this.llmClient.generateSummary(forModel);
    return {
      ...summary,
      tags: enhanceTags(summary.tags, transcript),
    };
  }
}
