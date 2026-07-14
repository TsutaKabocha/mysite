import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const diary = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/diary' }),
  schema: z.object({
    title: z.string(),
    yearMonth: z.string(), // "2026-07" 形式
    description: z.string().optional(),
  }),
});

export const collections = { diary };
