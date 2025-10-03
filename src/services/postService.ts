import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { posts, postsToTags, tags } from "../db/schema";

export const MAX_TITLE_LENGTH = 255;
export const MAX_CONTENT_LENGTH = 8000;
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 48;

export class ValidationError extends Error {}

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export type PostRecord = typeof posts.$inferSelect;
export type TagRecord = typeof tags.$inferSelect;

export type PostCreateInput = {
  title: string;
  content: string;
  tags?: string[];
};

export type PostUpdateInput = Partial<PostCreateInput>;

export type PostFilters = {
  query?: string;
  tag?: string;
};

export type PostWithTags = PostRecord & { tags: TagRecord[] };
export type Post = PostWithTags;

export async function getAllTags(): Promise<TagRecord[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      createdAt: tags.createdAt,
    })
    .from(tags)
    .innerJoin(postsToTags, eq(tags.id, postsToTags.tagId))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));

  return rows;
}

export async function getAllPosts(filters: PostFilters = {}): Promise<PostWithTags[]> {
  const predicates: SQL[] = [];

  if (filters.query) {
    const term = filters.query.trim();
    if (term) {
      const pattern = `%${escapeLikePattern(term)}%`;
      predicates.push(ilike(posts.title, pattern));
    }
  }

  if (filters.tag) {
    const slug = slugify(filters.tag);
    if (slug) {
      const tagged = await db
        .select({ postId: postsToTags.postId })
        .from(postsToTags)
        .innerJoin(tags, eq(tags.id, postsToTags.tagId))
        .where(eq(tags.slug, slug));

      const ids = tagged.map((row) => row.postId);
      if (!ids.length) {
        return [];
      }

      predicates.push(inArray(posts.id, ids));
    }
  }

  const condition = predicates.length
    ? predicates.length === 1
      ? predicates[0]
      : and(...predicates)
    : null;

  const queryBuilder = condition
    ? db.select().from(posts).where(condition)
    : db.select().from(posts);

  const records = await queryBuilder.orderBy(desc(posts.createdAt));
  const tagMap = await fetchTagsMap(db, records.map((post) => post.id));

  return records.map((post) => ({
    ...post,
    tags: tagMap.get(post.id) ?? [],
    createdAt: normalizeDate(post.createdAt),
    updatedAt: normalizeDate(post.updatedAt),
  }));
}

export async function getPostById(id: number): Promise<PostWithTags | null> {
  return getPostByIdInternal(db, id);
}

export async function createPost(input: PostCreateInput): Promise<PostWithTags> {
  const validated = normalizeCreateInput(input);

  return db.transaction(async (tx) => {
    const createdRows = await tx
      .insert(posts)
      .values({ title: validated.title, content: validated.content })
      .returning();

    const created = createdRows[0];

    if (!created) {
      throw new Error("Failed to create post");
    }

    await replacePostTags(tx, created.id, validated.tags ?? []);
    const persisted = await getPostByIdInternal(tx, created.id);
    return persisted!;
  });
}

export async function updatePost(id: number, input: PostUpdateInput): Promise<PostWithTags | null> {
  const validated = normalizeUpdateInput(input);

  return db.transaction(async (tx) => {
    const existingRows = await tx.select({ id: posts.id }).from(posts).where(eq(posts.id, id));
    const existing = existingRows[0];

    if (!existing) {
      return null;
    }

    const changes: Partial<typeof posts.$inferInsert> = {};

    if (validated.title !== undefined) {
      changes.title = validated.title;
    }

    if (validated.content !== undefined) {
      changes.content = validated.content;
    }

    const hasContentChanges = Object.keys(changes).length > 0;

    if (hasContentChanges) {
      await tx
        .update(posts)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(eq(posts.id, id));
    }

    if (validated.tags !== undefined) {
      await replacePostTags(tx, id, validated.tags);

      if (!hasContentChanges) {
        await tx
          .update(posts)
          .set({ updatedAt: sql`now()` })
          .where(eq(posts.id, id));
      }
    }

    return getPostByIdInternal(tx, id);
  });
}

export async function deletePost(id: number): Promise<boolean> {
  const deleted = await db
    .delete(posts)
    .where(eq(posts.id, id))
    .returning({ id: posts.id });

  return deleted.length > 0;
}

async function fetchTagsMap(client: DbExecutor, postIds: number[]): Promise<Map<number, TagRecord[]>> {
  const map = new Map<number, TagRecord[]>();

  if (!postIds.length) {
    return map;
  }

  const rows = await client
    .select({
      postId: postsToTags.postId,
      tag: tags,
    })
    .from(postsToTags)
    .innerJoin(tags, eq(tags.id, postsToTags.tagId))
    .where(inArray(postsToTags.postId, postIds))
    .orderBy(asc(postsToTags.postId), asc(tags.name));

  rows.forEach(({ postId, tag }) => {
    if (!map.has(postId)) {
      map.set(postId, []);
    }
    map.get(postId)!.push(tag);
  });

  return map;
}

