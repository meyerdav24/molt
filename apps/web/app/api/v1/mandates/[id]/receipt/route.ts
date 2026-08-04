import { createPublicKey, verify as edVerify } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  canonicalJson,
  countersignReceiptAsTa,
  type ReceiptBody,
  type SignedReceipt,
} from '@molt/protocol';
import { authenticateAgent } from '../../../../../../lib/agent-auth';
import { cancelCardForMandate } from '../../../../../../lib/cards';
import { db } from '../../../../../../lib/db';
import { taSigningKey } from '../../../../../../lib/ta-key';

export const runtime = 'nodejs';

/** What the agent sends: the receipt body it signed, plus signature + key. */
interface FileReceiptRequest {
  receipt: ReceiptBody;
  agent_signature: string;
  /** SPKI PEM of the agent key that signed the body. */
  agent_public_key: string;
}

const RUNGS = ['L0', 'L1', 'L2', 'L3'];
const RAILS = ['card_stripe_test', 'usdc_x402_testnet'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Agent clock sanity window for created_at, in ms. */
const CREATED_AT_WINDOW_MS = 10 * 60 * 1000;

function verifyAgentSignature(body: ReceiptBody, signatureB64: string, spkiPem: string): boolean {
  try {
    const key = createPublicKey(spkiPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return edVerify(
      null,
      Buffer.from(canonicalJson(body), 'utf8'),
      key,
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}

/**
 * File a dual-signed receipt for a consumed mandate (OT-025 + OT-060).
 *
 * The agent generates id + created_at and signs the canonical body, because
 * the signature must cover the exact document that gets stored; the TA
 * verifies the agent signature, enforces the mandate constraints (amount
 * within mandate, merchant matching scope, idempotency unique, mandate
 * consumed exactly once), countersigns body + agent signature, and returns
 * the complete SignedReceipt - verifiable offline via `molt verify`.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = (await req.json().catch(() => null)) as FileReceiptRequest | null;
  const body = parsed?.receipt;
  if (
    !body ||
    typeof parsed.agent_signature !== 'string' ||
    typeof parsed.agent_public_key !== 'string' ||
    !UUID_RE.test(body.id ?? '') ||
    !RUNGS.includes(body.rung) ||
    !RAILS.includes(body.rail) ||
    !body.merchant ||
    !Number.isSafeInteger(body.amount_minor) ||
    body.amount_minor <= 0 ||
    !body.idempotency_key ||
    !Array.isArray(body.mandate_chain) ||
    typeof body.created_at !== 'string'
  ) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const createdAt = Date.parse(body.created_at);
  if (Number.isNaN(createdAt) || Math.abs(Date.now() - createdAt) > CREATED_AT_WINDOW_MS) {
    return NextResponse.json({ error: 'created_at_out_of_window' }, { status: 422 });
  }

  const sql = db();
  const [mandate] = await sql<
    {
      id: string;
      tab_id: string;
      parent_id: string;
      status: string;
      amount_minor: string;
      currency: string;
      merchant_scope: string;
    }[]
  >`select id, tab_id, parent_id, status, amount_minor, currency, merchant_scope
    from mandates where id = ${params.id} and kind = 'child'`;
  if (!mandate || mandate.tab_id !== agent.tab_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (mandate.status !== 'active' && mandate.status !== 'approved') {
    return NextResponse.json(
      { error: 'mandate_not_usable', status: mandate.status },
      { status: 409 },
    );
  }

  // The signed body must state exactly what the TA knows to be true.
  if (body.tab_id !== mandate.tab_id || body.mandate_id !== mandate.id) {
    return NextResponse.json({ error: 'body_mandate_mismatch' }, { status: 422 });
  }
  if (body.amount_minor > Number(mandate.amount_minor)) {
    return NextResponse.json({ error: 'amount_exceeds_mandate' }, { status: 422 });
  }
  if (body.merchant !== mandate.merchant_scope) {
    return NextResponse.json({ error: 'merchant_outside_mandate_scope' }, { status: 422 });
  }
  if (body.currency !== mandate.currency) {
    return NextResponse.json({ error: 'currency_mismatch' }, { status: 422 });
  }
  const expectedChain = [mandate.parent_id, mandate.id];
  if (
    body.mandate_chain.length !== expectedChain.length ||
    body.mandate_chain.some((m, i) => m !== expectedChain[i])
  ) {
    return NextResponse.json({ error: 'mandate_chain_mismatch' }, { status: 422 });
  }

  if (!verifyAgentSignature(body, parsed.agent_signature, parsed.agent_public_key)) {
    return NextResponse.json({ error: 'agent_signature_invalid' }, { status: 422 });
  }

  let ta;
  try {
    ta = taSigningKey();
  } catch (e) {
    // Fail closed: an unverifiable receipt is not a receipt.
    return NextResponse.json(
      { error: 'ta_key_unavailable', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
  const taSignature = countersignReceiptAsTa(body, parsed.agent_signature, ta.privatePem);

  const signed: SignedReceipt = {
    ...body,
    agent_signature: parsed.agent_signature,
    ta_signature: taSignature,
    agent_public_key: parsed.agent_public_key,
    ta_public_key: ta.publicPem,
  };

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into receipts
          (id, tab_id, mandate_id, rung, rail, merchant, amount_minor, currency,
           evidence, idempotency_key, mandate_chain,
           agent_signature, ta_signature, agent_public_key, ta_public_key, created_at)
        values
          (${body.id}, ${mandate.tab_id}, ${mandate.id}, ${body.rung}, ${body.rail},
           ${body.merchant}, ${body.amount_minor}, ${body.currency},
           ${tx.json((body.evidence ?? {}) as never)}, ${body.idempotency_key},
           ${tx.json(expectedChain)},
           ${parsed.agent_signature}, ${taSignature}, ${parsed.agent_public_key},
           ${ta.publicPem}, ${body.created_at})`;
      await tx`update mandates set status = 'consumed' where id = ${mandate.id}`;
      await tx`
        insert into events (tab_id, mandate_id, user_id, actor, type, payload)
        values (${mandate.tab_id}, ${mandate.id}, ${agent.user_id}, 'agent', 'receipt.filed',
                ${tx.json({ receipt_id: body.id, rung: body.rung, rail: body.rail, amount_minor: body.amount_minor })})`;
    });
    // The shell is worn: shed it now. Waiting for the settlement webhook
    // would leave a live card behind whenever the rail does not produce one
    // (and "worn once, then shed" is the claim, not "shed eventually").
    // Outside the transaction: the Stripe call must not hold DB locks.
    try {
      await cancelCardForMandate(mandate.id);
    } catch {
      // the sweep and the card's own TTL still bound this; the receipt stands
    }

    return NextResponse.json({ ok: true, receipt: signed }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    if (message.includes('idempotency_key')) {
      return NextResponse.json({ error: 'duplicate_idempotency_key' }, { status: 409 });
    }
    if (message.includes('receipts_pkey')) {
      return NextResponse.json({ error: 'duplicate_receipt_id' }, { status: 409 });
    }
    return NextResponse.json({ error: 'receipt_failed' }, { status: 500 });
  }
}
