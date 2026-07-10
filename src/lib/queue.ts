let chain: Promise<unknown> = Promise.resolve();

export function enqueue(job: () => Promise<void>): Promise<void> {
  const next = chain.then(() => job());
  chain = next.catch(() => {}); // swallow for the chain only; caller still sees the rejection
  return next;
}
