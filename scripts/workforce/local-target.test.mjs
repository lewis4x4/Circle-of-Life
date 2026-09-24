import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localWorkforceDatabase } from './local-target.mjs';
const good = 'postgresql://postgres@127.0.0.1:55449/col721_haven_20260923';
test('explicit named loopback verification database is accepted', () => { assert.equal(localWorkforceDatabase(good), good); });
test('libpq overrides cannot turn a local-looking URL into a remote or arbitrary database', () => {
  for (const value of [
    `${good}?host=database.example`, `${good}?hostaddr=10.0.0.1`, `${good}?dbname=postgres`, `${good}?service=production`,
    `${good}?options=-c%20search_path%3Dpublic`, `${good}?host=localhost&host=database.example`,
    'postgresql://postgres@remote.example:55449/col721_haven_20260923?host=127.0.0.1',
    'postgresql://postgres@/col721_haven_20260923?port=55449',
    'postgresql://postgres@/col721_haven_20260923?host=remote.example&port=55449',
    'https://postgres@127.0.0.1:55449/col721_haven_20260923',
    'postgresql://postgres@127.0.0.1:55449/postgres',
    'postgresql://postgres@127.0.0.1/col721_haven_20260923',
    `${good}?host=/tmp&port=55449`,
  ]) assert.throws(() => localWorkforceDatabase(value));
});
