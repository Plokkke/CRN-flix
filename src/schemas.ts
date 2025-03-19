import { DateTime } from 'luxon';
import { z } from 'zod';

export const isoDateSchema = z
  .string()
  .transform((value) => DateTime.fromISO(value))
  .refine((value) => value.isValid);
