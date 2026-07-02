import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Please provide a valid email address').toLowerCase().trim(),
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
