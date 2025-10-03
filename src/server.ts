import { initDb } from './db/client';
import { postsRouter } from './routes/posts';
import { authRouter } from './routes/auth';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = new URL('../public/', import.meta.url);

initDb()
  .then(() => console.log('Database connection ready'))
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    return handleRequest(request);
  },
});

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const staticResponse = await serveStaticAsset(request, url);
  if (staticResponse) {
    return staticResponse;
  }

  const authResponse = await authRouter(request);
  if (authResponse) {
    return authResponse;
  }

  const postsResponse = await postsRouter(request);
  if (postsResponse) {
    return postsResponse;
  }

  return Response.json({ error: 'Not Found' }, { status: 404 });
}

async function serveStaticAsset(request: Request, url: URL): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null;
  }

  if (url.pathname.startsWith('/posts')) {
    return null;
  }

  if (url.pathname.includes('..')) {
    return new Response('Not Found', { status: 404 });
  }

  let relativePath = url.pathname === '/' || url.pathname === '' ? 'index.html' : url.pathname.slice(1);

  if (!relativePath) {
    relativePath = 'index.html';
  }

  const fileUrl = new URL(relativePath, PUBLIC_DIR);
  const file = Bun.file(fileUrl);

  if (!(await file.exists())) {
    return null;
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      headers: {
        'Content-Type': file.type,
        'Content-Length': String(await file.size),
      },
    });
  }

  return new Response(file, {
    headers: {
      'Content-Type': file.type,
    },
  });
}

console.log(`Server listening on http://localhost:${server.port}`);
