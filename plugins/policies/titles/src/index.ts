import { z } from 'zod';

import { MESSAGE_FIELD, noticeOf, PolicyKind } from '@crn-flix/contracts';

export const titlesParamsSchema = z.object({ message: z.string().optional() });

export const titleEntrySchema = z.object({
  imdbId: z.string().regex(/^tt\d+$/),
  title: z.string().min(1),
  reason: z.string().min(1),
});

export type TitlesParams = z.infer<typeof titlesParamsSchema>;
export type TitleEntry = z.infer<typeof titleEntrySchema>;

/** Refuses the titles listed by name, each with its own reason: no general criterion behind it. */
export const titlesPolicy: PolicyKind<TitlesParams, TitleEntry> = {
  name: 'titles',
  description: 'Refuse les titres de la liste, chacun avec son motif.',
  scope: 'content',
  params: { schema: titlesParamsSchema, fields: [MESSAGE_FIELD] },
  entries: {
    key: 'media',
    schema: titleEntrySchema,
    fields: [{ name: 'reason', label: 'Motif (montré à l’utilisateur)', type: 'textarea' }],
  },
  evaluate(subject, { params, entries }) {
    return entries
      .filter((entry) => entry.imdbId === subject.imdbId)
      .map((entry) => ({
        summary: `Titre exclu : ${entry.reason}`,
        notice: noticeOf('Ce titre n’est pas proposé sur le service', params.message, [
          { type: 'paragraph', text: entry.reason },
        ]),
      }));
  },
};
