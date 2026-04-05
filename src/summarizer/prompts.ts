import type { UnifiedTranscript } from '../types/index.js';

const ASSISTANT_TRUNCATE_LEN = 500;

export const SYSTEM_PROMPT = `You are a knowledge extraction assistant. Given a chat transcript between a user and an AI assistant, extract structured information and output a single JSON object.

Output MUST be valid JSON matching the ChatSummary schema described below. Do not include markdown fences, comments, or any text outside the JSON object.

Field instructions:
- title: A concise, descriptive title for the conversation (one line, in the same primary language as the transcript).
- topics: 3–8 short bullet themes (phrases) capturing what was discussed.
- tags: Reusable topic labels. Each tag MUST be exactly 2–4 Chinese characters (汉字), suitable as labels you could apply across many sessions (e.g. 前端, 调试, 重构). No English or punctuation-only tags.
- contextProvided.internalTools: Names or descriptions of internal tools, CLIs, scripts, or MCP tools the user or assistant relied on.
- contextProvided.internalDefinitions: Important definitions, conventions, or in-repo concepts that were stated or assumed.
- contextProvided.externalResources: URLs, docs, libraries, or third-party services mentioned.
- discussionProcess: Ordered short steps summarizing how the conversation unfolded (user goal → exploration → resolution).
- problemsDiscovered: Explicit problems, errors, blockers, or gaps identified during the chat.
- decidedSolutions: Decisions, fixes, or approaches that were chosen or agreed upon.
- domainKnowledge.projectOverview: Optional one-paragraph project context if inferable from the chat.
- domainKnowledge.targetUsers: Optional who the product or feature is for.
- domainKnowledge.userFlows: Optional list of user flows or scenarios discussed.
- domainKnowledge.techStack: Optional technologies, frameworks, or languages mentioned.
- domainKnowledge.keyTerms: Optional map of term → short definition for jargon established in the chat.
- actionItems: Optional list of follow-ups, todos, or next steps (empty array if none).

Be faithful to the transcript; do not invent tools, URLs, or decisions that are not supported by the text. Use empty arrays or omit optional fields when unknown.`;

export const SUMMARY_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'topics',
    'tags',
    'contextProvided',
    'discussionProcess',
    'problemsDiscovered',
    'decidedSolutions',
    'domainKnowledge',
  ],
  properties: {
    title: { type: 'string' },
    topics: {
      type: 'array',
      items: { type: 'string' },
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
    },
    contextProvided: {
      type: 'object',
      additionalProperties: false,
      required: ['internalTools', 'internalDefinitions', 'externalResources'],
      properties: {
        internalTools: { type: 'array', items: { type: 'string' } },
        internalDefinitions: { type: 'array', items: { type: 'string' } },
        externalResources: { type: 'array', items: { type: 'string' } },
      },
    },
    discussionProcess: {
      type: 'array',
      items: { type: 'string' },
    },
    problemsDiscovered: {
      type: 'array',
      items: { type: 'string' },
    },
    decidedSolutions: {
      type: 'array',
      items: { type: 'string' },
    },
    domainKnowledge: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectOverview: { type: 'string' },
        targetUsers: { type: 'string' },
        userFlows: { type: 'array', items: { type: 'string' } },
        techStack: { type: 'array', items: { type: 'string' } },
        keyTerms: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
    },
    actionItems: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const;

function truncateAssistantContent(content: string): string {
  if (content.length <= ASSISTANT_TRUNCATE_LEN) return content;
  return `${content.slice(0, ASSISTANT_TRUNCATE_LEN)}… [truncated, ${content.length - ASSISTANT_TRUNCATE_LEN} chars omitted]`;
}

function formatMessageBlock(
  index: number,
  role: string,
  content: string,
  toolCalls?: { name: string; input: string; output?: string }[],
): string {
  const lines: string[] = [`[${index + 1}] ${role.toUpperCase()}:`];
  lines.push(role === 'assistant' ? truncateAssistantContent(content) : content);
  if (toolCalls?.length) {
    lines.push('  Tool calls:');
    for (const tc of toolCalls) {
      lines.push(`    - ${tc.name}: ${tc.input}`);
      if (tc.output !== undefined) lines.push(`      → ${tc.output}`);
    }
  }
  return lines.join('\n');
}

function formatToolsUsed(tools: UnifiedTranscript['toolsUsed']): string {
  if (!tools.length) return '(none)';
  return tools
    .map((t) => `- ${t.name}: ${t.input}${t.output !== undefined ? ` → ${t.output}` : ''}`)
    .join('\n');
}

function formatFiles(files: string[]): string {
  if (!files.length) return '(none)';
  return files.map((f) => `- ${f}`).join('\n');
}

/** Format transcript into a readable user message for the summarization model. */
export function buildUserPrompt(transcript: UnifiedTranscript): string {
  const header = [
    '## Transcript',
    `Platform: ${transcript.platform}`,
    transcript.project !== undefined ? `Project: ${transcript.project}` : null,
    `Session id: ${transcript.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  const messagesSection = transcript.messages
    .map((m, i) => formatMessageBlock(i, m.role, m.content, m.toolCalls))
    .join('\n\n');

  return `${header}

## Messages

${messagesSection}

## Tools used (aggregated)

${formatToolsUsed(transcript.toolsUsed)}

## Files referenced

${formatFiles(transcript.filesReferenced)}
`;
}
