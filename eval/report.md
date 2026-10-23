# JD classification eval

Generated 2026-10-23T21:37:30.707Z · 1 run(s) per posting.

## Scoreboard

| model | model id | cases | fields | must recall | nice recall | mix-ups | anyOf F1 | invented terms | mean latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemma | `@cf/google/gemma-4-26b-a4b-it` | 5/5 | 95% | 93% | 100% | 0 | 93% | 3 | 36109 ms |

## Per posting

### frontend-saas · gemma

- fields: family frontend, seniority senior, mode remote, domain saas
- must recall 89%, nice recall 100%, anyOf F1 100%
- missing must: GraphQL
- 18 requirements · 46002 ms · 1 call(s)

### mobile-alternatives · gemma

- fields: family mobile, seniority mid, mode hybrid, domain fintech
- must recall 100%, nice recall 100%, anyOf F1 67%
- either-or groups not in the posting: Fintech or banking
- 10 requirements · 55769 ms · 1 call(s)

### backend-contract · gemma

- fields: family backend, seniority senior, mode remote, domain fintech
- must recall 100%, nice recall 100%, anyOf F1 100%
- 15 requirements · 16722 ms · 1 call(s)

### design-health · gemma

- fields: family design, seniority mid, mode hybrid, domain saas
- must recall 75%, nice recall 100%, anyOf F1 100%
- missing must: design system
- terms not in the posting: product interface design
- 10 requirements · 37064 ms · 1 call(s)

### agency-freelance · gemma

- fields: family frontend, seniority unspecified, mode remote, domain agency
- must recall 100%, nice recall 100%, anyOf F1 100%
- terms not in the posting: performance, responsive design
- 8 requirements · 24988 ms · 1 call(s)

## How this is scored

- **fields**: role family, seniority, work mode and domain against each posting's label.
- **must / nice recall**: how much of the labelled core of requirements was found, with phrase-tolerant matching ("modern CSS" satisfies "CSS"). Recall is used instead of precision because the labels cover the important requirements, not every clause.
- **mix-ups**: labelled nice-to-haves presented as required, and the reverse. This is the cost of over-extraction.
- **anyOf F1**: either-or groups compared as whole sets, so splitting "React Native or Kotlin" into two requirements loses points, as does inventing one.
- **invented terms**: extracted terms that do not appear in the posting text at all.
- Price is not part of the score.