async function replacePostTags(client: DbExecutor, postId: number, tagNames: string[]): Promise<void> {
  const sanitized = sanitizePostTags(tagNames);

  await client.delete(postsToTags).where(eq(postsToTags.postId, postId));

  if (!sanitized.length) {
    return;
  }

  const tagsToLink = await ensureTags(client, sanitized);
  if (!tagsToLink.length) {
    return;
  }

  await client.insert(postsToTags).values(tagsToLink.map((tag) => ({ postId, tagId: tag.id })));
}

async function ensureTags(client: DbExecutor, tagNames: string[]): Promise<TagRecord[]> {
  const normalized = Array.from(
    new Map(
      tagNames
        .map(normalizeTag)
        .filter((tag): tag is NormalizedTag => tag !== null)
        .map((tag) => [tag.slug, tag])
    ).values()
  );

  if (!normalized.length) {
    return [];
  }

  const slugs = normalized.map((tag) => tag.slug);

  const existing = await client.select().from(tags).where(inArray(tags.slug, slugs));

  const bySlug = new Map(existing.map((tag) => [tag.slug, tag] as const));
  const missing = normalized.filter((tag) => !bySlug.has(tag.slug));

  if (missing.length) {
    const inserted = await client.insert(tags).values(missing).returning();
    inserted.forEach((tag) => bySlug.set(tag.slug, tag));
  }

  return slugs
    .map((slug) => bySlug.get(slug)!)
    .filter((tag): tag is TagRecord => Boolean(tag));
}

type NormalizedTag = { name: string; slug: string };

function normalizeTag(raw: unknown): NormalizedTag | null {
  const slug = slugify(raw);
  if (!slug) {
    return null;
  }

  const name = String(raw).trim().replace(/\s+/g, " ");
  if (!name) {
    return null;
  }

  if (name.length > MAX_TAG_LENGTH || slug.length > MAX_TAG_LENGTH) {
    throw new ValidationError(`tags must be at most ${MAX_TAG_LENGTH} characters`);
  }

  return { name, slug };
}

function slugify(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const base = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || null;
}

async function getPostByIdInternal(client: DbExecutor, id: number): Promise<PostWithTags | null> {
  const records = await client.select().from(posts).where(eq(posts.id, id)).limit(1);
  const post = records[0];

  if (!post) {
    return null;
  }

  const tagMap = await fetchTagsMap(client, [post.id]);

  return {
    ...post,
    tags: tagMap.get(post.id) ?? [],
    createdAt: normalizeDate(post.createdAt),
    updatedAt: normalizeDate(post.updatedAt),
  };
}

function escapeLikePattern(term: string): string {
  return term.replace(/[%_]/g, "\\$&");
}

function normalizeDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function normalizeCreateInput(input: PostCreateInput): Required<PostCreateInput> {
  const title = normalizeTitle(input.title);
  const content = normalizeContent(input.content);
  const tags = input.tags ? sanitizePostTags(input.tags) : [];

  return { title, content, tags };
}

function normalizeUpdateInput(input: PostUpdateInput): PostUpdateInput {
  const patch: PostUpdateInput = {};

  if (input.title !== undefined) {
    patch.title = normalizeTitle(input.title);
  }

  if (input.content !== undefined) {
    patch.content = normalizeContent(input.content);
  }

  if (input.tags !== undefined) {
    patch.tags = sanitizePostTags(input.tags);
  }

  return patch;
}

function normalizeTitle(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new ValidationError("title is required");
  }

  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`title must be at most ${MAX_TITLE_LENGTH} characters`);
  }

  return trimmed;
}

function normalizeContent(raw: string): string {
  if (!raw || raw.trim() === "") {
    throw new ValidationError("content is required");
  }

  if (raw.length > MAX_CONTENT_LENGTH) {
    throw new ValidationError(`content must be at most ${MAX_CONTENT_LENGTH} characters`);
  }

  return raw;
}

function sanitizePostTags(tags: string[]): string[] {
  if (!Array.isArray(tags)) {
    throw new ValidationError("tags must be an array of strings");
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of tags) {
    if (typeof entry !== "string") {
      throw new ValidationError("tags must contain only strings");
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.length > MAX_TAG_LENGTH) {
      throw new ValidationError(`tags must be at most ${MAX_TAG_LENGTH} characters`);
    }

    const lowered = trimmed.toLowerCase();
    if (seen.has(lowered)) {
      continue;
    }

    seen.add(lowered);
    normalized.push(trimmed);
  }

  if (normalized.length > MAX_TAGS) {
    throw new ValidationError(`tags must contain at most ${MAX_TAGS} items`);
  }

  return normalized;
}
