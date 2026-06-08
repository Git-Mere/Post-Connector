// 어댑터 ↔ 코어 공유 계약. 어느 한쪽에도 종속되지 않도록 /src 루트에 둔다.

export type AdapterCategory = 'social' | 'blog' | 'portfolio' | 'job' | 'readme';
export type AuthType = 'oauth' | 'api-key' | 'manual';

export interface AdapterSchema {
  maxLength?: number;
  format?: 'plain' | 'markdown' | 'json';
  fields?: Record<string, { type: string; required?: boolean; maxLength?: number }>;
}

export interface ProjectData {
  repo: { owner: string; name: string; description: string | null; topics: string[]; stars: number; license: string | null; homepage: string | null };
  readme: string | null;
  languages: Record<string, number>;
  dependencies: Record<string, string>;
  commitStats: { firstCommit: string; lastCommit: string; totalCommits: number };
  releases: Array<{ tag: string; name: string; body: string; publishedAt: string }>;
  fileTree: string[];
  userInput: UserEnrichment;
}

export interface UserEnrichment {
  problemSolved?: string;
  impactMetrics?: string;
  role?: string;
  learnings?: string;
  nextSteps?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export type Auth =
  | { type: 'oauth'; token: string }
  | { type: 'api-key'; key: string }
  | { type: 'manual' };

export interface PublishResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface PlatformAdapter {
  id: string;
  name: string;
  category: AdapterCategory;
  authType: AuthType;
  schema: AdapterSchema;
  validate(content: string): ValidationResult;
  publish?(content: string, auth: Auth): Promise<PublishResult>;
}

// 레지스트리가 한 어댑터 폴더 전체를 묶어 반환하는 단위.
// .md 파일을 매번 다시 읽지 않도록 로드 시점에 함께 캐시한다.
export interface LoadedAdapter {
  adapter: PlatformAdapter;
  schema: AdapterSchema;
  instructions: string;
  promptBase: string;
}
