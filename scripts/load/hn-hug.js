/**
 * OT-102 load sanity: a plausible HN hug.
 *
 * Front page traffic is mostly readers: landing, docs, spec, a few health
 * checks, a trickle of waitlist posts. ~120 concurrent readers sustained is
 * a strong HN front-page hour; we ramp past that briefly.
 *
 *   k6 run -e BASE=https://moltprotocol.dev scripts/load/hn-hug.js
 *
 * Against a local instance the same script doubles as the rate-limiter
 * check: the waitlist scenario must start seeing 429s (checked when
 * EXPECT_RATE_LIMIT=1).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:3000';
const EXPECT_RATE_LIMIT = __ENV.EXPECT_RATE_LIMIT === '1';

export const options = {
  scenarios: {
    readers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 60 },
        { duration: '40s', target: 150 },
        { duration: '30s', target: 150 },
        { duration: '10s', target: 0 },
      ],
      exec: 'reader',
    },
    health: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '100s',
      preAllocatedVUs: 5,
      exec: 'health',
    },
    waitlist: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '1s',
      duration: '100s',
      preAllocatedVUs: 5,
      exec: 'waitlist',
    },
  },
  thresholds: {
    'http_req_duration{scenario:readers}': ['p(95)<1000'],
    'http_req_failed{scenario:readers}': ['rate<0.01'],
    'http_req_failed{scenario:health}': ['rate<0.01'],
  },
};

const PAGES = ['/', '/docs', '/docs/spec', '/docs/quickstart', '/docs/faq'];

export function reader() {
  const page = PAGES[Math.floor(Math.random() * PAGES.length)];
  const res = http.get(`${BASE}${page}`);
  check(res, { 'page 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 3); // humans read
}

export function health() {
  const res = http.get(`${BASE}/api/v1/health`);
  check(res, { 'health ok': (r) => r.status === 200 && r.json('mode') === 'test' });
}

// same client IP posting every second: the 10/min limiter must bite
let waitlist429 = 0;
export function waitlist() {
  const res = http.post(`${BASE}/api/waitlist`, JSON.stringify({ email: 'not-an-email' }), {
    headers: { 'content-type': 'application/json' },
  });
  if (res.status === 429) waitlist429++;
  check(res, { 'waitlist answers 400 or 429': (r) => r.status === 400 || r.status === 429 });
  if (EXPECT_RATE_LIMIT) {
    check(res, { 'rate limiter engages eventually': () => waitlist429 > 0 || __ITER < 15 });
  }
}
