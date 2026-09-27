import { describe, expect, it } from 'vitest';
import { appendStderrLines } from './stderrLines.js';

describe('appendStderrLines', () => {
  it('keeps short output unchanged apart from blank lines', () => {
    const lines: string[] = [];
    appendStderrLines(lines, 'first\r\n\n  second  \n');
    expect(lines).toEqual(['first', 'second']);
  });

  it('keeps the failure stated first when a long list follows it', () => {
    const lines: string[] = [];
    const models = Array.from({ length: 41 }, (_, index) => `- model-${index + 1}`);
    appendStderrLines(lines, [
      'Junie failed with the message: Invalid model: Gemini 3.7 Flash',
      'Available models:',
      ...models.slice(0, 20),
    ].join('\n'));
    appendStderrLines(lines, models.slice(20).join('\n'));

    expect(lines).toEqual([
      'Junie failed with the message: Invalid model: Gemini 3.7 Flash',
      'Available models:',
      '- model-1',
      '- model-2',
      '… 32 more lines …',
      ...models.slice(-7),
    ]);
  });

  it('keeps counting omitted lines across chunks', () => {
    const lines: string[] = [];
    for (let index = 1; index <= 13; index += 1) appendStderrLines(lines, `line ${index}`);
    expect(lines).toHaveLength(12);
    expect(lines[4]).toBe('… 2 more lines …');

    appendStderrLines(lines, 'line 14\nline 15');
    expect(lines).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      '… 4 more lines …',
      'line 9',
      'line 10',
      'line 11',
      'line 12',
      'line 13',
      'line 14',
      'line 15',
    ]);
  });
});
