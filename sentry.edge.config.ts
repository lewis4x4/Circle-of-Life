import * as Sentry from "@sentry/nextjs";
import {
  parseTraceSampleRate,
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
    beforeSend(event) {
      if (event.user) {
        event.user = { id: event.user.id };
      }
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
}
