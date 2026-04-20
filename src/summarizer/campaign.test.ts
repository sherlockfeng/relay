import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSummarizationPrompt, parseSummaryResponse, summarizeCampaign } from './campaign.js';
import type { CycleSummary } from './campaign.js';
import { AgentForgeDB } from '../storage/database.js';

// ── buildSummarizationPrompt ──────────────────────────────────────────────────

describe('buildSummarizationPrompt', () => {
  const cycles: CycleSummary[] = [
    {
      cycleNum: 1,
      productBrief: '用户反馈登录体验差',
      devWork: ['重写 LoginForm: 提取组件', '新增 OAuth: 接入 GitHub'],
      testResults: '2/2 test tasks passed',
      screenshots: [{ description: '[PASS] 登录成功' }],
    },
  ];

  it('includes campaign title', () => {
    const prompt = buildSummarizationPrompt('登录重设计', undefined, cycles);
    expect(prompt).toContain('登录重设计');
  });

  it('includes the brief when provided', () => {
    const prompt = buildSummarizationPrompt('Title', '解决转化率问题', cycles);
    expect(prompt).toContain('解决转化率问题');
  });

  it('uses fallback text when brief is undefined', () => {
    const prompt = buildSummarizationPrompt('Title', undefined, cycles);
    expect(prompt).toContain('(no brief provided)');
  });

  it('includes cycle number', () => {
    const prompt = buildSummarizationPrompt('T', undefined, cycles);
    expect(prompt).toContain('Cycle 1');
  });

  it('includes product brief in cycle section', () => {
    const prompt = buildSummarizationPrompt('T', undefined, cycles);
    expect(prompt).toContain('用户反馈登录体验差');
  });

  it('includes dev work as bulleted list', () => {
    const prompt = buildSummarizationPrompt('T', undefined, cycles);
    expect(prompt).toContain('- 重写 LoginForm: 提取组件');
    expect(prompt).toContain('- 新增 OAuth: 接入 GitHub');
  });

  it('includes test results', () => {
    const prompt = buildSummarizationPrompt('T', undefined, cycles);
    expect(prompt).toContain('2/2 test tasks passed');
  });

  it('includes screenshot descriptions', () => {
    const prompt = buildSummarizationPrompt('T', undefined, cycles);
    expect(prompt).toContain('[PASS] 登录成功');
  });

  it('omits product brief section when not present', () => {
    const cyclesNoBrief: CycleSummary[] = [{ cycleNum: 1, devWork: [], testResults: '0/0', screenshots: [] }];
    const prompt = buildSummarizationPrompt('T', undefined, cyclesNoBrief);
    expect(prompt).not.toContain('Product Analysis:');
  });

  it('omits screenshots section when empty', () => {
    const cyclesNoShots: CycleSummary[] = [{ cycleNum: 1, devWork: ['X'], testResults: '1/1', screenshots: [] }];
    const prompt = buildSummarizationPrompt('T', undefined, cyclesNoShots);
    expect(prompt).not.toContain('Screenshots:');
  });

  it('handles multiple cycles', () => {
    const multiCycles: CycleSummary[] = [
      { cycleNum: 1, devWork: ['A'], testResults: '1/1', screenshots: [] },
      { cycleNum: 2, devWork: ['B'], testResults: '1/1', screenshots: [] },
    ];
    const prompt = buildSummarizationPrompt('T', undefined, multiCycles);
    expect(prompt).toContain('Cycle 1');
    expect(prompt).toContain('Cycle 2');
  });

  it('includes required output section headers', () => {
    const prompt = buildSummarizationPrompt('T', undefined, cycles);
    expect(prompt).toContain('## Why');
    expect(prompt).toContain('## Key Decisions');
    expect(prompt).toContain('## What Was Built');
    expect(prompt).toContain('## Overall Path');
  });
});

// ── parseSummaryResponse ──────────────────────────────────────────────────────

