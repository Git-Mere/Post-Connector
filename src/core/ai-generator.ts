import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ProjectData } from '../types.js';
import type { AdapterSchema } from '../types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface GenerateOptions {
  promptBase: string;
  schema: AdapterSchema;
  globalInstructions: string;
  adapterInstructions: string;
  data: ProjectData;
}

// Prompt assembly order (CLAUDE.md):
//   1. [System]      prompt-base.md       ┐
//   2. [Constraints] schema.json          ┘ → systemPrompt
//   3. [Global]      global-instructions.md   ┐
//   4. [Adapter]     instructions.md          ├ → prompt (user turn)
//   5. [Data]        ProjectData              ┘

function buildSystem(opts: GenerateOptions): string {
  const schemaBlock = JSON.stringify(opts.schema, null, 2);
  return [
    opts.promptBase.trim(),
    '',
    '## Output constraints (schema.json)',
    schemaBlock,
  ].join('\n');
}

function buildUserMessage(opts: GenerateOptions): string {
  return [
    '## Global instructions',
    opts.globalInstructions.trim(),
    '',
    '## Adapter-specific instructions',
    opts.adapterInstructions.trim(),
    '',
    '## Project data',
    '<project_data>',
    JSON.stringify(opts.data, null, 2),
    '</project_data>',
  ].join('\n');
}

export async function generateContent(opts: GenerateOptions): Promise<string> {
  const model = process.env['ANTHROPIC_MODEL'] ?? DEFAULT_MODEL;
  const systemText = buildSystem(opts);
  const userPrompt = buildUserMessage(opts);

  for await (const message of query({
    prompt: userPrompt,
    options: {
      model,
      systemPrompt: systemText,
      maxTurns: 1,
      allowedTools: [],
      settingSources: [],
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') {
      return message.result;
    }
    if (message.type === 'result' && message.is_error) {
      throw new Error(`Generation failed: ${message.subtype}`);
    }
  }

  throw new Error('generateContent: stream ended without a result message');
}
