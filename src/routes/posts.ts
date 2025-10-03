import {
  createPost,
  deletePost,
  getAllPosts,
  getAllTags,
  getPostById,
  updatePost,
  MAX_TITLE_LENGTH,
  MAX_CONTENT_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  ValidationError,
} from '../services/postService';
import type { PostCreateInput, PostUpdateInput, PostWithTags } from '../services/postService';
import { parseSessionCookie } from '../utils/session';
import { renderMarkdown } from '../utils/markdown';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  Vary: 'Origin',
};

export function applyCors(extra: Record<string, string> = {}): Record<string, string> {
  return { ...CORS_HEADERS, ...extra };
}

function ensureAuthenticated(request: Request) {
  const session = parseSessionCookie(request);

  if (!session) {
    throw new HttpError(401, 'Authentication required');
  }

  return session;
}

const COLLECTION_PATTERN = /^\/posts\/?$/;
const TAGS_PATTERN = /^\/tags\/?$/;
const ITEM_PATTERN = /^\/posts\/(?<id>[^/]+)\/?$/;

const MAX_JSON_PAYLOAD_BYTES = 128 * 1024;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function postsRouter(request: Request): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;

  const previewPath = isPreviewPath(pathname);

  if (method === 'OPTIONS') {
    if (COLLECTION_PATTERN.test(pathname)) {
      return new Response(null, { status: 204, headers: applyCors({ Allow: 'GET,POST,OPTIONS' }) });
    }

    if (ITEM_PATTERN.test(pathname)) {
      return new Response(null, { status: 204, headers: applyCors({ Allow: 'GET,PUT,PATCH,DELETE,OPTIONS' }) });
    }

    if (previewPath) {
      return new Response(null, { status: 204, headers: applyCors({ Allow: 'POST,OPTIONS' }) });
    }

    return null;
  }

  try {
    if (previewPath) {
      if (method !== 'POST') {
        return methodNotAllowed(['POST']);
      }

      ensureAuthenticated(request);
      const payload = await readJson(request);
      const { content } = (payload as { content?: unknown }) ?? {};

      if (typeof content !== 'string') {
        throw new HttpError(400, 'content must be a string');
      }

      const html = renderMarkdown(content);
      return Response.json({ html }, { headers: applyCors() });
    }

    if (COLLECTION_PATTERN.test(pathname)) {
      if (method === 'GET') {
        const url = new URL(request.url);
        const data = await getAllPosts({
          query: url.searchParams.get('q') ?? undefined,
          tag: url.searchParams.get('tag') ?? undefined,
        });
        return Response.json(data.map(serializePost), { headers: applyCors() });
      }

      if (method === 'POST') {
        ensureAuthenticated(request);
        const payload = await readJson(request);
        const input = validateCreatePayload(payload);
        const created = await createPost(input);
        return Response.json(serializePost(created), { status: 201, headers: applyCors() });
      }

      return methodNotAllowed(['GET', 'POST']);
    }

    if (TAGS_PATTERN.test(pathname)) {
      if (method === 'GET') {
        const data = await getAllTags();
        return Response.json(data, { headers: applyCors() });
      }

      return methodNotAllowed(['GET']);
    }

    const match = previewPath ? null : pathname.match(ITEM_PATTERN);

    if (match) {
      const id = Number(match.groups?.id);

      if (!Number.isInteger(id)) {
        throw new HttpError(400, 'Invalid post id');
      }

      if (method === 'GET') {
        const post = await getPostById(id);

        if (!post) {
          return notFound('Post not found');
        }

        return Response.json(serializePost(post), { headers: applyCors() });
      }

      if (method === 'PUT' || method === 'PATCH') {
        ensureAuthenticated(request);
        const payload = await readJson(request);
        const input = validateUpdatePayload(payload);
        const updated = await updatePost(id, input);

        if (!updated) {
          return notFound('Post not found');
        }

        return Response.json(serializePost(updated), { headers: applyCors() });
      }

      if (method === 'DELETE') {
        ensureAuthenticated(request);
        const removed = await deletePost(id);

        if (!removed) {
          return notFound('Post not found');
        }

        return new Response(null, { status: 204, headers: applyCors() });
      }

      return methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status, headers: applyCors() });
    }

    if (error instanceof ValidationError) {
      return Response.json({ error: error.message }, { status: 400, headers: applyCors() });
    }

    console.error(error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500, headers: applyCors() });
  }

  return null;
}

