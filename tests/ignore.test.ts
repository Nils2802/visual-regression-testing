import { describe, it, expect } from 'vitest';
import { applyIgnoreRules, functionalStatus } from '@/lib/ignore';
import type { CollectedEntry } from '@/lib/collector';

function entry(overrides: Partial<CollectedEntry>): CollectedEntry {
  return { type: 'console-error', message: 'boom', timestamp: new Date(), ...overrides };
}

describe('applyIgnoreRules', () => {
  it('ignores by message pattern', () => {
    const judged = applyIgnoreRules(
      [entry({ message: 'analytics blocked' }), entry({ message: 'real error' })],
      [{ id: 'r1', messagePattern: 'analytics' }]
    );
    expect(judged[0].ignored).toBe(true);
    expect(judged[0].ignoreRuleId).toBe('r1');
    expect(judged[1].ignored).toBe(false);
  });

  it('ignores by url pattern and entry type combined', () => {
    const judged = applyIgnoreRules(
      [
        entry({ type: 'http-error', url: 'https://tracker.example/ping' }),
        entry({ type: 'network-error', url: 'https://tracker.example/ping' }),
      ],
      [{ id: 'r2', entryType: 'http-error', urlPattern: 'tracker\\.example' }]
    );
    expect(judged[0].ignored).toBe(true);
    expect(judged[1].ignored).toBe(false); // type does not match
  });

  it('rule with no criteria matches nothing', () => {
    const judged = applyIgnoreRules([entry({})], [{ id: 'r3' }]);
    expect(judged[0].ignored).toBe(false);
  });

  it('invalid regex in a rule is skipped, not thrown', () => {
    const judged = applyIgnoreRules([entry({})], [{ id: 'r4', messagePattern: '(' }]);
    expect(judged[0].ignored).toBe(false);
  });
});

describe('functionalStatus', () => {
  it('fails on any non-ignored entry', () => {
    const judged = applyIgnoreRules([entry({})], []);
    expect(functionalStatus(judged)).toBe('fail');
  });

  it('passes when all entries are ignored', () => {
    const judged = applyIgnoreRules([entry({ message: 'noise' })], [{ id: 'r', messagePattern: 'noise' }]);
    expect(functionalStatus(judged)).toBe('pass');
  });

  it('passes with no entries', () => {
    expect(functionalStatus([])).toBe('pass');
  });
});
