export function resolvePreparationConcurrency(value, fallback = 3) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 8) : fallback;
}

// Only preparation overlaps. Commits stay in input order and never overlap;
// callers must keep shared mutations in commit, not in prepare. Attach rejection
// handlers immediately and drain outstanding work on failure/cancellation.
export async function prepareConcurrentlyAndCommitInOrder(items, {
  prepare,
  commit,
  concurrency = 3,
}) {
  const limit = resolvePreparationConcurrency(concurrency);
  const pending = new Map();
  let next = 0;
  const fill = () => {
    while (next < items.length && pending.size < limit) {
      const index = next++;
      pending.set(index, Promise.resolve()
        .then(() => prepare(items[index], index))
        .then(value => ({ ok: true, value }), error => ({ ok: false, error })));
    }
  };
  fill();
  try {
    for (let index = 0; index < items.length; index += 1) {
      const result = await pending.get(index);
      if (!result.ok) throw result.error;
      // A false result means the session stopped while preparation was running.
      if (await commit(result.value, items[index], index) === false) return;
      pending.delete(index);
      fill();
    }
  } finally {
    await Promise.all(pending.values());
  }
}
