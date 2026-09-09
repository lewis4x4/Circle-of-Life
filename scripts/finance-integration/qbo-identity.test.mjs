import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkQboIdentity } from './qbo-identity.mjs';
const fixture = { realm: '1234567', expectedRealm: '1234567', token: 'synthetic-token', expectedCompanyInfoId: '1', expectedCompanyNameHash: crypto.createHash('sha256').update('Synthetic Books').digest('hex') };
test('HFA-028 missing identity or wrong realm prevents all network access', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw new Error('unexpected'); };
  assert.equal((await checkQboIdentity({}, fetcher)).status, 'BLOCKED_EXTERNAL');
  assert.equal((await checkQboIdentity({ ...fixture, expectedRealm: '7654321' }, fetcher)).status, 'FAIL');
  assert.equal(calls, 0);
});
test('HFA-028 fixed sandbox GET and independent CompanyInfo identity are enforced', async () => {
  const result = await checkQboIdentity(fixture, async (url, options) => {
    assert.equal(url, 'https://sandbox-quickbooks.api.intuit.com/v3/company/1234567/companyinfo/1234567');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return Response.json({ CompanyInfo: { Id: '1', CompanyName: 'Synthetic Books' } });
  });
  assert.equal(result.status, 'PASS');
  assert.equal(JSON.stringify(result).includes('Synthetic Books'), false);
  assert.equal(JSON.stringify(result).includes(fixture.token), false);
});
test('HFA-028 wrong returned company and malformed response fail closed', async () => {
  for (const body of [{ CompanyInfo: { Id: '2', CompanyName: 'Synthetic Books' } }, { CompanyInfo: { Id: '1', CompanyName: 'Other Books' } }, {}]) {
    assert.equal((await checkQboIdentity(fixture, async () => Response.json(body))).status, 'FAIL');
  }
});
test('HFA-027 provider failures never copy sensitive raw error text', async () => {
  const marker = 'synthetic-resident-detail';
  for (const fetcher of [async () => { throw new Error(marker); }, async () => new Response(marker, { status: 401 })]) {
    const result = await checkQboIdentity(fixture, fetcher);
    assert.equal(result.status, 'FAIL'); assert.equal(JSON.stringify(result).includes(marker), false);
  }
});
