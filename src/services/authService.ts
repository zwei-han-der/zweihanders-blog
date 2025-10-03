import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';

export type AuthenticatedUser = {
  id: number;
  role: string;
  keyHash: string;
};

export async function authenticateByKeyHash(keyHash: string): Promise<AuthenticatedUser | null> {
  const trimmed = keyHash.trim();

  if (!trimmed) {
    return null;
  }

  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      keyHash: users.keyHash,
      revokedAt: users.revokedAt,
    })
    .from(users)
    .where(eq(users.keyHash, trimmed))
    .limit(1);

  const record = rows[0];

  if (!record || record.revokedAt) {
    return null;
  }

  await db.update(users).set({ lastUsedAt: new Date() }).where(eq(users.id, record.id));

  return { id: record.id, role: record.role, keyHash: record.keyHash };
}

export async function findUserById(userId: number): Promise<AuthenticatedUser | null> {
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      keyHash: users.keyHash,
      revokedAt: users.revokedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const record = rows[0];

  if (!record || record.revokedAt) {
    return null;
  }

  return { id: record.id, role: record.role, keyHash: record.keyHash };
}
