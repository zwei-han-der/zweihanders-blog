import { createHmac } from 'crypto';

const SESSION_COOKIE_NAME = 'session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-session-secret';

export type SessionPayload = {
  id: number;
  role: string;
  keyHash: string;
};

function encode(payload: SessionPayload) {
  const data = JSON.stringify({ ...payload, iat: Date.now() });
  const base = Buffer.from(data, 'utf8').toString('base64url');
  const signature = createHmac('sha256', SESSION_SECRET).update(base).digest('base64url');
  return `${base}.${signature}`;
}

function decode(token: string): SessionPayload | null {
  const parts = token.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [base, signature] = parts as [string, string];
  const expected = createHmac('sha256', SESSION_SECRET).update(base).digest('base64url');

  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  try {
    const json = Buffer.from(base, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as SessionPayload & { iat?: number };

    if (
      !parsed ||
      typeof parsed.id !== 'number' ||
      typeof parsed.role !== 'string' ||
      typeof parsed.keyHash !== 'string'
    ) {
      return null;
    }

    return { id: parsed.id, role: parsed.role, keyHash: parsed.keyHash };
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  return createHmac('sha256', SESSION_SECRET)
    .update(bufferA)
    .digest('hex') ===
    createHmac('sha256', SESSION_SECRET)
      .update(bufferB)
      .digest('hex');
}

function buildCookieAttributes(maxAge?: number) {
  const parts = [`Path=/`, 'HttpOnly', 'SameSite=Lax'];

  if (typeof maxAge === 'number') {
    parts.push(`Max-Age=${maxAge}`);
  }

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function createSessionCookie(payload: SessionPayload) {
  const token = encode(payload);
  const attributes = buildCookieAttributes(SESSION_TTL_SECONDS);
  return `${SESSION_COOKIE_NAME}=${token}; ${attributes}`;
}

export function clearSessionCookie() {
  const attributes = buildCookieAttributes(0);
  return `${SESSION_COOKIE_NAME}=; ${attributes}`;
}

export function parseSessionCookie(request: Request): SessionPayload | null {
  const header = request.headers.get('cookie');

  if (!header) {
    return null;
  }

  const cookies = header.split(';').map((part) => part.trim());
  const token = cookies
    .map((cookie) => cookie.split('='))
    .filter(([name]) => name === SESSION_COOKIE_NAME)
    .map(([, value]) => value)
    .find((value) => Boolean(value));

  if (!token) {
    return null;
  }

  return decode(token);
}
