import * as Sentry from "@sentry/nextjs";
import {
  parseTraceSampleRate,
  scrubErrorEvent,
  scrubPerformanceEvent,
} from "./src/lib/observability/sentry-performance";

const dsn = process.env.SENTRY_DSN;
const traceSampleRate = parseTraceSampleRate(
  process.env.SENTRY_TRACES_SAMPLE_RATE,
  process.env.NODE_ENV === "production" ? 0.05 : 0,
);

if (dsn) {
  Sentry.init({
    dsn,
    enabled: true,
    tracesSampleRate: traceSampleRate,
    sendDefaultPii: false,
    beforeSendTransaction: scrubPerformanceEvent,
    beforeSend: scrubErrorEvent,
  });
}
