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

  validate(_content: string): ValidationResult {
    throw new Error('linkedin-post.validate: not implemented');
  },
};

export default adapter;
