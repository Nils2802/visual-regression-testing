'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiClientError, type IgnoreRule, type LogEntry } from '@/lib/client';
import { LOG_TYPES } from '@/lib/collector';

type IgnoreFn = (logEntryId: string, reason: string) => Promise<{ rule: IgnoreRule; entry: LogEntry }>;

function LogRow({ entry, ignoreFn, onIgnored }: { entry: LogEntry; ignoreFn?: IgnoreFn; onIgnored: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReference = entry.origin === 'reference';

  function cancelIgnore() {
    setIgnoring(false);
    setReason('');
    setError(null);
  }

  function confirmIgnore() {
    const trimmedReason = reason.trim();
    if (!ignoreFn || trimmedReason.length === 0) return;
    setSubmitting(true);
    setError(null);
    ignoreFn(entry.id, trimmedReason)
      .then(() => {
        setIgnoring(false);
        setReason('');
        onIgnored();
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'failed to ignore'))
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className={`min-w-0 flex-1 text-left ${expanded ? '' : 'line-clamp-1'}`}
        >
          {entry.message}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {isReference && <span className="text-xs text-muted">reference</span>}
          {entry.httpStatus !== null && <span className="font-mono text-xs text-muted">{entry.httpStatus}</span>}
          {!isReference && !ignoring && (
            <Button type="button" variant="ghost" size="xs" onClick={() => setIgnoring(true)}>
              ignore
            </Button>
          )}
        </div>
      </div>

      {entry.url && <p className="truncate font-mono text-xs text-muted">{entry.url}</p>}

      {ignoring && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Input
            className="h-7 w-auto flex-1 text-xs"
            placeholder="reason"
            aria-label="Ignore reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="button" size="xs" disabled={reason.trim().length === 0 || submitting} onClick={confirmIgnore}>
            confirm
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={cancelIgnore}>
            cancel
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-status-fail">{error}</p>}
    </div>
  );
}

function IgnoredRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted opacity-60">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 line-clamp-1">{entry.message}</p>
        <div className="flex shrink-0 items-center gap-2">
          {entry.origin === 'reference' && <span className="text-xs">reference</span>}
          {entry.httpStatus !== null && <span className="font-mono text-xs">{entry.httpStatus}</span>}
        </div>
      </div>
      {entry.url && <p className="truncate font-mono text-xs">{entry.url}</p>}
    </div>
  );
}

function LogGroup({
  type,
  entries,
  ignoreFn,
  onIgnored,
}: {
  type: string;
  entries: LogEntry[];
  ignoreFn?: IgnoreFn;
  onIgnored: () => void;
}) {
  const [showIgnored, setShowIgnored] = useState(false);

  const visible = entries.filter((e) => !e.ignored);
  const ignored = entries.filter((e) => e.ignored);

  return (
    <div data-testid={`log-group-${type}`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{type}</h3>
        <span className="font-mono text-xs text-muted">{entries.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {visible.map((e) => (
          <LogRow key={e.id} entry={e} ignoreFn={ignoreFn} onIgnored={onIgnored} />
        ))}
      </div>

      {ignored.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowIgnored((s) => !s)}
            className="self-start font-mono text-xs text-muted underline"
          >
            {ignored.length} ignored
          </button>
          {showIgnored && (
            <div className="flex flex-col gap-2">
              {ignored.map((e) => (
                <IgnoredRow key={e.id} entry={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LogPanel({
  entries,
  ignoreFn = api.ignoreRules.fromLogEntry,
  onIgnored,
}: {
  entries: LogEntry[];
  ignoreFn?: IgnoreFn;
  onIgnored: () => void;
}) {
  const groups = LOG_TYPES.map((type) => ({ type, entries: entries.filter((e) => e.type === type) })).filter(
    (g) => g.entries.length > 0
  );

  if (groups.length === 0) {
    return <p className="text-sm text-muted">No log entries.</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-2 p-4">
      {groups.map((g) => (
        <LogGroup key={g.type} type={g.type} entries={g.entries} ignoreFn={ignoreFn} onIgnored={onIgnored} />
      ))}
    </div>
  );
}
