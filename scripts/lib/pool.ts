/**
 * Concurrency pool — run async tasks with bounded parallelism.
 *
 * Consumed by: translate-glosses.ts, translate-examples.ts, generate-synonyms-en.ts
 */

/** Run items through fn with at most `concurrency` calls in-flight at once. */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    });
  await Promise.all(workers);
}
