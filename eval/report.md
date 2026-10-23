# JD classification eval

Generated 2026-10-23T18:51:17.058Z · 1 run(s) per posting.

## Scoreboard

| model | model id | cases | fields | must recall | nice recall | mix-ups | anyOf F1 | invented terms | mean latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemma | `@cf/google/gemma-4-26b-a4b-it` | 5/5 | 100% | 95% | 100% | 0 | 93% | 1 | 29986 ms |
| jev | `—` | 0/1 | 0% | 0% | 0% | 0 | 0% | 0 | 0 ms |

## Unavailable models

- jev: This model needs Cloudflare credits on the account (or a BYOK key) before it can run.

## Per posting

### frontend-saas · gemma

- fields: family frontend, seniority senior, mode remote, domain saas
- must recall 100%, nice recall 100%, anyOf F1 100%
- 24 requirements · 55205 ms · 1 call(s)

### mobile-alternatives · gemma

- fields: family mobile, seniority mid, mode hybrid, domain fintech
- must recall 100%, nice recall 100%, anyOf F1 67%
- either-or groups not in the posting: Fintech or banking experience
- 8 requirements · 13497 ms · 1 call(s)

### backend-contract · gemma

- fields: family backend, seniority senior, mode remote, domain fintech
- must recall 100%, nice recall 100%, anyOf F1 100%
- 15 requirements · 29358 ms · 1 call(s)

### design-health · gemma

- fields: family design, seniority mid, mode hybrid, domain health
- must recall 75%, nice recall 100%, anyOf F1 100%
- missing must: design system
- 12 requirements · 29853 ms · 1 call(s)

### agency-freelance · gemma

- fields: family frontend, seniority unspecified, mode remote, domain agency
- must recall 100%, nice recall 100%, anyOf F1 100%
- terms not in the posting: mobile responsiveness
- 8 requirements · 22016 ms · 1 call(s)

### frontend-saas · jev

Failed: This model needs Cloudflare credits on the account (or a BYOK key) before it can run.

## How this is scored

- **fields**: role family, seniority, work mode and domain against each posting's label.
- **must / nice recall**: how much of the labelled core of requirements was found, with phrase-tolerant matching ("modern CSS" satisfies "CSS"). Recall is used instead of precision because the labels cover the important requirements, not every clause.
- **mix-ups**: labelled nice-to-haves presented as required, and the reverse. This is the cost of over-extraction.
- **anyOf F1**: either-or groups compared as whole sets, so splitting "React Native or Kotlin" into two requirements loses points, as does inventing one.
- **invented terms**: extracted terms that do not appear in the posting text at all.
- Price is not part of the score.

