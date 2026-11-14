import { describe, expect, it, vi } from "vitest";
import { buildCallLog, cancelOnCallInvite, inviteToOnCall, respondToOnCallInvite } from "@/lib/security-checks/on-call";

/** A fake Prisma client: every model method is a mock, and $transaction runs the callback on the same fake. */
function fakeDb() {
  const db = {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    onCallInvite: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  return db;
}
const asDb = (db: ReturnType<typeof fakeDb>) => db as never;
const now = new Date("2026-11-13T10:00:00Z");

describe("inviting a person to go on call (#on-call)", () => {
  const person = { id: "u1", onCallAt: null, securityClearedAt: null };

  it("creates the invite by lowercase email and tells a person with an account in their inbox", async () => {
    const db = fakeDb();
    db.user.findUnique.mockResolvedValue(person);
    db.onCallInvite.findFirst.mockResolvedValue(null);
    db.onCallInvite.create.mockResolvedValue({ id: "inv1" });
    expect(await inviteToOnCall(asDb(db), { email: "  Hamzat@Example.com ", invitedById: "admin", clearForSecurity: true })).toEqual({ inviteId: "inv1" });
    expect(db.user.findUnique.mock.calls[0][0].where).toEqual({ email: "hamzat@example.com" });
    expect(db.onCallInvite.create.mock.calls[0][0].data).toEqual({ email: "hamzat@example.com", invitedById: "admin", clearForSecurity: true });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ userId: "u1", kind: "on_call_invite" });
  });

  it("invites someone with no account yet, with no inbox note", async () => {
    const db = fakeDb();
    db.user.findUnique.mockResolvedValue(null);
    db.onCallInvite.findFirst.mockResolvedValue(null);
    db.onCallInvite.create.mockResolvedValue({ id: "inv2" });
    await inviteToOnCall(asDb(db), { email: "new@example.com", invitedById: "admin", clearForSecurity: false });
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("refuses a bad address, a person already on call, or one already invited", async () => {
    const cases: [string, unknown, unknown, string][] = [
      ["not-an-email", null, null, "invalid_email"],
      ["a@b.co", { ...person, onCallAt: now }, null, "already_on_call"],
      ["a@b.co", person, { id: "old" }, "already_invited"],
    ];
    for (const [email, found, pending, code] of cases) {
      const db = fakeDb();
      db.user.findUnique.mockResolvedValue(found);
      db.onCallInvite.findFirst.mockResolvedValue(pending);
      await expect(inviteToOnCall(asDb(db), { email, invitedById: "admin", clearForSecurity: false })).rejects.toMatchObject({ code });
      expect(db.onCallInvite.create).not.toHaveBeenCalled();
    }
  });

  it("still invites someone on call who is not yet cleared when the invite clears them", async () => {
    const db = fakeDb();
    db.user.findUnique.mockResolvedValue({ ...person, onCallAt: now });
    db.onCallInvite.findFirst.mockResolvedValue(null);
    db.onCallInvite.create.mockResolvedValue({ id: "inv3" });
    await expect(inviteToOnCall(asDb(db), { email: "a@b.co", invitedById: "admin", clearForSecurity: true })).resolves.toEqual({ inviteId: "inv3" });
  });

  it("lets staff withdraw only a pending invite", async () => {
    const db = fakeDb();
    db.onCallInvite.updateMany.mockResolvedValue({ count: 0 });
    await expect(cancelOnCallInvite(asDb(db), "inv1", now)).rejects.toMatchObject({ code: "not_pending" });
  });
});

describe("the invited person answering (#on-call)", () => {
  const invite = (clearForSecurity: boolean) => ({ id: "inv1", email: "owner@example.com", clearForSecurity });
  const signedIn = { email: "Owner@Example.com" };

  it("accepting puts the person on call, and clears them for security only when the invite says so", async () => {
    for (const clear of [true, false]) {
      const db = fakeDb();
      db.onCallInvite.findUnique.mockResolvedValue(invite(clear));
      db.user.findUnique.mockResolvedValue(signedIn);
      db.onCallInvite.updateMany.mockResolvedValue({ count: 1 });
      await respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "u1", accept: true }, now);
      expect(db.user.update.mock.calls[0][0]).toEqual({ where: { id: "u1" }, data: clear ? { onCallAt: now, securityClearedAt: now } : { onCallAt: now } });
    }
  });

  it("declining changes nothing on the person", async () => {
    const db = fakeDb();
    db.onCallInvite.findUnique.mockResolvedValue(invite(true));
    db.user.findUnique.mockResolvedValue(signedIn);
    db.onCallInvite.updateMany.mockResolvedValue({ count: 1 });
    await respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "u1", accept: false }, now);
    expect(db.onCallInvite.updateMany.mock.calls[0][0].data).toMatchObject({ status: "declined" });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("only the person with that email may answer, and only once", async () => {
    const db = fakeDb();
    db.onCallInvite.findUnique.mockResolvedValue(invite(false));
    db.user.findUnique.mockResolvedValue({ email: "someone-else@example.com" });
    await expect(respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "u2", accept: true }, now)).rejects.toMatchObject({ code: "not_yours" });
    db.user.findUnique.mockResolvedValue(signedIn);
    db.onCallInvite.updateMany.mockResolvedValue({ count: 0 });
    await expect(respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "u1", accept: true }, now)).rejects.toMatchObject({ code: "not_pending" });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("the call log (#on-call)", () => {
  const owner = { owner: { name: "Ada", email: "ada@example.com" } };

  it("says who picked up each part and how fast, and flags a part nobody took", () => {
    const log = buildCallLog(
      [
        { createdAt: new Date("2026-11-13T09:00:00Z"), assignedAt: new Date("2026-11-13T09:00:30Z"), title: "Headers", agent: owner },
        { createdAt: new Date("2026-11-13T09:30:00Z"), assignedAt: null, title: "Secrets", agent: null },
        { createdAt: new Date("2026-11-13T09:58:00Z"), assignedAt: null, title: "Fresh", agent: null },
      ],
      [{ createdAt: new Date("2026-11-13T08:00:00Z"), organisation: { name: "Settle" }, agent: { owner: { name: null, email: "bo@example.com" } } }],
      now,
    );
    expect(log.map((l) => l.what)).toEqual(["Security check part: Fresh", "Security check part: Secrets", "Security check part: Headers", "New workspace: Settle"]);
    expect(log[0]).toMatchObject({ pickedUpBy: null, missed: false });
    expect(log[1]).toMatchObject({ pickedUpBy: null, missed: true });
    expect(log[2]).toMatchObject({ pickedUpBy: "Ada", waitMs: 30_000, missed: false });
    expect(log[3]).toMatchObject({ pickedUpBy: "bo@example.com", waitMs: 0 });
  });
});
