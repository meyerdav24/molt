#!/usr/bin/env node
/**
 * `molt verify receipt.json` (OT-060).
 *
 * Offline verification: reads the receipt document, verifies both signatures
 * against the public keys carried in the file (or passed explicitly), and
 * prints one line. Exit code 0 = valid, 1 = invalid.
 */
import { readFileSync } from 'node:fs';
import { verifyReceipt } from './receipt.js';
import type { Receipt } from './types.js';

interface FileShape extends Receipt {
  agent_public_key?: string;
  ta_public_key?: string;
}

function usage(): never {
  process.stderr.write(
    'usage: molt verify <receipt.json> [--agent-key <file.pem>] [--ta-key <file.pem>]\n',
  );
  process.exit(2);
}

function main(argv: string[]): number {
  const [command, file, ...rest] = argv;
  if (command !== 'verify' || !file) usage();

  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (key && value) flags.set(key, value);
  }

  let receipt: FileShape;
  try {
    receipt = JSON.parse(readFileSync(file, 'utf8')) as FileShape;
  } catch (e) {
    process.stderr.write(`✗ cannot read receipt: ${e instanceof Error ? e.message : e}\n`);
    return 1;
  }

  const agentKeyFile = flags.get('--agent-key');
  const taKeyFile = flags.get('--ta-key');
  const agentKey = agentKeyFile ? readFileSync(agentKeyFile, 'utf8') : receipt.agent_public_key;
  const taKey = taKeyFile ? readFileSync(taKeyFile, 'utf8') : receipt.ta_public_key;

  if (!agentKey || !taKey) {
    process.stderr.write(
      '✗ missing public keys: the receipt carries no keys and none were passed\n',
    );
    return 1;
  }

  const result = verifyReceipt(receipt, { agent_public_key: agentKey, ta_public_key: taKey });

  if (result.valid) {
    // The molt storyline, one line (demo/VOCAB.md).
    process.stdout.write('✓ receipt valid — shell was grown, worn once, and shed\n');
    return 0;
  }

  process.stdout.write('✗ receipt invalid\n');
  for (const problem of result.problems) process.stdout.write(`  - ${problem}\n`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
