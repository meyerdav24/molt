/**
 * Session management (OT-020): short-lived access JWT + refresh JWT in
 * httpOnly cookies, plus a signed short-lived challenge cookie that carries
 * WebAuthn challenges between the options and verify calls (stateless, so
 * the TA needs no challenge table).
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';

const ACCESS_COOKIE = 'molt_session';
const REFRESH_COOKIE = 'molt_refresh';
const CHALLENGE_COOKIE = 'molt_challenge';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 30 * 24 * 3600;
const CHALLENGE_TTL_S = 5 * 60;

function key(): Uint8Array {
  const secret = process.env.MOLT_SESSION_SECRET;
  if (!secret) throw new Error('MOLT_SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

function secureCookies(): boolean {
  return (process.env.MOLT_PUBLIC_URL ?? '').startsWith('https://');
}

async function sign(payload: JWTPayload, ttlSeconds: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key());
}

async function verify(token: string): Promise<JWTPayload | null> {
  try {
    return (await jwtVerify(token, key())).payload;
  } catch {
    return null;
  }
}

export async function createSession(userId: string): Promise<void> {
  const jar = await cookies();
  const secure = secureCookies();
  jar.set(ACCESS_COOKIE, await sign({ sub: userId, typ: 'access' }, ACCESS_TTL_S), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: ACCESS_TTL_S,
  });
  jar.set(REFRESH_COOKIE, await sign({ sub: userId, typ: 'refresh' }, REFRESH_TTL_S), {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/api/auth/refresh',
    maxAge: REFRESH_TTL_S,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.set(REFRESH_COOKIE, '', { path: '/api/auth/refresh', maxAge: 0 });
}

/** User id from a valid access token, or null. */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const payload = await verify(token);
  if (!payload || payload.typ !== 'access' || typeof payload.sub !== 'string') return null;
  return payload.sub;
}

/** User id from a valid refresh token, or null. Used only by /api/auth/refresh. */
export async function getRefreshUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(REFRESH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verify(token);
  if (!payload || payload.typ !== 'refresh' || typeof payload.sub !== 'string') return null;
  return payload.sub;
}

export interface ChallengeData {
  kind: 'register' | 'login' | 'ceremony';
  challenge: string;
  email?: string;
  /** Ceremony only: the pending mandate document the challenge was derived from. */
  payload?: unknown;
}

/** Store a WebAuthn challenge for the follow-up verify call. */
export async function setChallenge(data: ChallengeData): Promise<void> {
  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, await sign({ typ: 'challenge', ...data }, CHALLENGE_TTL_S), {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies(),
    path: '/api',
    maxAge: CHALLENGE_TTL_S,
  });
}

/** Read and invalidate the pending challenge (single use). */
export async function consumeChallenge(kind: ChallengeData['kind']): Promise<ChallengeData | null> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  jar.set(CHALLENGE_COOKIE, '', { path: '/api', maxAge: 0 });
  if (!token) return null;
  const payload = await verify(token);
  if (!payload || payload.typ !== 'challenge' || payload.kind !== kind) return null;
  if (typeof payload.challenge !== 'string') return null;
  const data: ChallengeData = { kind, challenge: payload.challenge };
  if (typeof payload.email === 'string') data.email = payload.email;
  if (payload.payload !== undefined) data.payload = payload.payload;
  return data;
}
