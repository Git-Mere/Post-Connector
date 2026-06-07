import Anthropic from '@anthropic-ai/sdk';
import type { PlatformAdapter, ProjectData } from '../types.js';

// 모델: CLAUDE.md "Sonnet 우선" → claude-sonnet-4-6 기본값.
// 콘텐츠 생성 워크로드는 thinking 비활성 + effort low 가 적합 (Anthropic 공식 가이드).
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 8192;

export interface GenerateOptions {
  adapter: PlatformAdapter;
  data: ProjectData;
  globalInstructions: string;
  adapterInstructions: string;
  promptBase: string;
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

// 프롬프트 조립 순서 (CLAUDE.md "프롬프트 조립 순서"):
//   1. [System]      prompt-base.md                       ┐
//   2. [Constraints] schema.json                          ┘ → system 필드 (캐시 적용)
//   3. [Global]      global-instructions.md               ┐
//   4. [Adapter]     instructions.md (가장 우선, 후반부)  ├ → user 필드
//   5. [Data]        ProjectData (JSON, 가장 마지막)      ┘

function buildSystem(opts: GenerateOptions): string {
  const schemaBlock = JSON.stringify(opts.adapter.schema, null, 2);
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
  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    // system 은 동일 어댑터 호출 간 변하지 않음 → ephemeral cache.
    // 현재 프롬프트 크기는 Sonnet 4.6 최소 캐시(2048 토큰) 미달이라 활성화 안 될 수 있으나
    // 어댑터 prompt-base / schema 가 커지면 자동으로 적용된다.
    system: [
      { type: 'text', text: buildSystem(opts), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildUserMessage(opts) }],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
