import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { marked } from 'marked';

export const metadata = { title: 'Protocol spec - Molt' };
export const runtime = 'nodejs';

/**
 * Renders SPEC.md, the protocol document. Statically generated at build
 * time (OT-102: an HN hug hits cached HTML, not a per-request markdown
 * parse); the repo root copy is the single source of truth.
 */
async function loadSpec(): Promise<string | null> {
  const candidates = [
    join(process.cwd(), '../../SPEC.md'), // pnpm dev from apps/web
    join(process.cwd(), 'SPEC.md'), // docker standalone workdir
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      // try the next location
    }
  }
  return null;
}

export default async function SpecPage() {
  const spec = await loadSpec();
  if (!spec) {
    return (
      <p>
        SPEC.md was not found in this deployment. The canonical copy lives in the repository root:{' '}
        <a href="https://github.com/meyerdav24/molt/blob/main/SPEC.md">SPEC.md</a>.
      </p>
    );
  }
  const html = await marked.parse(spec);
  return (
    <div
      // SPEC.md is repository-controlled content, not user input
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ overflowWrap: 'break-word' }}
    />
  );
}
