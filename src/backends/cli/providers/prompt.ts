import { mergeRuntimeInstructionLayers } from '../../../core/skills/catalog.js';
import type { TurnInput } from './types.js';

export function compileRuntimeTurnInstructions(
  turn?: Pick<TurnInput, 'sessionInstructions' | 'instructions' | 'skills'>,
): string | undefined {
  return mergeRuntimeInstructionLayers(
    turn?.skills,
    turn?.sessionInstructions,
    turn?.instructions,
  );
}

export function compileRuntimeTurnPrompt(
  content: string,
  turn?: Pick<TurnInput, 'sessionInstructions' | 'instructions' | 'skills'>,
): string {
  const instructions = compileRuntimeTurnInstructions(turn);
  if (!instructions) {
    return content;
  }

  return [
    'Instructions:',
    instructions,
    '',
    'User message:',
    content,
  ].join('\n');
}
