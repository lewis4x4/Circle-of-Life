import { handleWorkforcePublisher } from './handler.ts';
import { publisherStore } from './rpc.ts';
import { PublisherFailure } from './publisher.ts';
Deno.serve((request) => handleWorkforcePublisher(request, {
  cronSecret: Deno.env.get('WORKFORCE_PUBLISHER_CRON_SECRET'),
  ingestSecret: Deno.env.get('WORKFORCE_INGEST_SECRET'),
}, () => {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url !== 'https://manfqmasfqppukpobpld.supabase.co' || !key) throw new PublisherFailure('publisher_unconfigured');
  return publisherStore(url, key);
}, 'haven'));
