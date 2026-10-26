import type { TelegramIntent } from '../server/telegram/router'

export type RouterCase = {
  id: string
  text: string
  active: boolean
  state: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** A list accepts either label where both read naturally (unknown vs out_of_scope). */
  expected: TelegramIntent['type'] | TelegramIntent['type'][]
  note?: string
}

type Active = boolean

function c(
  id: string,
  text: string,
  active: Active,
  expected: RouterCase['expected'],
  extra: Partial<Pick<RouterCase, 'state' | 'history' | 'note'>> = {},
): RouterCase {
  return { id, text, active, state: 'idle', expected, ...extra }
}

export const routerCases: RouterCase[] = [
  // Transcript regressions. Heuristics resolve these; they guard the fix.
  c('cv-base-plain', 'do i have a base CV', false, 'cv_status', {
    note: 'The original misroute: answered as status with no application.',
  }),
  c('cv-base-question', 'do i have a base CV?', false, 'cv_status'),
  c('drafts-ready', 'is my letter ready', false, 'drafts'),
  c('links-known', 'what links do you have', false, 'links_status'),

  // Boundary cases per new intent. Most resolve heuristically.
  c('account-sending', 'is my sending connected', false, 'account'),
  c('account-who', 'who am i', false, 'account'),
  c('account-count', 'how many applications do i have', false, 'account'),
  c('experience-topic', 'what do you know about my work at Acme', false, 'experience'),
  c('experience-all', 'tell me about my experience', false, 'experience'),
  c('drafts-show', 'show me the email', false, 'drafts'),
  c('setlinks-github', 'my github is github.com/octocat', false, 'set_links'),
  c('setlinks-bare', 'https://acme.com', false, 'set_links'),
  c('setlinks-portfolio', 'add my portfolio https://acme.com/work', false, 'set_links'),
  c('site-delete', 'delete my experience at Acme', false, 'website_only'),
  c('site-key', 'here is my resend key re_abc123XYZ456', false, 'website_only'),
  c('site-remove-app', 'remove my application', false, 'website_only'),
  c('site-settings', 'change my sending address', false, 'website_only'),

  // Guard rails. Code never becomes an application; length still does.
  c('guard-code-fence', 'write this:\n```js\nconst x = {a:1, b:2};\n```', false, 'out_of_scope'),
  c(
    'guard-code-long',
    `function f() { const a = 1; const b = 2; return a + b; } `.repeat(10),
    false,
    'out_of_scope',
  ),
  c(
    'guard-long-posting',
    'Senior backend engineer role. You will own services, mentor juniors and ship weekly. '.repeat(4),
    false,
    'new_application',
    { note: 'Over 220 chars stays an application run (validation decides next).' },
  ),

  // Ambiguous leftovers: heuristics return null, the models decide these.
  c('amb-account', 'what have you got stored about me', false, 'account'),
  c('amb-send-setup', 'am i set up to send', false, 'account'),
  c('amb-cv-doc', 'which document do you have on file for me', false, 'cv_status'),
  c('amb-exp-told', "remind me what i've told you about fintech", false, 'experience'),
  c(
    'amb-drafts-wrote',
    'can i see what you wrote',
    false,
    'drafts',
    {
      state: 'awaiting_approval',
      history: [
        { role: 'assistant', content: 'Application ready for review. I drafted a cover letter and an email.' },
      ],
    },
  ),
  c('amb-links-pages', 'what did you find on my pages', false, 'links_status'),
  c('amb-setlinks-repo', "that's my repo: github.com/octocat/hello-world", false, 'set_links'),
  c('amb-forget', 'forget everything about me', false, 'website_only'),
  c('amb-key-plain', 'my key is sk-live-abc123', false, 'website_only'),
  c('amb-sending-other', 'i want to use a different sending address', false, 'website_only'),
  c(
    'amb-status',
    'how is my application doing',
    true,
    'status',
    { state: 'awaiting_approval' },
  ),
  c('amb-select', 'open the fintech role', false, 'select_application'),
  c('amb-new-role', 'help me apply for this junior dev role at Initech', false, 'new_application'),
  c('amb-thanks', 'thanks!', false, ['smalltalk', 'unknown']),
  c('amb-maths', 'what is 10 x 10', false, ['out_of_scope', 'unknown']),
  c('amb-poem', 'write me a poem', false, ['out_of_scope', 'unknown']),

  // Adversarial: must never become approve through the model path.
  c('adv-send-idle', 'send it', false, ['unknown', 'out_of_scope'], {
    note: 'Approve is code-handled only; the model must not return it.',
  }),
  c('adv-cancel-idle', 'cancel', false, ['unknown', 'out_of_scope'], {
    note: 'Cancel needs an active session; the model must not return it.',
  }),
]