describe('parseSummaryResponse', () => {
  const cycles: CycleSummary[] = [
    { cycleNum: 1, devWork: ['改了A'], testResults: '1/1', screenshots: [] },
  ];

  const fullResponse = `## Why
这个需求是为了提升用户转化率，登录体验一直被反馈较差。

## Key Decisions
- 选择 OAuth 而非密码登录
- 重新设计表单布局
- 延迟加载第三方 SDK

## What Was Built
Cycle 1 完成了登录组件重写和 OAuth 集成。

## Overall Path
从改善体验出发，逐步演进为完整的 OAuth 登录方案。`;

  it('extracts the why section', () => {
    const result = parseSummaryResponse(fullResponse, cycles);
    expect(result.why).toContain('提升用户转化率');
  });

  it('extracts key decisions as an array', () => {
    const result = parseSummaryResponse(fullResponse, cycles);
    expect(result.keyDecisions).toHaveLength(3);
    expect(result.keyDecisions[0]).toBe('选择 OAuth 而非密码登录');
  });

  it('extracts overall path section', () => {
    const result = parseSummaryResponse(fullResponse, cycles);
    expect(result.overallPath).toContain('OAuth 登录方案');
  });

  it('passes through cycle summaries unchanged', () => {
    const result = parseSummaryResponse(fullResponse, cycles);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycleNum).toBe(1);
  });

  it('falls back to raw slice when why section is missing', () => {
    const noWhy = '## Key Decisions\n- decision\n\n## Overall Path\npath';
    const result = parseSummaryResponse(noWhy, cycles);
    expect(result.why).toBeTruthy();
    expect(result.why.length).toBeLessThanOrEqual(500);
  });

  it('returns empty array for keyDecisions when section missing', () => {
    const noDecisions = '## Why\nsome why\n\n## Overall Path\npath';
    const result = parseSummaryResponse(noDecisions, cycles);
    expect(result.keyDecisions).toEqual([]);
  });

  it('returns empty string for overallPath when section missing', () => {
    const noPath = '## Why\nwhy text\n\n## Key Decisions\n- d1';
    const result = parseSummaryResponse(noPath, cycles);
    expect(result.overallPath).toBe('');
  });

  it('strips list markers from key decisions', () => {
    const withMarkers = '## Why\nw\n\n## Key Decisions\n* choice A\n1. choice B\n- choice C\n\n## Overall Path\np';
    const result = parseSummaryResponse(withMarkers, cycles);
    expect(result.keyDecisions).toContain('choice A');
    expect(result.keyDecisions).toContain('choice B');
    expect(result.keyDecisions).toContain('choice C');
  });

  it('filters empty lines from key decisions', () => {
    const withBlanks = '## Why\nw\n\n## Key Decisions\n- d1\n\n- d2\n\n## Overall Path\np';
    const result = parseSummaryResponse(withBlanks, cycles);
    expect(result.keyDecisions.every((d) => d.length > 0)).toBe(true);
  });
});

// ── summarizeCampaign (integration with mocked Anthropic) ─────────────────────

const mockCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: `## Why
提升登录体验，降低用户流失。

## Key Decisions
- 采用 OAuth 登录
- 重构 LoginForm 组件

## What Was Built
Cycle 1: 完成组件重写。

## Overall Path
从体验问题出发，完成完整重构。`,
    }],
  }),
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

function makeDB() {
  const db = new AgentForgeDB(':memory:');
  db.init();
  return db;
}

const testConfig = {
  llm: { provider: 'anthropic' as const, apiKey: 'test-key', model: 'claude-test' },
  spawner: { mode: 'sdk' as const, fallbackToCli: false },
  server: { port: 3000 },
  playwright: { browser: 'chromium' as const, screenshotDir: '/tmp' },
};

describe('summarizeCampaign', () => {
  let db: AgentForgeDB;

  beforeEach(() => {
    db = makeDB();
    // Seed a campaign with cycles and tasks
    db.insertCampaign({ id: 'camp1', projectPath: '/proj', title: '登录重设计', brief: '体验问题', status: 'active', startedAt: '2025-01-01' });
    db.insertCycle({ id: 'cy1', campaignId: 'camp1', cycleNum: 1, status: 'completed', productBrief: '优化登录' });
    db.insertTask({ id: 't1', cycleId: 'cy1', role: 'dev', title: '重写 LoginForm', status: 'completed', result: '完成重构', createdAt: '2025-01-01' });
    db.insertTask({ id: 't2', cycleId: 'cy1', role: 'test', title: '测试登录', status: 'completed', createdAt: '2025-01-01' });
  });

  it('throws if campaign does not exist', async () => {
    await expect(summarizeCampaign(db, 'nope', testConfig)).rejects.toThrow('Campaign not found: nope');
  });

  it('returns a summary with why, keyDecisions, cycles, overallPath', async () => {
    const summary = await summarizeCampaign(db, 'camp1', testConfig);
    expect(summary.why).toBeTruthy();
    expect(Array.isArray(summary.keyDecisions)).toBe(true);
    expect(summary.cycles).toHaveLength(1);
    expect(summary.overallPath).toBeTruthy();
  });

  it('marks campaign as completed in the DB', async () => {
    await summarizeCampaign(db, 'camp1', testConfig);
    expect(db.getCampaign('camp1')!.status).toBe('completed');
  });

  it('persists the summary JSON to the campaign', async () => {
    await summarizeCampaign(db, 'camp1', testConfig);
    const saved = db.getCampaign('camp1')!.summary;
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved!);
    expect(parsed).toHaveProperty('why');
  });

  it('includes dev task results in cycle data', async () => {
    const summary = await summarizeCampaign(db, 'camp1', testConfig);
    const cycle = summary.cycles[0];
    expect(cycle.devWork.some((w) => w.includes('重写 LoginForm'))).toBe(true);
  });

  it('calculates test pass rate correctly', async () => {
    db.insertTask({ id: 't3', cycleId: 'cy1', role: 'test', title: '边界测试', status: 'failed', createdAt: '2025-01-01' });
    const summary = await summarizeCampaign(db, 'camp1', testConfig);
    const testResults = summary.cycles[0].testResults;
    expect(testResults).toContain('1/2'); // 1 passed, 1 failed out of 2 test tasks
    expect(testResults).toContain('1 failed');
  });
});
