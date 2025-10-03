import { authenticateByKeyHash, findUserById } from '../services/authService';
import { createSessionCookie, clearSessionCookie, parseSessionCookie } from '../utils/session';
import { applyCors } from './posts';

const LOGIN_PATTERN = /^\/auth\/login\/?$/;
const LOGOUT_PATTERN = /^\/auth\/logout\/?$/;
const SESSION_PATTERN = /^\/auth\/session\/?$/;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function authRouter(request: Request): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;

  try {
    if (method === 'POST' && LOGIN_PATTERN.test(pathname)) {
      const payload = await readJson(request);
      const keyHash = typeof payload?.keyHash === 'string' ? payload.keyHash.trim() : '';

      if (!keyHash) {
        throw new HttpError(400, 'keyHash is required');
      }

      const user = await authenticateByKeyHash(keyHash);

      if (!user) {
        throw new HttpError(401, 'Invalid key hash');
      }

      const headers: Record<string, string> = {
        ...applyCors(),
        'Set-Cookie': createSessionCookie({ id: user.id, role: user.role, keyHash: user.keyHash }),
      };

      return Response.json({ authenticated: true, user }, { headers });
    }

    if (method === 'POST' && LOGOUT_PATTERN.test(pathname)) {
      const headers: Record<string, string> = {
        ...applyCors(),
        'Set-Cookie': clearSessionCookie(),
      };

      return Response.json({ authenticated: false }, { headers });
    }

    if (method === 'GET' && SESSION_PATTERN.test(pathname)) {
      const session = parseSessionCookie(request);
      const headers = applyCors();

      if (!session) {
        return Response.json({ authenticated: false }, { headers });
      }

      const user = await findUserById(session.id);

      if (!user || user.keyHash !== session.keyHash) {
        return Response.json({ authenticated: false }, { headers });
      }

      return Response.json({ authenticated: true, user }, { headers });
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status, headers: applyCors() });
    }

    console.error(error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500, headers: applyCors() });
  }

  return null;
}

async function readJson(request: Request): Promise<any> {
  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }

  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON payload');
  }
}
