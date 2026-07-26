import { RateLimiter } from '@/helpers/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('lets the first caller through without waiting', async () => {
    const limiter = new RateLimiter(1_000);
    const acquired = jest.fn();

    void limiter.acquire().then(acquired);
    await jest.advanceTimersByTimeAsync(0);

    expect(acquired).toHaveBeenCalled();
  });

  it('holds the second caller for the full interval', async () => {
    const limiter = new RateLimiter(1_000);
    const second = jest.fn();

    await limiter.acquire();
    void limiter.acquire().then(second);

    await jest.advanceTimersByTimeAsync(999);
    expect(second).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(second).toHaveBeenCalled();
  });

  it('spaces a burst out one interval at a time', async () => {
    const limiter = new RateLimiter(1_000);
    const order: number[] = [];

    for (const index of [0, 1, 2]) {
      void limiter.acquire().then(() => order.push(index));
    }

    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual([0]);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual([0, 1]);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual([0, 1, 2]);
  });

  it('does not throttle a caller that arrives after the interval has elapsed', async () => {
    const limiter = new RateLimiter(1_000);
    const late = jest.fn();

    await limiter.acquire();
    await jest.advanceTimersByTimeAsync(1_500);

    void limiter.acquire().then(late);
    await jest.advanceTimersByTimeAsync(0);

    expect(late).toHaveBeenCalled();
  });
});
