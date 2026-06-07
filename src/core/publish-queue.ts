import type { Auth, PlatformAdapter, PublishResult } from '../types.js';

// BullMQ 기반 비동기 발행. publish() 없는 어댑터는 큐에 넣지 않고 즉시 "복붙" 모드.
// 재시도 정책은 어댑터별 (PR 충돌, rate limit 등 차이 큼).

export interface PublishJob {
  adapter: PlatformAdapter;
  content: string;
  auth: Auth;
}

export async function enqueuePublish(_job: PublishJob): Promise<PublishResult> {
  throw new Error('enqueuePublish: not implemented');
}
