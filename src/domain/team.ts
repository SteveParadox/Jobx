import { getDb } from '@/db';
import * as s from '@/db/schema';
import { type Actor, employerAccess } from '@/lib/auth';
import { brand } from '@/lib/config';
import { AppError, requireValue } from '@/lib/errors';
import { digest, escapeHtml, token } from '@/lib/security';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { audit } from './jobs';
export async function invite(
  actor: Actor,
  employerId: string,
  email: string,
  role: 'admin' | 'recruiter' | 'viewer',
) {
  await employerAccess(actor, employerId, ['owner', 'admin']);
  const secret = token();
  return getDb().transaction(async (tx) => {
    const recipient = email.trim().toLowerCase();
    const [invitation] = await tx
      .insert(s.invitations)
      .values({
        employerId,
        email: recipient,
        role,
        tokenHash: digest(secret),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();
    await tx.insert(s.deliveries).values({
      userId: actor.id,
      to: recipient,
      subject: `Invitation to ${brand.name}`,
      body: `<p>You have been invited to an employer team. <a href="${brand.url}/invite?token=${escapeHtml(secret)}">Review and accept invitation</a></p>`,
      dedupeKey: 'invitation:' + invitation.id,
    });
    await audit(tx, actor.id, 'team.invited', employerId, { email, role });
    return { id: invitation.id };
  });
}
export async function acceptInvite(actor: Actor, secret: string) {
  return getDb().transaction(async (tx) => {
    const invitation = requireValue(
      (
        await tx
          .select()
          .from(s.invitations)
          .where(
            and(
              eq(s.invitations.tokenHash, digest(secret)),
              isNull(s.invitations.acceptedAt),
              gt(s.invitations.expiresAt, new Date()),
            ),
          )
          .for('update')
      )[0],
    );
    if (invitation.email !== actor.email.toLowerCase())
      throw new AppError(403, 'Sign in with the email address that received this invitation');
    await tx
      .insert(s.memberships)
      .values({ employerId: invitation.employerId, userId: actor.id, role: invitation.role })
      .onConflictDoNothing();
    await tx
      .update(s.invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(s.invitations.id, invitation.id));
    await audit(tx, actor.id, 'team.joined', invitation.employerId);
    return { employerId: invitation.employerId };
  });
}
export async function removeMember(actor: Actor, employerId: string, userId: string) {
  await employerAccess(actor, employerId, ['owner']);
  return getDb().transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.employerId, employerId), eq(s.memberships.userId, userId)));
    if (member?.role === 'owner')
      throw new AppError(409, 'Transfer ownership before removing an owner');
    await tx
      .delete(s.memberships)
      .where(and(eq(s.memberships.employerId, employerId), eq(s.memberships.userId, userId)));
    await audit(tx, actor.id, 'team.removed', employerId, { userId });
  });
}
