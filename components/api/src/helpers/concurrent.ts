export async function concurrent<I, R = void>(
  items: I[],
  concurrency: number,
  fn: (item: I) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing = new Set<Promise<void>>();
  let next = 0;

  do {
    while (next < items.length && executing.size < concurrency) {
      const index = next++;
      const wrapped = fn(items[index])
        .then((r) => {
          results[index] = r;
        })
        .finally(() => executing.delete(wrapped));
      executing.add(wrapped);
    }
    if (executing.size > 0) {
      await Promise.race(executing);
    }
  } while (executing.size > 0 || next < items.length);

  return results;
}
