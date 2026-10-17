import "server-only";
import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { HttpError } from "./service";
import {
  isRegistrationReceipt,
  isLegacyRegistrationReceipt,
} from "../domain/registration-receipt";

// The callback must atomically reserve the candidate under a unique constraint or table lock.
export async function allocateRegistrationReceipt(
  reserve: (candidate: string) => Promise<boolean>,
  generate = () => String(randomInt(100000, 1000000)),
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = generate();
    if (!isRegistrationReceipt(candidate))
      throw new Error("Invalid receipt generator");
    if (await reserve(candidate)) return candidate;
  }
  throw new HttpError(503, "签到凭证暂时无法分配，请稍后重试。");
}

export async function migrateRegistrationReceipts(client?: PoolClient) {
  const migrate = async (c: PoolClient) => {
    // No activity locks are acquired here. Block concurrent writes for the whole backfill.
    await c.query("LOCK TABLE dl_registrations IN ACCESS EXCLUSIVE MODE");
    const rows = await c.query<{
      id: string;
      receipt: string;
      legacy_receipt: string | null;
    }>(
      "SELECT id,receipt,legacy_receipt FROM dl_registrations WHERE receipt !~ '^[1-9][0-9]{5}$' ORDER BY id",
    );
    for (const r of rows.rows) {
      if (
        !isLegacyRegistrationReceipt(r.receipt) ||
        (r.legacy_receipt && r.legacy_receipt !== r.receipt)
      )
        throw new Error("Unexpected legacy receipt; migration rolled back");
      await allocateRegistrationReceipt(async (candidate) => {
        const used = await c.query(
          "SELECT 1 FROM dl_registrations WHERE receipt=$1",
          [candidate],
        );
        if (used.rowCount) return false;
        await c.query(
          "UPDATE dl_registrations SET legacy_receipt=receipt,receipt=$2 WHERE id=$1",
          [r.id, candidate],
        );
        return true;
      });
    }
    return { migrated: rows.rows.length };
  };
  return client ? migrate(client) : transaction(migrate);
}
