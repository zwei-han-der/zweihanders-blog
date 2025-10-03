import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { postsRouter } from '../src/routes/posts';
import { db, initDb } from '../src/db/client';
import { posts } from '../src/db/schema';
import type { Post } from '../src/services/postService';
import { createSessionCookie } from '../src/utils/session';

const BASE_URL = 'http://localhost';
const AUTH_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_COOKIE_VALUE = createSessionCookie({ id: 999, role: 'admin', keyHash: 'test-key-hash' }).split(';', 1)[0] ?? '';

type ErrorBody = { error: string };

async function callPostsRouter(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await postsRouter(new Request(`${BASE_URL}${path}`, withAuth(init)));

  if (!response) {
    throw new Error(`Unhandled route for ${init.method ?? 'GET'} ${path}`);
  }

  return response;
}

function withAuth(init: RequestInit = {}): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();

  if (!AUTH_METHODS.has(method)) {
    return init;
  }

  const headers = new Headers(init.headers ?? undefined);

  if (!headers.has('cookie')) {
    headers.set('cookie', AUTH_COOKIE_VALUE);
  }

  return { ...init, headers };
}

async function getJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createSamplePost(
  input: Partial<{ title: string; content: string; tags: string[] }> = {}
) {
  const payload = {
    title: input.title ?? 'Sample title',
    content: input.content ?? 'Sample content',
    tags: input.tags,
  };

  const response = await callPostsRouter('/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  expect(response.status).toBe(201);
  const body = await getJson<Post>(response);
  expect(body.title).toBe(payload.title);
  expect(body.content).toBe(payload.content);
  expect(typeof body.id).toBe('number');
  expect(typeof body.createdAt === 'string' || typeof body.createdAt === 'number').toBe(true);

  return body;
}

describe('postsRouter', () => {
  const preservedIds = new Set<number>();

  async function removeTransientPosts() {
    const existing = await db.select({ id: posts.id }).from(posts);
    const transientIds = existing.filter(({ id }) => !preservedIds.has(id)).map(({ id }) => id);

    if (transientIds.length === 0) {
      return;
    }

    await db.delete(posts).where(inArray(posts.id, transientIds));
  }

  beforeAll(async () => {
    await initDb();

    const existing = await db.select({ id: posts.id }).from(posts);
    existing.forEach(({ id }) => preservedIds.add(id));
  });

  beforeEach(async () => {
    await removeTransientPosts();
  });

  afterAll(async () => {
    await removeTransientPosts();
  });

  function getTransientPosts(list: Post[]) {
    return list.filter((item) => !preservedIds.has(item.id));
  }

  test('responds to OPTIONS for collection', async () => {
    const response = await callPostsRouter('/posts', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Allow')).toContain('GET');
    expect(response.headers.get('Allow')).toContain('POST');
  });

  test('responds to OPTIONS for item', async () => {
    const response = await callPostsRouter('/posts/1', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Allow')).toContain('DELETE');
  });

  test('returns empty list when there are no posts', async () => {
    const response = await callPostsRouter('/posts', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = await getJson<Post[]>(response);
    expect(getTransientPosts(body)).toHaveLength(0);
    expect(body).toHaveLength(preservedIds.size);
  });

  test('fetches a pre-seeded post from the database', async () => {
    await initDb();

    const createdRows = await db
      .insert(posts)
      .values({ title: 'Seeded title', content: 'Seeded content' })
      .returning();

    const created = createdRows[0];

    expect(created).toBeDefined();

    const response = await callPostsRouter(`/posts/${created!.id}`, { method: 'GET' });
    expect(response.status).toBe(200);
    const body = await getJson<Post>(response);
    expect(body.id).toBe(created!.id);
    expect(body.title).toBe('Seeded title');
    expect(body.content).toBe('Seeded content');
  });

  test('rejects invalid item id', async () => {
    const response = await callPostsRouter('/posts/abc', { method: 'GET' });
    expect(response.status).toBe(400);
    const body = await getJson<ErrorBody>(response);
    expect(body.error).toBe('Invalid post id');
  });

  test('handles CRUD lifecycle for posts', async () => {
    const created = await createSamplePost({ title: 'First', content: 'Post body', tags: ['alpha'] });

    const listResponse = await callPostsRouter('/posts', { method: 'GET' });
    expect(listResponse.status).toBe(200);
    const list = await getJson<Post[]>(listResponse);
    const transientList = getTransientPosts(list);
    expect(transientList).toHaveLength(1);
    const first = transientList[0];
    expect(first).toBeDefined();
    expect(first!.id).toBe(created.id);
    expect(first!.tags?.some((tag) => tag.slug === 'alpha')).toBe(true);

    const getResponse = await callPostsRouter(`/posts/${created.id}`, { method: 'GET' });
    expect(getResponse.status).toBe(200);
    const fetched = await getJson<Post>(getResponse);
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe('First');

    const putResponse = await callPostsRouter(`/posts/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated', content: 'Updated body' }),
    });
    expect(putResponse.status).toBe(200);
    const updated = await getJson<Post>(putResponse);
    expect(updated.title).toBe('Updated');
    expect(updated.content).toBe('Updated body');

    const patchResponse = await callPostsRouter(`/posts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Patched' }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = await getJson<Post>(patchResponse);
    expect(patched.title).toBe('Patched');
    expect(patched.content).toBe('Updated body');

    const deleteResponse = await callPostsRouter(`/posts/${created.id}`, { method: 'DELETE' });
    expect(deleteResponse.status).toBe(204);

    const getMissingResponse = await callPostsRouter(`/posts/${created.id}`, { method: 'GET' });
    expect(getMissingResponse.status).toBe(404);
    const missingBody = await getJson<ErrorBody>(getMissingResponse);
    expect(missingBody.error).toBe('Post not found');
  }, 15000);

  test('updates only tags and refreshes updatedAt timestamp', async () => {
    const created = await createSamplePost({ title: 'Timestamp', content: 'Body', tags: ['alpha'] });

    const initialUpdatedAt = new Date(created.updatedAt as any).getTime();
    expect(Number.isFinite(initialUpdatedAt)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const patchResponse = await callPostsRouter(`/posts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['beta'] }),
    });

    expect(patchResponse.status).toBe(200);

    const patched = await getJson<Post>(patchResponse);
    const patchedUpdatedAt = new Date(patched.updatedAt as any).getTime();
    expect(Number.isFinite(patchedUpdatedAt)).toBe(true);
    expect(patchedUpdatedAt).toBeGreaterThan(initialUpdatedAt);
  }, 15000);

  test('deduplicates tags on create', async () => {
    const response = await callPostsRouter('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'With tags', content: 'Body', tags: ['Foo', 'foo', 'Bar'] }),
    });

    expect(response.status).toBe(201);
    const body = await getJson<Post>(response);
    const uniqueSlugs = new Set(body.tags?.map((tag) => tag.slug));
    expect(uniqueSlugs.size).toBe(2);
    expect(uniqueSlugs.has('foo')).toBe(true);
    expect(uniqueSlugs.has('bar')).toBe(true);
  });

  test('rejects payloads exceeding tag limits', async () => {
    const largeTagList = Array.from({ length: 9 }, (_, index) => `tag-${index}`);

    const response = await callPostsRouter('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Too many tags', content: 'Body', tags: largeTagList }),
    });

    expect(response.status).toBe(400);
    const body = await getJson<ErrorBody>(response);
    expect(body.error).toContain('at most');
  });

  test('rejects payloads with excessive title length', async () => {
    const response = await callPostsRouter('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'a'.repeat(500), content: 'Body' }),
    });

    expect(response.status).toBe(400);
    const body = await getJson<ErrorBody>(response);
    expect(body.error).toContain('title must be at most');
  });

  test('rejects payloads with excessive content length', async () => {
    const response = await callPostsRouter('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Valid', content: 'b'.repeat(9000) }),
    });

    expect(response.status).toBe(400);
    const body = await getJson<ErrorBody>(response);
    expect(body.error).toContain('content must be at most');
  });
});
