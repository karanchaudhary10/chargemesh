/**
 * Independently verifies that the local audit chain is anchored on Hedera HCS.
 *
 * Checks, in order:
 *   1. The local Postgres hash chain (sequence + prevHash + recomputed hash).
 *   2. Every anchored event exists on the topic and its id/seq/type/at/hash/prevHash
 *      match the message stored on Hedera byte for byte.
 *   3. The transaction id recorded in Postgres matches the mirror node message.
 *   4. The newest anchored event's hash equals the newest message on HCS.
 *
 * Notes:
 *   - Topic order is not the audit order: submissions are asynchronous, so two events
 *     can land out of order, and a retry can republish an event. Those are reported
 *     separately and are not failures as long as the content matches.
 *   - Exits non-zero if a real mismatch is found, so it can run in CI or cron.
 *
 * Usage: npm run hedera:verify-audit
 */
import pg from "pg";
import { loadConfig } from "../apps/server/src/config.js";
import { loadEnvFile } from "../apps/server/src/env.js";
import { verifyAuditChain } from "@chargemesh/shared/node";

interface MirrorMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string;
  payer_account_id?: string;
  chunk_info?: { initial_transaction_id?: { account_id?: string; transaction_valid_start?: string } };
}

interface AnchoredPayload {
  v?: number;
  app?: string;
  id?: string;
  seq?: number;
  type?: string;
  at?: string;
  hash?: string;
  prevHash?: string;
}

const PAGE_LIMIT = 100;

async function fetchTopicMessages(baseUrl: string, topicId: string): Promise<MirrorMessage[]> {
  const messages: MirrorMessage[] = [];
  let url: string | null =
    `${baseUrl}/topics/${encodeURIComponent(topicId)}/messages?limit=${PAGE_LIMIT}&order=asc`;
  while (url) {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      throw new Error(`Mirror node ${response.status} for ${url}`);
    }
    const body = (await response.json()) as {
      messages?: MirrorMessage[];
      links?: { next?: string };
    };
    messages.push(...(body.messages ?? []));
    // links.next is a path like /api/v1/topics/... - resolve it against the mirror origin.
    url = body.links?.next ? new URL(body.links.next, baseUrl).toString() : null;
  }
  return messages;
}

function decode(message: MirrorMessage): AnchoredPayload | null {
  try {
    return JSON.parse(Buffer.from(message.message, "base64").toString("utf8")) as AnchoredPayload;
  } catch {
    return null;
  }
}

function transactionIdOf(message: MirrorMessage): string | undefined {
  const chunk = message.chunk_info?.initial_transaction_id;
  if (!chunk?.account_id || !chunk.transaction_valid_start) return undefined;
  return `${chunk.account_id}@${chunk.transaction_valid_start}`;
}

