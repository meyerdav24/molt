/**
 * Agent wallet CLI (OT-112): `molt-wallet init | address | balance`.
 *
 * Non-custodial (G4): the key is generated here, on the operator's machine,
 * encrypted at rest, and never uploaded anywhere. The passphrase comes from
 * MOLT_WALLET_PASSPHRASE or an interactive prompt.
 */
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initWallet, usdcBalance, walletAddress } from '@molt/adapters';

const path = process.env.MOLT_WALLET_PATH ?? join(homedir(), '.molt', 'wallet.json');

async function passphrase(): Promise<string> {
  const fromEnv = process.env.MOLT_WALLET_PASSPHRASE;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    throw new Error('set MOLT_WALLET_PASSPHRASE or run interactively');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('wallet passphrase (min 8 chars, remember it): ');
  rl.close();
  return answer;
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case 'init': {
      const { address } = initWallet(path, await passphrase());
      console.log(`wallet created: ${path} (mode 600, encrypted at rest)`);
      console.log(`address: ${address}`);
      console.log(
        'fund it with testnet USDC: https://faucet.circle.com -> Base Sepolia -> paste the address',
      );
      console.log('then check: pnpm wallet:balance');
      return;
    }
    case 'address': {
      console.log(walletAddress(path));
      return;
    }
    case 'balance': {
      const address = walletAddress(path);
      const minor = await usdcBalance(address, process.env.BASE_SEPOLIA_RPC_URL);
      console.log(`${address}: ${(Number(minor) / 1e6).toFixed(2)} USDC (Base Sepolia testnet)`);
      return;
    }
    default:
      console.error('usage: molt-wallet <init|address|balance>');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`molt-wallet: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
