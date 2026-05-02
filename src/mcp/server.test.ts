import { describe, expect, it } from 'vitest';
import { createRelayChatSessionId } from './server.js';

describe('relay chat session ids', () => {
  it('creates unique ids with a relay-chat prefix', () => {
    const first = createRelayChatSessionId();
    const second = createRelayChatSessionId();

    expect(first).toMatch(/^relay-chat-[0-9a-f-]{36}$/);
    expect(second).toMatch(/^relay-chat-[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});
