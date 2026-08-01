/** OT-055: sign/verify round trip, tamper detection, published test vector. */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildTabContext,
  generateAgentSigningKey,
  MOLT_USER_AGENT,
  signRequest,
  verifyRequest,
} from './stamp.js';

const REQ = {
  method: 'POST',
  url: 'https://store.example.com/checkout',
  date: 'Sat, 01 Aug 2026 12:00:00 GMT',
  tabContext: 'b'.repeat(64),
  keyId: 'molt-agent-test',
  created: 1785585600,
};

test('sign -> verify round trip', () => {
  const keys = generateAgentSigningKey();
  const headers = signRequest({ ...REQ, privateKeyPem: keys.privateKeyPem });
  assert.ok(
    verifyRequest({
      method: REQ.method,
      url: REQ.url,
      headers: headers as never,
      publicKeyPem: keys.publicKeyPem,
    }),
  );
});

test('any tampering breaks verification', () => {
  const keys = generateAgentSigningKey();
  const headers = signRequest({ ...REQ, privateKeyPem: keys.privateKeyPem }) as never as Record<
    string,
    string
  >;
  const verify = (h: Record<string, string>, url = REQ.url, method = REQ.method) =>
    verifyRequest({ method, url, headers: h, publicKeyPem: keys.publicKeyPem });

  assert.ok(!verify({ ...headers, 'tab-context': 'c'.repeat(64) }), 'tab-context swap');
  assert.ok(!verify({ ...headers, date: 'Sun, 02 Aug 2026 12:00:00 GMT' }), 'date swap');
  assert.ok(!verify(headers, 'https://evil.example.com/checkout'), 'url swap');
  assert.ok(!verify(headers, REQ.url, 'GET'), 'method swap');
  const wrongKey = generateAgentSigningKey();
  assert.ok(
    !verifyRequest({
      method: REQ.method,
      url: REQ.url,
      headers,
      publicKeyPem: wrongKey.publicKeyPem,
    }),
    'wrong key',
  );
});

test('published test vector verifies and stays stable', () => {
  const vector = JSON.parse(
    readFileSync(new URL('../test-vectors/stamp.json', import.meta.url), 'utf8'),
  ) as {
    input: {
      method: string;
      url: string;
      date: string;
      tab_context: string;
      key_id: string;
      created: number;
    };
    publicKeyPem: string;
    privateKeyPem: string;
    expected_headers: Record<string, string>;
  };

  const headers = signRequest({
    method: vector.input.method,
    url: vector.input.url,
    date: vector.input.date,
    tabContext: vector.input.tab_context,
    keyId: vector.input.key_id,
    privateKeyPem: vector.privateKeyPem,
    created: vector.input.created,
  });
  assert.deepEqual(headers, vector.expected_headers, 'signature must be reproducible');
  assert.ok(
    verifyRequest({
      method: vector.input.method,
      url: vector.input.url,
      headers: vector.expected_headers,
      publicKeyPem: vector.publicKeyPem,
    }),
    'vector must verify with the published public key',
  );
});

test('user agent is honest: identifies Molt and links the repo', () => {
  assert.ok(MOLT_USER_AGENT.startsWith('Molt-Agent/'));
  assert.ok(MOLT_USER_AGENT.includes('github.com/meyerdav24/molt'));
});

test('tab context format with and without TA countersignature', () => {
  assert.equal(buildTabContext('ab'.repeat(32)), 'ab'.repeat(32));
  assert.equal(buildTabContext('ab'.repeat(32), 'SIG'), `${'ab'.repeat(32)};ta-sig=SIG`);
});
