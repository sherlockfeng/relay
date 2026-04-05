import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import type { ChatDigestDB } from '../storage/database.js';
import { getDatabase } from '../storage/database.js';
import { findSimilar, searchSummaries } from '../storage/search.js';
import type { StoredSummary } from '../types/index.js';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildSnippet(summary: StoredSummary, query: string, maxLen = 220): string {
  const raw = summary.rawSummary.replace(/\s+/g, ' ').trim();
  if (!raw) {
    return summary.topics.length ? summary.topics.join(' · ') : '(no text)';
  }
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const lower = raw.toLowerCase();
  for (const t of tokens) {
    const idx = lower.indexOf(t.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 70);
      const end = start + maxLen + 70;
      const slice = raw.slice(start, end);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < raw.length ? '…' : '';
      return `${prefix}${slice}${suffix}`;
    }
  }
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}…`;
}

function formatSearchResults(summaries: StoredSummary[], query: string): string {
  if (summaries.length === 0) {
    return 'No summaries matched your search.';
  }
  const blocks: string[] = [];
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    blocks.push(
      [
        `### ${i + 1}. ${s.title}`,
        `- **Session ID:** ${s.sessionId}`,
        `- **Created:** ${formatDate(s.createdAt)}`,
        `- **Tags:** ${s.tags.length ? s.tags.join(', ') : '(none)'}`,
        `- **Topics:** ${s.topics.length ? s.topics.join(', ') : '(none)'}`,
        `- **Snippet:** ${buildSnippet(s, query)}`,
        '',
      ].join('\n'),
    );
  }
  return blocks.join('\n');
}

function formatSummaryMeta(s: StoredSummary): string {
  return [
    `- **Session ID:** ${s.sessionId}`,
    `- **Created:** ${formatDate(s.createdAt)}`,
    `- **Model:** ${s.modelUsed || '(unknown)'}`,
    `- **Tags:** ${s.tags.length ? s.tags.join(', ') : '(none)'}`,
    `- **Topics:** ${s.topics.length ? s.topics.join(', ') : '(none)'}`,
    '',
  ].join('\n');
}

function formatSummarySections(s: StoredSummary): string {
  return [
    '**Context (tools)**',
    bulletList(s.contextProvided.internalTools),
    '',
    '**Context (definitions)**',
    bulletList(s.contextProvided.internalDefinitions),
    '',
    '**External resources**',
    bulletList(s.contextProvided.externalResources),
    '',
    '**Discussion**',
    bulletList(s.discussionProcess),
    '',
    '**Problems**',
    bulletList(s.problemsDiscovered),
    '',
    '**Solutions**',
    bulletList(s.decidedSolutions),
    '',
    '**Domain knowledge**',
    formatDomainKnowledge(s),
    '',
    s.actionItems?.length
      ? `**Action items**\n${bulletList(s.actionItems)}`
      : '**Action items**\n(none)',
    '',
    '**Raw summary**',
    s.rawSummary.trim() || '(empty)',
    '',
  ].join('\n');
}

function formatSummaryCard(s: StoredSummary, index?: number): string {
  const head =
    index !== undefined ? `### ${index + 1}. ${s.title}` : `## ${s.title}`;
  return [head, '', formatSummaryMeta(s), formatSummarySections(s)].join('\n');
}

function bulletList(items: string[]): string {
  if (!items.length) return '(none)';
  return items.map((x) => `- ${x}`).join('\n');
}

function formatDomainKnowledge(s: StoredSummary): string {
  const dk = s.domainKnowledge;
  const lines: string[] = [];
  if (dk.projectOverview) lines.push(`- **Project:** ${dk.projectOverview}`);
  if (dk.targetUsers) lines.push(`- **Users:** ${dk.targetUsers}`);
  if (dk.userFlows?.length) {
    lines.push('- **User flows:**');
    for (const f of dk.userFlows) lines.push(`  - ${f}`);
  }
  if (dk.techStack?.length) {
    lines.push(`- **Tech stack:** ${dk.techStack.join(', ')}`);
  }
  if (dk.keyTerms && Object.keys(dk.keyTerms).length) {
    lines.push('- **Key terms:**');
    for (const [k, v] of Object.entries(dk.keyTerms)) {
      lines.push(`  - **${k}:** ${v}`);
    }
  }
  return lines.length ? lines.join('\n') : '(none)';
}