async function readJson(request: Request): Promise<unknown> {
  ensureJsonRequest(request);

  const body = await request.text();

  if (body.length === 0) {
    throw new HttpError(400, 'Invalid JSON payload');
  }

  const byteLength = new TextEncoder().encode(body).length;

  if (byteLength > MAX_JSON_PAYLOAD_BYTES) {
    throw new HttpError(413, 'Payload too large');
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON payload');
  }
}

function normalizeTags(input: unknown): string[] | undefined {
  if (input === undefined || input === null || input === '') {
    return undefined;
  }

  if (Array.isArray(input)) {
    const tags = input
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);

    if (tags.length !== input.length) {
      throw new HttpError(400, 'tags must contain only strings');
    }

    return sanitizeTags(tags);
  }

  if (typeof input === 'string') {
    const tags = input
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!tags.length) {
      return undefined;
    }

    return sanitizeTags(tags);
  }

  throw new HttpError(400, 'tags must be an array of strings');
}

function validateCreatePayload(payload: unknown): PostCreateInput {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Invalid request body');
  }

  const { title, content, tags } = payload as Partial<PostCreateInput> & { tags?: unknown };

  if (typeof title !== 'string' || title.trim() === '') {
    throw new HttpError(400, 'title is required');
  }

  if (typeof content !== 'string' || content.trim() === '') {
    throw new HttpError(400, 'content is required');
  }

  const normalizedTitle = title.trim();
  if (normalizedTitle.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `title must be at most ${MAX_TITLE_LENGTH} characters`);
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw new HttpError(400, `content must be at most ${MAX_CONTENT_LENGTH} characters`);
  }

  return {
    title: normalizedTitle,
    content,
    tags: normalizeTags(tags),
  };
}

function validateUpdatePayload(payload: unknown): PostUpdateInput {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Invalid request body');
  }

  const { title, content, tags } = payload as Partial<PostUpdateInput> & { tags?: unknown };
  const patch: PostUpdateInput = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim() === '') {
      throw new HttpError(400, 'title must be a non-empty string');
    }

    const normalizedTitle = title.trim();
    if (normalizedTitle.length > MAX_TITLE_LENGTH) {
      throw new HttpError(400, `title must be at most ${MAX_TITLE_LENGTH} characters`);
    }

    patch.title = normalizedTitle;
  }

  if (content !== undefined) {
    if (typeof content !== 'string' || content.trim() === '') {
      throw new HttpError(400, 'content must be a non-empty string');
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      throw new HttpError(400, `content must be at most ${MAX_CONTENT_LENGTH} characters`);
    }

    patch.content = content;
  }

  if (tags !== undefined) {
    patch.tags = normalizeTags(tags) ?? [];
  }

  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, 'At least one field must be provided');
  }

  return patch;
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(null, { status: 405, headers: applyCors({ Allow: allowed.join(', ') }) });
}

function notFound(message: string): Response {
  return Response.json({ error: message }, { status: 404, headers: applyCors() });
}

function ensureJsonRequest(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  const lowered = contentType.toLowerCase();

  if (!lowered.includes('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }

  const contentLength = request.headers.get('content-length');

  if (contentLength) {
    const size = Number(contentLength);

    if (!Number.isFinite(size) || size < 0) {
      throw new HttpError(400, 'Invalid Content-Length header');
    }

    if (size > MAX_JSON_PAYLOAD_BYTES) {
      throw new HttpError(413, 'Payload too large');
    }
  }
}

function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) {
      throw new HttpError(400, `tags must be at most ${MAX_TAG_LENGTH} characters`);
    }

    const lowered = tag.toLowerCase();

    if (seen.has(lowered)) {
      continue;
    }

    seen.add(lowered);
    normalized.push(tag);
  }

  if (normalized.length > MAX_TAGS) {
    throw new HttpError(400, `tags must contain at most ${MAX_TAGS} items`);
  }

  return normalized.length ? normalized : [];
}

function serializePost(post: PostWithTags) {
  return {
    ...post,
    createdAt: convertTimestamp(post.createdAt),
    updatedAt: convertTimestamp(post.updatedAt),
    contentHtml: renderMarkdown(post.content),
  };
}

function isPreviewPath(pathname: string): boolean {
  return pathname === '/posts/preview' || pathname === '/posts/preview/';
}

function convertTimestamp(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}
