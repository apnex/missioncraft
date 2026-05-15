import { describe, it, expect } from 'vitest';
import { VERSION } from '@apnex/missioncraft';

describe('SDK exports (W0 scaffold smoke-test)', () => {
  it('exports VERSION matching package.json', () => {
    expect(VERSION).toBe('1.2.3');
  });
});
