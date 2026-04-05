import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { ChatSummary, UnifiedTranscript } from '../types/index.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';

export type LLMProvider = 'openai' | 'anthropic';

export interface LLMClientOptions {
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asStringRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parse and lightly validate LLM JSON into ChatSummary; fill safe defaults for missing pieces. */
export function parseChatSummaryJson(raw: unknown): ChatSummary {
  if (!isRecord(raw)) {
    throw new Error('Summary JSON must be an object');
  }

  const title = typeof raw.title === 'string' ? raw.title : '';
  const topics = asStringArray(raw.topics);
  const tags = asStringArray(raw.tags);

  let contextProvided = {
    internalTools: [] as string[],
    internalDefinitions: [] as string[],
    externalResources: [] as string[],
  };
  if (isRecord(raw.contextProvided)) {
    contextProvided = {
      internalTools: asStringArray(raw.contextProvided.internalTools),
      internalDefinitions: asStringArray(raw.contextProvided.internalDefinitions),
      externalResources: asStringArray(raw.contextProvided.externalResources),
    };
  }

  const discussionProcess = asStringArray(raw.discussionProcess);
  const problemsDiscovered = asStringArray(raw.problemsDiscovered);
  const decidedSolutions = asStringArray(raw.decidedSolutions);

  const domainKnowledge: ChatSummary['domainKnowledge'] = {};
  if (isRecord(raw.domainKnowledge)) {
    const dk = raw.domainKnowledge;
    if (typeof dk.projectOverview === 'string') domainKnowledge.projectOverview = dk.projectOverview;
    if (typeof dk.targetUsers === 'string') domainKnowledge.targetUsers = dk.targetUsers;
    const uf = asStringArray(dk.userFlows);
    if (uf.length) domainKnowledge.userFlows = uf;
    const ts = asStringArray(dk.techStack);
    if (ts.length) domainKnowledge.techStack = ts;
    const kt = asStringRecord(dk.keyTerms);
    if (kt) domainKnowledge.keyTerms = kt;
  }

  const actionItemsRaw = raw.actionItems;
  const actionItems =
    actionItemsRaw === undefined
      ? undefined
      : asStringArray(actionItemsRaw).length
        ? asStringArray(actionItemsRaw)
        : undefined;

  const summary: ChatSummary = {
    title: title || 'Untitled session',
    topics,
    tags,
    contextProvided,
    discussionProcess,
    problemsDiscovered,
    decidedSolutions,
    domainKnowledge,
  };
  if (actionItems !== undefined && actionItems.length > 0) {
    summary.actionItems = actionItems;
  }
  return summary;
}

function extractOpenAIText(content: string | null | undefined): string {
  if (content === null || content === undefined) return '';
  return content;
}

function extractAnthropicText(
  content: Anthropic.Messages.Message['content'],
): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text' && 'text' in b)
    .map((b) => b.text)
    .join('');
}

export class LLMClient {
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly openai?: OpenAI;
  private readonly anthropic?: Anthropic;

  constructor(options: LLMClientOptions) {
    this.provider = options.provider;
    this.model = options.model;
    if (options.provider === 'openai') {
      this.openai = new OpenAI({ apiKey: options.apiKey });
    } else {
      this.anthropic = new Anthropic({ apiKey: options.apiKey });
    }
  }

  private async callOnce(transcript: UnifiedTranscript): Promise<ChatSummary> {
    const userPrompt = buildUserPrompt(transcript);

    if (this.provider === 'openai') {
      if (!this.openai) throw new Error('OpenAI client not initialized');
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${userPrompt}\n\nRespond with a single JSON object only, matching the ChatSummary schema.`,
          },
        ],
        response_format: { type: 'json_object' },
      });
      const text = extractOpenAIText(completion.choices[0]?.message?.content);
      if (!text.trim()) throw new Error('Empty OpenAI completion');
      const parsed: unknown = JSON.parse(text);
      return parseChatSummaryJson(parsed);
    }

    if (!this.anthropic) throw new Error('Anthropic client not initialized');
    const message = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: `${SYSTEM_PROMPT}\n\nRespond with a single JSON object only, matching the ChatSummary schema. No markdown.`,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = extractAnthropicText(message.content);
    if (!text.trim()) throw new Error('Empty Anthropic completion');
    const parsed: unknown = JSON.parse(text);
    return parseChatSummaryJson(parsed);
  }

  async generateSummary(transcript: UnifiedTranscript): Promise<ChatSummary> {
    try {
      return await this.callOnce(transcript);
    } catch (firstError) {
      await sleep(400);
      try {
        return await this.callOnce(transcript);
      } catch (secondError) {
        const msg =
          firstError instanceof Error ? firstError.message : String(firstError);
        const msg2 =
          secondError instanceof Error ? secondError.message : String(secondError);
        throw new Error(`LLM summary failed after retry: ${msg} | ${msg2}`);
      }
    }
  }
}