function formatFullSummary(s: StoredSummary): string {
  return [
    `# Summary: ${s.title}`,
    '',
    `- **Summary ID:** ${s.id}`,
    formatSummaryMeta(s),
    formatSummarySections(s),
  ].join('\n');
}

function formatTagList(
  tags: { name: string; count: number }[],
): string {
  if (!tags.length) return 'No tags yet.';
  return tags
    .map((t) => `- **${t.name}** — ${t.count} session(s)`)
    .join('\n');
}

/**
 * Build an MCP server bound to an existing {@link ChatDigestDB} (for tests and custom paths).
 */
export function createMcpServer(db: ChatDigestDB): McpServer {
  const server = new McpServer({
    name: 'ai-chat-digest',
    version: '0.1.0',
  });

  server.registerTool(
    'search_summaries',
    {
      description:
        'Full-text search over historical chat summaries (FTS). Optional tag filters (AND).',
      inputSchema: {
        query: z.string().min(1).describe('Search query'),
        tags: z.array(z.string()).optional().describe('Require all of these tag names'),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Max results (default 10)'),
      },
    },
    async ({ query, tags, limit }) => {
      const lim = limit ?? 10;
      const results = searchSummaries(db, query, { tags, limit: lim });
      const text = formatSearchResults(results, query);
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'get_similar_chats',
    {
      description:
        'Find other summarized chats similar to a session (shared tags + text overlap).',
      inputSchema: {
        sessionId: z.string().min(1).describe('Source session id'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Max similar sessions (default 5)'),
      },
    },
    async ({ sessionId, limit }) => {
      const lim = limit ?? 5;
      const similar = findSimilar(db, sessionId, lim);
      if (!similar.length) {
        const src = db.getSummary(sessionId);
        const text = src
          ? 'No similar summarized sessions found for this chat.'
          : `No summary found for session **${sessionId}**.`;
        return { content: [{ type: 'text', text }] };
      }
      const parts = similar.map((s, i) => formatSummaryCard(s, i));
      const text = [`Similar to session **${sessionId}**:\n`, ...parts].join(
        '\n',
      );
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'get_tag_summaries',
    {
      description: 'List all summaries that have a given tag.',
      inputSchema: {
        tagName: z.string().min(1).describe('Tag name (case-insensitive)'),
      },
    },
    async ({ tagName }) => {
      const list = db.getTagSummaries(tagName);
      if (!list.length) {
        return {
          content: [
            {
              type: 'text',
              text: `No summaries found for tag **${tagName}**.`,
            },
          ],
        };
      }
      const parts = list.map((s, i) => formatSummaryCard(s, i));
      const text = [`Summaries tagged **${tagName}**:\n`, ...parts].join('\n');
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'get_summary',
    {
      description: 'Load the latest complete stored summary for a session.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Session id'),
      },
    },
    async ({ sessionId }) => {
      const summary = db.getSummary(sessionId);
      if (!summary) {
        return {
          content: [
            {
              type: 'text',
              text: `No summary found for session **${sessionId}**.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: formatFullSummary(summary) }],
      };
    },
  );

  server.registerTool(
    'list_tags',
    {
      description: 'List all tags with how many sessions use each.',
      inputSchema: {},
    },
    async () => {
      const tags = db.listTags();
      const rows = tags.map((t) => ({
        name: t.name,
        count: t.count ?? 0,
      }));
      const text = formatTagList(rows);
      return { content: [{ type: 'text', text }] };
    },
  );

  return server;
}

/**
 * Start the MCP server on stdio using the default database path (~/.ai-chat-digest/data.db).
 */
export async function startMcpServer(): Promise<void> {
  const db = getDatabase();
  const mcp = createMcpServer(db);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startMcpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
