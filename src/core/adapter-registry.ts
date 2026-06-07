import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { AdapterSchema, LoadedAdapter, PlatformAdapter } from '../types.js';

// 어댑터 디렉터리는 adapter-registry.js 의 형제 (../adapters).
// 개발(tsx, src/) 과 프로덕션(node, dist/) 모두 동일한 상대 위치이므로 import.meta.url 기준으로 해결.
const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = join(HERE, '..', 'adapters');

// AdapterSchema 의 코어 필드만 검증하고 어댑터별 자유 필드는 그대로 통과시킨다.
// (예: github-readme 의 `sections`, linkedin-post 의 `hashtags`, `hook`)
const adapterSchemaValidator = z.looseObject({
  maxLength: z.number().int().positive().optional(),
  format: z.enum(['plain', 'markdown', 'json']).optional(),
  fields: z
    .record(
      z.string(),
      z.object({
        type: z.string(),
        required: z.boolean().optional(),
        maxLength: z.number().int().positive().optional(),
      }),
    )
    .optional(),
});

let registry: Map<string, LoadedAdapter> | null = null;

async function loadOne(dir: string, expectedId: string): Promise<LoadedAdapter> {
  // NodeNext + ESM 에서 동적 import 는 .js 확장자를 기대. 개발 시 tsx 로더가 .ts 로 매핑.
  const moduleUrl = pathToFileURL(join(dir, 'adapter.js')).href;
  const mod: { default?: PlatformAdapter } = await import(moduleUrl);
  const adapter = mod.default;
  if (!adapter) {
    throw new Error(`Adapter at ${dir} has no default export`);
  }
  if (adapter.id !== expectedId) {
    throw new Error(`Adapter id mismatch at ${dir}: folder=${expectedId} id=${adapter.id}`);
  }

  const [schemaText, instructions, promptBase] = await Promise.all([
    readFile(join(dir, 'schema.json'), 'utf8'),
    readFile(join(dir, 'instructions.md'), 'utf8'),
    readFile(join(dir, 'prompt-base.md'), 'utf8'),
  ]);

  const schemaRaw: unknown = JSON.parse(schemaText);
  const schema = adapterSchemaValidator.parse(schemaRaw) as AdapterSchema;

  return { adapter, schema, instructions, promptBase };
}

export async function loadAdapters(): Promise<LoadedAdapter[]> {
  if (registry) return [...registry.values()];

  const entries = await readdir(ADAPTERS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());

  const loaded = await Promise.all(
    dirs.map((d) => loadOne(join(ADAPTERS_DIR, d.name), d.name)),
  );

  const next = new Map<string, LoadedAdapter>();
  for (const item of loaded) {
    if (next.has(item.adapter.id)) {
      throw new Error(`Duplicate adapter id: ${item.adapter.id}`);
    }
    next.set(item.adapter.id, item);
  }
  registry = next;
  return loaded;
}

export async function getAdapter(id: string): Promise<LoadedAdapter | null> {
  if (!registry) await loadAdapters();
  return registry?.get(id) ?? null;
}

export async function getGlobalInstructions(): Promise<string> {
  return readFile(join(ADAPTERS_DIR, 'global-instructions.md'), 'utf8');
}
