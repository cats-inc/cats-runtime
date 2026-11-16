import { describe, expect, it } from 'vitest';
import { mcpSendMessageBody } from './tools.js';

describe('MCP send_message body (ADR-055)', () => {
  it('never lets an MCP client mark a send as owner-started', () => {
    expect(mcpSendMessageBody({ sessionId: 's', message: 'hi', standingGrants: true, instructions: 'x' }))
      .toEqual({ message: 'hi', instructions: 'x' });
  });
});
