import { SECTORS } from '../../shared/jd-classification'

/**
 * One schema for every company page. Optional fields mean a directory page can
 * return founders and stage, while the company's own site returns the summary
 * and relevant experience signals.
 */
export const COMPANY_PAGE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'One or two factual sentences about what the company builds. Only if stated on the page.',
    },
    sectors: {
      type: 'array',
      description:
        'What the product is, up to four. Only sectors supported by the page.',
      items: { type: 'string', enum: [...SECTORS] },
    },
    founders: {
      type: 'array',
      description: 'People the page names as founders, with their role if stated.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
        },
        required: ['name'],
      },
    },
    stage: {
      type: 'string',
      description:
        'Accelerator batch or funding stage only if stated, e.g. "YC W26" or "Series A".',
    },
    funding: {
      type: 'string',
      description: 'Funding amount, investors or backers only if stated.',
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['url'],
      },
    },
    signals: {
      type: 'array',
      description:
        'Relevant experience areas a CV for an engineering role could show, grounded in this page. Two or three at most.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          terms: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['label', 'terms'],
      },
    },
  },
} as const
