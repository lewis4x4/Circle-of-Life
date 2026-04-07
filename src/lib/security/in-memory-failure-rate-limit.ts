type FailureLimiterOptions = {
  maxFailures: number;
  windowMs: number;
};

type FailureRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const failureBuckets = new Map<string, number[]>();

function pruneFailures(timestamps: number[], now: number, windowMs: number) {
  return timestamps.filter((ts) => now - ts < windowMs);
}

export function checkFailureRateLimit(
  key: string,
  options: FailureLimiterOptions,
): FailureRateLimitResult {
  const now = Date.now();
  const timestamps = pruneFailures(failureBuckets.get(key) ?? [], now, options.windowMs);
  failureBuckets.set(key, timestamps);

  if (timestamps.length < options.maxFailures) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const oldestRelevant = timestamps[0];
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((oldestRelevant + options.windowMs - now) / 1000),
  );

  return {
    allowed: false,
    retryAfterSeconds,
  };
}

export function recordFailureRateLimit(
  key: string,
  options: FailureLimiterOptions,
) {
  const now = Date.now();
  const timestamps = pruneFailures(failureBuckets.get(key) ?? [], now, options.windowMs);
  timestamps.push(now);
  failureBuckets.set(key, timestamps);
}

export function clearFailureRateLimit(key: string) {
  failureBuckets.delete(key);
}
