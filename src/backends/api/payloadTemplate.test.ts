import { describe, expect, it } from 'vitest';
import {
  applyPayloadTemplate,
  mergeRuntimePayloadPatch,
  readPayloadTemplateString,
} from './payloadTemplate.js';

describe('payloadTemplate helpers', () => {
  it('returns the runtime payload unchanged when the template is empty', () => {
    const runtimeBody = {
      model: 'gpt-5',
      generationConfig: {
        maxOutputTokens: 4096,
      },
    };

    expect(applyPayloadTemplate(runtimeBody)).toEqual(runtimeBody);
    expect(applyPayloadTemplate(runtimeBody, {})).toEqual(runtimeBody);
  });

  it('deep-merges objects while letting runtime-owned fields win', () => {
    const merged = applyPayloadTemplate(
      {
        model: 'gpt-5',
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.2,
        },
        metadata: {
          runtime: {
            turnStep: 1,
          },
        },
      },
      {
        generationConfig: {
          maxOutputTokens: 1024,
          topP: 0.95,
        },
        metadata: {
          runtime: {
            source: 'template',
          },
          templateOnly: true,
        },
      },
    );

    expect(merged).toEqual({
      model: 'gpt-5',
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.2,
        topP: 0.95,
      },
      metadata: {
        runtime: {
          turnStep: 1,
          source: 'template',
        },
        templateOnly: true,
      },
    });
  });

  it('replaces arrays instead of concatenating them', () => {
    const merged = applyPayloadTemplate(
      {
        stopSequences: ['FINAL'],
      },
      {
        stopSequences: ['DRAFT'],
      },
    );

    expect(merged.stopSequences).toEqual(['FINAL']);
  });

  it('applies runtime request patches on top of the request body without inverting template semantics', () => {
    const merged = mergeRuntimePayloadPatch(
      {
        model: 'gpt-5.4',
        reasoning: {
          effort: 'medium',
          summary: 'auto',
        },
      },
      {
        reasoning: {
          effort: 'high',
        },
      },
    );

    expect(merged).toEqual({
      model: 'gpt-5.4',
      reasoning: {
        effort: 'high',
        summary: 'auto',
      },
    });
  });

  it('reads the first non-empty string value from the requested keys', () => {
    const template = {
      cachedContentTtl: ' ',
      cached_content_ttl: '1800s',
      contextCacheTtl: '900s',
    };

    expect(
      readPayloadTemplateString(
        template,
        'cachedContentTtl',
        'cached_content_ttl',
        'contextCacheTtl',
      ),
    ).toBe('1800s');
  });
});
