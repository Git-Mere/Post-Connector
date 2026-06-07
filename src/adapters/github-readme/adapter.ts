import type { PlatformAdapter, ProjectData, ValidationResult, Auth, PublishResult } from '../../types.js';

const adapter: PlatformAdapter = {
  id: 'github-readme',
  name: 'GitHub README',
  category: 'readme',
  authType: 'oauth',
  schema: {
    format: 'markdown',
  },

  generatePrompt(_data: ProjectData, _userInstructions: string): string {
    throw new Error('github-readme.generatePrompt: not implemented');
  },

  validate(_content: string): ValidationResult {
    throw new Error('github-readme.validate: not implemented');
  },

  // 기존 README 덮어쓰지 말고 PR 또는 새 브랜치로 생성한다 (CLAUDE.md 참고).
  async publish(_content: string, _auth: Auth): Promise<PublishResult> {
    throw new Error('github-readme.publish: not implemented');
  },
};

export default adapter;
