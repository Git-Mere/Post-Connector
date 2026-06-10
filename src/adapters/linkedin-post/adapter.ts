import type { PlatformAdapter, ValidationResult } from '../../types.js';

// LinkedIn 자동 발행 금지 (CLAUDE.md "금지 사항"): API 심사 + 약관 리스크.
// publish() 를 정의하지 않음 → UI 가 자동으로 "클립보드 복사" 모드로 렌더링.

const adapter: PlatformAdapter = {
  id: 'linkedin-post',
  name: 'LinkedIn Post',
  category: 'social',
  authType: 'manual',
  schema: {
    format: 'plain',
    maxLength: 3000,
  },

  validate(content: string): ValidationResult {
    if (content.trim().length === 0) {
      return { ok: false, errors: ['Generated post is empty'] };
    }
    if (content.length > 3000) {
      return { ok: false, errors: [`Post exceeds LinkedIn 3000 character limit (${content.length} chars)`] };
    }
    return { ok: true, errors: [] };
  },
};

export default adapter;
