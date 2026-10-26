import type { ProfileKey } from '../server/apply/map'

export type ApplyExpectation = {
  /** Lowercase substring matched against the mapped field label. */
  match: string
  /** Which 1-based same-label match, for repeated labels like file uploads. */
  occurrence?: number
  key: ProfileKey | null
  note?: string
}

export type ApplyCase = {
  id: string
  ats: string
  url: string
  expected: ApplyExpectation[]
}

const NOTHING = null

export const applyCases: ApplyCase[] = [
  {
    id: 'autter-custom',
    ats: 'custom',
    url: 'https://autter.dev/careers/frontend-engineer',
    expected: [
      { match: 'enter first name', key: 'name' },
      { match: 'enter last name', key: 'name' },
      { match: 'enter your email', key: 'email' },
      { match: 'enter your phone', key: 'phone' },
      { match: 'linkedin.com', key: 'linkedin' },
      { match: 'resume', key: 'cv_file' },
      { match: 'coverletter', key: 'cover_letter_file' },
      { match: 'something that isn', key: NOTHING, note: 'free-text custom question' },
      { match: 'seen autter', key: NOTHING },
      { match: 'want to own', key: NOTHING },
      { match: 'hasexplored', key: NOTHING },
      { match: 'terms', key: NOTHING, note: 'consent checkbox, checked not mapped' },
    ],
  },
  {
    id: 'greenhouse-intercom',
    ats: 'greenhouse',
    url: 'https://job-boards.greenhouse.io/intercom/jobs/7824137',
    expected: [
      { match: 'first name', key: 'name' },
      { match: 'last name', key: 'name' },
      { match: 'email', key: 'email' },
      { match: 'country', key: 'country' },
      { match: 'phone', key: 'phone' },
      { match: 'attach', occurrence: 1, key: 'cv_file' },
      { match: 'attach', occurrence: 2, key: 'cover_letter_file' },
      { match: 'authorised to work', key: 'authorization' },
      { match: 'current location', key: 'address' },
      { match: 'willing to relocate', key: NOTHING },
    ],
  },
  {
    id: 'lever-zoox',
    ats: 'lever',
    url: 'https://jobs.lever.co/zoox/2aa94106-52ac-4f67-871b-1140f8644ea4/apply',
    expected: [
      { match: 'resume/cv', key: 'cv_file' },
      { match: 'full name', key: 'name' },
      { match: 'he/him', key: NOTHING, note: 'pronouns are not EEO gender' },
      { match: 'use name only', key: NOTHING },
      { match: 'email', key: 'email' },
      { match: 'phone', key: 'phone' },
      { match: 'current location', key: 'address' },
      { match: 'current company', key: NOTHING, note: 'no employment-history key' },
      { match: 'linkedin url', key: 'linkedin' },
      { match: 'other website', key: NOTHING, note: 'one stored URL must not repeat' },
      { match: 'cards[', key: NOTHING, note: 'opaque custom question id' },
      { match: 'gender / select', key: 'eeoGender' },
      { match: 'race / select', key: 'eeoRace' },
      { match: 'veteran status', key: 'eeoVeteran' },
      { match: 'zoox ads', key: NOTHING, note: 'how-heard source checkbox' },
      { match: 'type your response', key: NOTHING, note: 'label-less custom question' },
    ],
  },
  {
    id: 'ashby-bubble',
    ats: 'ashby',
    url: 'https://jobs.ashbyhq.com/bubble/6321b27c-b549-476e-9a75-5f5dede7ab57',
    expected: [
      { match: 'name', key: 'name' },
      { match: 'email', key: 'email' },
      { match: 'resume', key: 'cv_file' },
      { match: 'phone', key: 'phone' },
      { match: 'cover letter', key: 'cover_letter_file' },
      { match: 'linkedin profile', key: 'linkedin' },
      { match: 'file upload', key: NOTHING, note: 'generic upload, ambiguous target' },
    ],
  },
  {
    id: 'workable-albireo',
    ats: 'workable',
    url: 'https://jobs.workable.com/view/ricLtyMJjtBd1JG28nv9my/bms-controls-engineer-in-sheffield-at-albireo-energy',
    expected: [
      { match: 'first name', key: 'name' },
      { match: 'last name', key: 'name' },
      { match: 'email', key: 'email' },
      { match: 'phone', key: 'phone' },
      { match: 'city', key: 'city' },
      { match: 'state', key: null, note: 'no state-level key exists; a human fills it' },
      { match: 'resume', key: 'cv_file' },
    ],
  },
]
