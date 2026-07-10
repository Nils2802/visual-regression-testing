import type { CollectedEntry } from './collector';

export interface IgnoreRuleInput {
  id: string;
  entryType?: string | null;
  urlPattern?: string | null;
  messagePattern?: string | null;
}

export type JudgedEntry = CollectedEntry & { ignored: boolean; ignoreRuleId?: string };

function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function matches(entry: CollectedEntry, rule: IgnoreRuleInput): boolean {
  if (!rule.entryType && !rule.urlPattern && !rule.messagePattern) return false;
  if (rule.entryType && rule.entryType !== entry.type) return false;
  if (rule.urlPattern && !(entry.url && safeTest(rule.urlPattern, entry.url))) return false;
  if (rule.messagePattern && !safeTest(rule.messagePattern, entry.message)) return false;
  return true;
}

export function applyIgnoreRules(entries: CollectedEntry[], rules: IgnoreRuleInput[]): JudgedEntry[] {
  return entries.map((entry) => {
    const rule = rules.find((r) => matches(entry, r));
    return { ...entry, ignored: Boolean(rule), ignoreRuleId: rule?.id };
  });
}

export function functionalStatus(entries: JudgedEntry[]): 'pass' | 'fail' {
  return entries.some((e) => !e.ignored) ? 'fail' : 'pass';
}
