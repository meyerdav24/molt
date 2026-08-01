import { Disclaimers } from '../components/disclaimers';

export default function Home() {
  return (
    <main
      style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Molt</h1>
      <p>
        Delegate bounded spending to an AI agent. For every purchase the agent grows a disposable
        shell, wears it once, and sheds it. It never touches your real card.
      </p>
      <p>Pre-release scaffold. The full landing page is built in a later phase.</p>
      <Disclaimers />
    </main>
  );
}
