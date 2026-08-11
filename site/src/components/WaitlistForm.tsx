import { useState, type FormEvent } from 'react';
import { joinWaitlist, type WaitlistResult } from '../api/waitlist';
// pulseSeam wiring removed with the seam (see App.tsx) — if the seam returns
// redesigned, the submit-pulse hook re-attaches here, on the attempt.

type Status = 'idle' | 'loading' | WaitlistResult['status'];

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('loading');
    const result = await joinWaitlist(email);
    setStatus(result.status);
    setMessage(result.message);
    if (result.status === 'success') setEmail('');
  }

  return (
    <div className="plaque">
      <h3>The doors aren't open yet.</h3>
      <p>
        Leave your email and you'll hear the knock first. One email at launch, no more. Goblins
        don't spam; it's beneath us.
      </p>
      <form onSubmit={handleSubmit}>
        <label className="mono" htmlFor="waitlist-email">
          YOUR EMAIL
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          placeholder="dm@yourtable.com"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'loading'}
          aria-invalid={status === 'error'}
          aria-describedby="waitlist-status"
        />
        <button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Knocking…' : 'Knock'}
        </button>
      </form>
      <p id="waitlist-status" className="waitlist-status" role="status" aria-live="polite" data-status={status}>
        {message}
      </p>
    </div>
  );
}
