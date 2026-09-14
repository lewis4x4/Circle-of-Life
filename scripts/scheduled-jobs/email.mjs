/** No provider response body or recipient is returned to callers/logs. */
export async function sendAlertEmail(delivery, env = process.env, fetcher = fetch) {
  if (!env.RESEND_API_KEY || !env.SYSTEM_ALERT_EMAIL_FROM) return { status: 'unconfigured', error_code: 'email_provider_not_configured' };
  const labels = { test: 'Test email', job_failure: 'Scheduled job needs attention', job_recovery: 'Scheduled jobs recovered', monitor_failure: 'Job monitor needs attention' };
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `haven-system-alert/${delivery.id}` },
      body: JSON.stringify({ from: env.SYSTEM_ALERT_EMAIL_FROM, to: [delivery.recipients[0]],
        ...(delivery.recipients.length > 1 ? { bcc: delivery.recipients.slice(1) } : {}),
        subject: `Haven — ${labels[delivery.kind] ?? 'System alert'}`,
        text: `${labels[delivery.kind] ?? 'System alert'}. Open Haven Admin → Settings → System Alerts to review the current status. This email contains no resident or clinical information.` }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { status: 'failed', error_code: `provider_http_${response.status}` };
    const result = await response.json();
    if (typeof result.id !== 'string' || !result.id) return { status: 'failed', error_code: 'provider_receipt_missing' };
    return { status: 'provider_accepted', provider_id: result.id };
  } catch { return { status: 'failed', error_code: 'provider_request_failed' }; }
}
