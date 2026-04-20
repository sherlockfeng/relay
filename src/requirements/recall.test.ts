import { describe, it, expect } from 'vitest';
import { formatRequirementForInjection } from './recall.js';
import type { Requirement } from '../storage/database.js';

function makeReq(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'r1',
    name: '登录页重设计',
    purpose: '提升用户转化率',
    context: '这周重构了登录页',
    summary: '**目的**：提升转化率\n\n**改动**：重写组件',
    relatedDocs: ['docs/design.md', 'Figma链接'],
    changes: ['重写 LoginForm 组件', '新增 OAuth 登录'],
    tags: ['体验优化', '认证'],
    status: 'confirmed',
    createdAt: '2025-03-15T10:00:00.000Z',
    updatedAt: '2025-03-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('formatRequirementForInjection', () => {
  it('includes the requirement name in a h1 heading', () => {
    const out = formatRequirementForInjection(makeReq());
    expect(out).toContain('# 需求：登录页重设计');
  });

  it('shows confirmed status as 已确认', () => {
    expect(formatRequirementForInjection(makeReq({ status: 'confirmed' }))).toContain('已确认');
  });

  it('shows draft status as 草稿', () => {
    expect(formatRequirementForInjection(makeReq({ status: 'draft' }))).toContain('草稿');
  });

  it('formats creation date as YYYY-MM-DD', () => {
    expect(formatRequirementForInjection(makeReq())).toContain('2025-03-15');
  });

  it('includes purpose section when present', () => {
    const out = formatRequirementForInjection(makeReq());
    expect(out).toContain('## 目的');
    expect(out).toContain('提升用户转化率');
  });

  it('omits purpose section when absent', () => {
    const out = formatRequirementForInjection(makeReq({ purpose: undefined }));
    expect(out).not.toContain('## 目的');
  });

  it('includes summary section when present', () => {
    const out = formatRequirementForInjection(makeReq());
    expect(out).toContain('## 摘要');
    expect(out).toContain('**目的**：提升转化率');
  });

  it('omits summary section when absent', () => {
    const out = formatRequirementForInjection(makeReq({ summary: undefined }));
    expect(out).not.toContain('## 摘要');
  });

  it('formats changes as bulleted list', () => {
    const out = formatRequirementForInjection(makeReq());
    expect(out).toContain('## 主要改动');
    expect(out).toContain('- 重写 LoginForm 组件');
    expect(out).toContain('- 新增 OAuth 登录');
  });

  it('omits changes section when empty', () => {
    const out = formatRequirementForInjection(makeReq({ changes: [] }));
    expect(out).not.toContain('## 主要改动');
  });

  it('formats relatedDocs as bulleted list', () => {
    const out = formatRequirementForInjection(makeReq());
    expect(out).toContain('## 相关文档');
    expect(out).toContain('- docs/design.md');
  });

  it('omits relatedDocs section when empty', () => {
    const out = formatRequirementForInjection(makeReq({ relatedDocs: [] }));
    expect(out).not.toContain('## 相关文档');
  });

  it('formats tags as backtick-wrapped inline code', () => {
    const out = formatRequirementForInjection(makeReq());
    expect(out).toContain('`体验优化`');
    expect(out).toContain('`认证`');
  });

  it('omits tags section when empty', () => {
    const out = formatRequirementForInjection(makeReq({ tags: [] }));
    expect(out).not.toContain('## 标签');
  });

  it('includes context section', () => {
    const out = formatRequirementForInjection(makeReq());
    expect(out).toContain('## 原始 Chat 上下文');
    expect(out).toContain('这周重构了登录页');
  });

  it('truncates context longer than 800 chars', () => {
    const longCtx = 'x'.repeat(900);
    const out = formatRequirementForInjection(makeReq({ context: longCtx }));
    expect(out).toContain('…（已截断）');
    // Should contain first 800 chars but not the full 900
    expect(out).toContain('x'.repeat(800));
    expect(out).not.toContain('x'.repeat(801));
  });

  it('does not truncate context exactly 800 chars long', () => {
    const ctx = 'y'.repeat(800);
    const out = formatRequirementForInjection(makeReq({ context: ctx }));
    expect(out).not.toContain('…（已截断）');
  });

  it('handles requirement with no optional fields', () => {
    const minimal: Requirement = {
      id: 'r1', name: 'minimal', context: 'ctx',
      status: 'draft', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const out = formatRequirementForInjection(minimal);
    expect(out).toContain('# 需求：minimal');
    expect(out).toContain('草稿');
    // No optional sections
    expect(out).not.toContain('## 目的');
    expect(out).not.toContain('## 摘要');
    expect(out).not.toContain('## 主要改动');
  });
});
