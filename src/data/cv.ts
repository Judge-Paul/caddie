export type CvExperience = {
  company: string
  role: string
  period: string
  location: string
  bullets: string[]
}

export type CvProject = {
  name: string
  description: string
  tech: string
}

export type CvProfile = {
  name: string
  role: string
  contact: string[]
  summary: string
  experience: CvExperience[]
  projects: CvProject[]
  education: { school: string; degree: string; period: string }[]
  skillGroups: { label: string; items: string }[]
  languages: string
}

export const cv: CvProfile = {
  name: 'Ava Chen',
  role: 'Senior Frontend Engineer',
  contact: [
    'ava.chen@hey.com',
    '+49 30 5550 1182',
    'Berlin, Germany',
    'linkedin.com/in/avachen',
    'avachen.dev',
  ],
  summary:
    'Frontend engineer with eight years of experience shipping design systems and data-heavy product interfaces. I care about accessible defaults, fast first paint, and the small interaction details that make software feel considered.',
  experience: [
    {
      company: 'Northwind Labs',
      role: 'Senior Frontend Engineer',
      period: '2021 — Present',
      location: 'Berlin, Germany',
      bullets: [
        'Led the rebuild of the design system in React and TypeScript: 48 components, adopted by six product teams.',
        'Cut largest contentful paint by 42% with route-level code splitting, image optimisation and a smaller bundle budget.',
        'Built accessible data tables and filters used across the analytics suite, meeting WCAG 2.1 AA.',
      ],
    },
    {
      company: 'Kite Health',
      role: 'Frontend Engineer',
      period: '2018 — 2021',
      location: 'Amsterdam, Netherlands',
      bullets: [
        'Shipped a patient scheduling app in Next.js serving 120k monthly users across web and mobile web.',
        'Rebuilt onboarding with the design team, lifting activation by 18% in the first quarter.',
        'Introduced an end-to-end Playwright suite that reduced release regressions by 60%.',
      ],
    },
    {
      company: 'Studio Fathom',
      role: 'UI Developer',
      period: '2016 — 2018',
      location: 'Rotterdam, Netherlands',
      bullets: [
        'Delivered marketing sites and CMS themes for 20+ clients, working directly with designers.',
        'Built the studio component library, cutting new project setup from two weeks to two days.',
      ],
    },
  ],
  projects: [
    {
      name: 'Atlas',
      description:
        'Open-source headless table for React. Virtualised rows, keyboard-first navigation, 1.4k GitHub stars.',
      tech: 'React · TypeScript · TanStack',
    },
    {
      name: 'Chromatic Notes',
      description:
        'Offline-first note taking PWA with local search and conflict-free sync.',
      tech: 'Vite · IndexedDB · Web Workers',
    },
  ],
  education: [
    {
      school: 'TU Delft',
      degree: 'BSc Computer Science',
      period: '2012 — 2016',
    },
  ],
  skillGroups: [
    {
      label: 'Code',
      items: 'TypeScript, JavaScript, HTML, CSS, SQL',
    },
    {
      label: 'Frameworks',
      items: 'React, Next.js, Remix, Tailwind CSS, Storybook',
    },
    {
      label: 'Tools',
      items: 'Vite, Playwright, Vitest, Figma, Git, GitHub Actions',
    },
    {
      label: 'Practices',
      items: 'Design systems, accessibility, web performance, testing',
    },
  ],
  languages: 'English (native) · Dutch (fluent) · German (B2)',
}
