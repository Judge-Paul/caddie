import type { Domain, RoleFamily, Seniority, WorkMode } from '../shared/jd-classification'

export type Expectation = {
  family?: RoleFamily
  seniority?: Seniority
  mode?: WorkMode
  domain?: Domain
  employment?: string
  titleIncludes?: string
  /** Terms that must appear as required, including members of anyOf groups. */
  must?: string[]
  nice?: string[]
  /** Either-or groups that must be recognised as alternatives. */
  anyOf?: string[][]
}

export type EvalCase = {
  id: string
  note: string
  jd: string
  expect: Expectation
}

export const cases: EvalCase[] = [
  {
    id: 'frontend-saas',
    note: 'Dense posting with a mixed and/or list and a clear nice-to-have section',
    jd: `Senior Frontend Engineer — Nebula Analytics
Remote (EU) · Full-time

About the role
Nebula Analytics builds a real-time product analytics platform used by 2,000+ data teams. We are looking for a Senior Frontend Engineer to own our dashboard experience end to end, from interaction design through to performance in production.

What you will do
- Build polished interfaces in React and TypeScript, with a strong bias toward accessibility and keyboard support.
- Extend our design system and help product teams adopt it consistently.
- Own performance: profiling, bundle budgeting and rendering strategy for dense data views.
- Work with GraphQL and Apollo Client to shape the data layer alongside backend engineers.
- Collaborate with product and design in a small, senior team.

What we are looking for
- 5+ years of professional frontend experience, ideally on B2B SaaS products.
- Deep knowledge of TypeScript, modern React and browser APIs.
- Experience with Next.js and server-side rendering.
- Familiarity with Node.js services and deploying to AWS with Docker and Kubernetes.
- Strong visual craft: typography, spacing and motion should be second nature.
- Experience with data visualisation libraries such as D3 or WebGL.
- Comfortable running A/B tests and reading product analytics.

Nice to have
- Experience with Figma and design tokens.
- Exposure to Rust or WebAssembly.
- Prior work in a startup environment.

We review applications on a rolling basis and aim to reply within one week. Nebula Analytics is an equal opportunity employer.`,
    expect: {
      family: 'frontend',
      seniority: 'senior',
      mode: 'remote',
      domain: 'saas',
      employment: 'Full-time',
      titleIncludes: 'Frontend',
      must: ['React', 'TypeScript', 'Next.js', 'Node.js', 'AWS', 'Docker', 'Kubernetes', 'GraphQL', 'A/B testing'],
      nice: ['Figma', 'design tokens', 'startup'],
      anyOf: [
        ['D3', 'WebGL'],
        ['Rust', 'WebAssembly'],
      ],
    },
  },
  {
    id: 'mobile-alternatives',
    note: 'Explicit "or" hiring line that must stay one either-or requirement',
    jd: `Mobile Product Engineer — Lumen Bank
Berlin (hybrid) · Full-time

Lumen Bank is building a mobile-first current account for freelancers across Europe. Four hundred thousand people run their business on it, and most of them only ever see us through the app.

What you will do
- Ship features in our React Native app, from idea through release.
- Work with our Kotlin module for the Android share sheet and background sync.
- Pair with design on interaction detail: gestures, transitions, empty states.
- Keep releases boring: crash budgets, offline handling, analytics.

What we are looking for
- 3+ years building mobile apps, in either React Native or Kotlin. We hire for one of them, not both.
- Solid understanding of iOS and Android platform conventions.
- Experience with offline-first data and state management.
- Comfortable shipping weekly and reading a crash report.

Nice to have
- Fintech or banking experience.
- German at B1 or better.
- Experience with SwiftUI.

We are a team of nine. You will be the third mobile engineer.`,
    expect: {
      family: 'mobile',
      seniority: 'mid',
      mode: 'hybrid',
      domain: 'fintech',
      employment: 'Full-time',
      titleIncludes: 'Mobile',
      must: ['React Native', 'Kotlin', 'iOS', 'Android', 'offline-first data'],
      nice: ['Fintech', 'German', 'SwiftUI'],
      anyOf: [['React Native', 'Kotlin']],
    },
  },
  {
    id: 'backend-contract',
    note: 'Contract role with Go/Rust alternatives and an all-of platform list',
    jd: `Senior Backend Engineer — Tide Ledger
Remote (UK) · Contract, 12 months

Tide Ledger reconciles payments for marketplaces. We process about forty million ledger entries a day and we are rebuilding the settlement service.

The work
- Own the settlement service from schema to deployment.
- Write production Go or Rust. Our newer services are Rust, the older ones are Go, and you will touch both codebases, so we will take you on strength in either.
- Model double-entry ledgers on PostgreSQL, with Redis for hot balances.
- Deploy on Kubernetes through GitHub Actions; we run on AWS.
- Design event-driven flows with Kafka and keep the audit trail exact.

What you bring
- 6+ years of backend experience, including at least two on payments or ledgers.
- Fluency with PostgreSQL and Redis.
- Comfortable owning production: on-call, incident review, migrations.

Nice to have
- Terraform and platform engineering experience.
- Experience with ISO 20022 or SEPA formats.

Interviews are two technical conversations and a paid exercise.`,
    expect: {
      family: 'backend',
      seniority: 'senior',
      mode: 'remote',
      domain: 'fintech',
      employment: 'Contract',
      titleIncludes: 'Backend',
      must: ['Go', 'Rust', 'PostgreSQL', 'Redis', 'Kubernetes', 'AWS', 'Kafka'],
      nice: ['Terraform', 'ISO 20022'],
      anyOf: [
        ['Go', 'Rust'],
        ['ISO 20022', 'SEPA'],
        ['payments', 'ledgers'],
      ],
    },
  },
  {
    id: 'design-health',
    note: 'Non-engineering role: seniority from the title, soft skills, no tech stack',
    jd: `Product Designer (Mid-level) — Kite Health
Amsterdam · Hybrid, three days a week

Kite Health runs appointment scheduling for small clinics. We are looking for a product designer to own the patient-facing scheduling flow and the design system it is built on.

You will
- Own end-to-end design for scheduling: research, wireframes, prototypes, polish.
- Maintain and extend our design system in Figma, including tokens and component documentation.
- Run usability sessions with clinic staff every other week.
- Work directly with two engineers; we do not have a hand-off process.

You have
- At least three years designing product interfaces for the web.
- A portfolio showing interaction design decisions you can explain.
- Strong typography and layout craft.
- Comfort with user research and turning findings into requirements.
- Working proficiency in English; Dutch is not required.

Nice to have
- Motion design or prototyping with code.
- Experience in healthcare or another regulated domain.

We hire on a portfolio review and one conversation.`,
    expect: {
      family: 'design',
      seniority: 'mid',
      mode: 'hybrid',
      domain: 'health',
      employment: 'Full-time',
      titleIncludes: 'Designer',
      must: ['Figma', 'design system', 'user research', 'typography'],
      nice: ['Motion design', 'prototyping', 'healthcare'],
      anyOf: [
        ['Motion design', 'prototyping'],
        ['healthcare', 'regulated domain'],
      ],
    },
  },
  {
    id: 'agency-freelance',
    note: 'Short, loosely structured studio post: sparse signals, slash notation',
    jd: `Frontend Developer (React or Vue) — Northlight Studio
Remote · Freelance

We are a four-person studio shipping marketing sites and web apps for climate clients. We need a frontend developer for the next six months, with the option to continue.

You will build sites from Figma files, mostly in React or Vue (we use both, pick the one you are best at), TypeScript and modern CSS. You will talk to clients directly, so clear writing matters.

We care about accessibility, sensible page weight and sites that still work on a phone.

Rate is £450–£550 a day depending on experience. Start as soon as possible.`,
    expect: {
      family: 'frontend',
      seniority: 'unspecified',
      mode: 'remote',
      domain: 'agency',
      employment: 'Freelance',
      must: ['React', 'Vue', 'TypeScript', 'CSS', 'Figma', 'accessibility'],
      nice: [],
      anyOf: [['React', 'Vue']],
    },
  },
]