async function main() {
  loadEnvFile();
  const config = loadConfig();
  const databaseUrl = config.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const { rows } = await db.query("select data from audit.events order by seq asc");
  await db.end();
  const events = rows.map((row) => row.data);

  if (events.length === 0) {
    console.log("No audit events found - nothing to verify.");
    return;
  }

  const anchored = events.filter((event) => event.hedera);
  const unanchored = events.filter((event) => !event.hedera);

  const topicId = anchored[0]?.hedera?.topicId ?? config.hedera?.topicId ?? config.hederaTopicId;
  const network =
    anchored[0]?.hedera?.network ?? config.hedera?.network ?? config.hederaNetwork ?? "testnet";
  const mirrorBase = (
    config.hedera?.mirrorNodeUrl ??
    config.hederaMirrorNodeUrl ??
    "https://testnet.mirrornode.hedera.com/api/v1"
  ).replace(/\/$/, "");
  if (!topicId) throw new Error("HEDERA_TOPIC_ID is not set");

  const local = verifyAuditChain(events);
  const mirrorMessages = await fetchTopicMessages(mirrorBase, topicId);
  const byTopicSequence = new Map(
    mirrorMessages.map((message) => [String(message.sequence_number), message])
  );

  const missing: string[] = [];
  const mismatched: string[] = [];
  const badTransactionIds: string[] = [];

  for (const event of anchored) {
    const reference = event.hedera;
    const message = byTopicSequence.get(String(reference.sequenceNumber));
    if (!message) {
      missing.push(`${event.id} (event seq ${event.seq} -> HCS ${reference.sequenceNumber})`);
      continue;
    }
    const payload = decode(message);
    if (!payload) {
      mismatched.push(`${event.id}: HCS message is not valid JSON`);
      continue;
    }
    const fields: Array<[string, unknown, unknown]> = [
      ["id", payload.id, event.id],
      ["seq", payload.seq, event.seq],
      ["type", payload.type, event.type],
      ["at", payload.at, event.at],
      ["hash", payload.hash, event.hash],
      ["prevHash", payload.prevHash, event.prevHash]
    ];
    for (const [field, onChain, stored] of fields) {
      if (onChain !== stored) {
        mismatched.push(
          `${event.id}: ${field} differs (HCS ${JSON.stringify(onChain)} vs DB ${JSON.stringify(stored)})`
        );
      }
    }
    const onChainTx = transactionIdOf(message);
    if (onChainTx && reference.transactionId && onChainTx !== reference.transactionId) {
      badTransactionIds.push(`${event.id}: HCS ${onChainTx} vs DB ${reference.transactionId}`);
    }
  }

  // Messages on the topic that belong to the current chain, keyed by event id.
  const currentIds = new Set(events.map((event) => event.id));
  const submissionsById = new Map<string, number[]>();
  for (const message of mirrorMessages) {
    const payload = decode(message);
    if (!payload?.id || !currentIds.has(payload.id)) continue;
    submissionsById.set(payload.id, [...(submissionsById.get(payload.id) ?? []), message.sequence_number]);
  }
  const duplicates = [...submissionsById.entries()].filter(([, seqs]) => seqs.length > 1);

  // Out-of-order arrivals: compare the on-chain order of current events with DB seq order.
  const onChainEventOrder = mirrorMessages
    .map((message) => decode(message))
    .filter((payload): payload is AnchoredPayload => Boolean(payload?.id && currentIds.has(payload.id)))
    .map((payload) => payload.seq as number);
  let inversions = 0;
  for (let index = 1; index < onChainEventOrder.length; index += 1) {
    if (onChainEventOrder[index]! < onChainEventOrder[index - 1]!) inversions += 1;
  }

  const newestAnchored = anchored.at(-1);
  const newestMessage = newestAnchored
    ? byTopicSequence.get(String(newestAnchored.hedera.sequenceNumber))
    : undefined;
  const newestPayload = newestMessage ? decode(newestMessage) : null;
  const headMatchesChain = Boolean(newestPayload && newestPayload.hash === newestAnchored!.hash);

  const failures = [
    !local.valid ? `local chain invalid${local.brokenAt ? ` at ${local.brokenAt}` : ""}` : null,
    missing.length ? `${missing.length} event(s) missing from HCS` : null,
    mismatched.length ? `${mismatched.length} content mismatch(es)` : null,
    badTransactionIds.length ? `${badTransactionIds.length} transaction id mismatch(es)` : null,
    newestAnchored && !headMatchesChain ? "newest anchored hash does not match HCS" : null
  ].filter(Boolean) as string[];

  console.log("Local chain");
  console.log(`  events            ${events.length} (seq ${events[0].seq} -> ${events.at(-1).seq})`);
  console.log(`  valid             ${local.valid ? "yes" : "NO"}`);
  console.log(`  head hash         ${local.headHash}`);

  console.log("\nHedera HCS");
  console.log(`  network           ${network}`);
  console.log(`  topic             ${topicId}`);
  console.log(
    `  topic messages    ${mirrorMessages.length} (seq ${mirrorMessages[0]?.sequence_number} -> ${mirrorMessages.at(-1)?.sequence_number})`
  );
  console.log(`  anchored events   ${anchored.length} / ${events.length}`);
  console.log(`  missing on HCS    ${missing.length}`);
  console.log(`  content match     ${mismatched.length === 0 ? "all identical" : `${mismatched.length} mismatch(es)`}`);
  console.log(`  tx id match       ${badTransactionIds.length === 0 ? "all identical" : `${badTransactionIds.length} mismatch(es)`}`);
  console.log(`  newest == on chain ${newestAnchored ? (headMatchesChain ? "yes" : "NO") : "n/a"}`);
  if (newestMessage && newestPayload) {
    console.log(
      `  newest anchored   event seq ${newestPayload.seq} @ topic ${newestMessage.sequence_number} (${newestMessage.consensus_timestamp})`
    );
  }
  console.log(
    `  topic extras      ${mirrorMessages.length - anchored.length} message(s) not referenced by this DB ` +
      `(${duplicates.length} duplicate re-submission(s), rest is earlier history)`
  );
  console.log(`  arrival order     ${inversions === 0 ? "matches chain order" : `${inversions} out-of-order pair(s), harmless`}`);

  if (unanchored.length) {
    console.log(`\nAwaiting anchoring (${unanchored.length}), newest first:`);
    for (const event of unanchored.slice(-5).reverse()) {
      console.log(`  seq ${event.seq} ${event.type} (${event.hederaStatus ?? "unset"})`);
    }
  }
  for (const line of [...missing, ...mismatched, ...badTransactionIds]) {
    console.log(`  ! ${line}`);
  }

  console.log(`\nView on the mirror node:\n  ${mirrorBase}/topics/${topicId}/messages?limit=25&order=desc`);

  if (failures.length) {
    console.log(`\nRESULT: FAILED - ${failures.join("; ")}`);
    process.exitCode = 1;
  } else if (unanchored.length) {
    console.log(
      `\nRESULT: VERIFIED - all ${anchored.length} anchored events match Hedera HCS; ` +
        `${unanchored.length} event(s) still awaiting anchoring.`
    );
  } else {
    console.log(`\nRESULT: VERIFIED - all ${events.length} events match Hedera HCS.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
