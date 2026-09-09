import crypto from 'node:crypto';
export async function checkQboIdentity(config, fetcher = fetch) {
  const { environment = 'sandbox', realm, expectedRealm, token, expectedCompanyInfoId, expectedCompanyNameHash } = config;
  if (!['sandbox', 'production'].includes(environment)) return { status: 'FAIL', reason: 'environment', checks: [] };
  if (!realm || !expectedRealm || !token || !expectedCompanyInfoId || !expectedCompanyNameHash) return {
    status: 'BLOCKED_EXTERNAL', reason: 'verified-identity-and-token-required', checks: [],
  };
  if (!/^[1-9]\d{0,19}$/.test(realm) || realm !== expectedRealm || !/^[0-9a-f]{64}$/.test(expectedCompanyNameHash) || !/^[1-9]\d{0,19}$/.test(expectedCompanyInfoId)) return {
    status: 'FAIL', reason: 'configured-identity', checks: [{ name: 'configured-company-identity', status: 'FAIL' }],
  };
  const hostname = environment === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
  const target_identity = `${hostname}/realm-sha256:${crypto.createHash('sha256').update(realm).digest('hex')}`;
  try {
    const response = await fetcher(`https://${hostname}/v3/company/${realm}/companyinfo/${realm}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) return { status: 'FAIL', target_identity, checks: [{ name: 'company-read', status: 'FAIL', http_status: response.status }] };
    const body = await response.json();
    // CompanyInfo object identity is not assumed to equal the OAuth realm.
    const company = body?.CompanyInfo;
    const matches = String(company?.Id) === expectedCompanyInfoId && typeof company?.CompanyName === 'string' && crypto.createHash('sha256').update(company.CompanyName).digest('hex') === expectedCompanyNameHash;
    return { status: matches ? 'PASS' : 'FAIL', target_identity, checks: [{ name: 'company-readback-identity', status: matches ? 'PASS' : 'FAIL' }] };
  } catch {
    // Provider error bodies and thrown messages may contain sensitive source data.
    return { status: 'FAIL', target_identity, checks: [{ name: 'company-read', status: 'FAIL', error_category: 'transport-or-invalid-response' }] };
  }
}
