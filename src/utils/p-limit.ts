export function pLimit(concurrency: number) {
  const queue: Array<() => Promise<any>> = [];
  let activeCount = 0;
  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const run = queue.shift();
      if (run) run();
    }
  };
  const run = async (
    fn: () => Promise<any>,
    resolve: (val: any) => void,
    reject: (err: any) => void
  ) => {
    activeCount++;
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      next();
    }
  };
  return (fn: () => Promise<any>) => {
    return new Promise((resolve, reject) => {
      if (activeCount < concurrency) {
        run(fn, resolve, reject);
      } else {
        queue.push(() => run(fn, resolve, reject));
      }
    });
  };
}
