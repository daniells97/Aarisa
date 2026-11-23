import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { sendPasswordReset } from './password-reset';

export const requestPasswordReset = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().email().max(200) }))
  .handler(({ data }) => {
    void sendPasswordReset(data.email).catch((e) => console.error('[password reset] failed:', e));
    return { ok: true };
  });
