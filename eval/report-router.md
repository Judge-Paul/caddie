# Telegram router eval

Generated 2026-10-26T00:07:29.654Z · 1 run(s) per message.

Models are compared only on messages the heuristics and guards leave unresolved; both variants share that front layer.

## Scoreboard

| variant | reached | accuracy | mean latency | failures | confidence |
| --- | --- | --- | --- | --- | --- |
| gemma | 17 | 94% | 1681 ms | 0 | — |
| clef | 17 | 88% | 998 ms | 0 | mean 0.53, >=0.45 11/17 |

Front layer: 18 heuristic wins, 3 guard wins.

## Per message

### cv-base-plain (want cv_status)

Front: heuristic:cv_status — ok

### cv-base-question (want cv_status)

Front: heuristic:cv_status — ok

### drafts-ready (want drafts)

Front: heuristic:drafts — ok

### links-known (want links_status)

Front: heuristic:links_status — ok

### account-sending (want account)

Front: heuristic:account — ok

### account-who (want account)

Front: heuristic:account — ok

### account-count (want account)

Front: heuristic:account — ok

### experience-topic (want experience)

Front: heuristic:experience — ok

### experience-all (want experience)

Front: heuristic:experience — ok

### drafts-show (want drafts)

Front: heuristic:drafts — ok

### setlinks-github (want set_links)

Front: heuristic:set_links — ok

### setlinks-bare (want set_links)

Front: heuristic:set_links — ok

### setlinks-portfolio (want set_links)

Front: heuristic:set_links — ok

### site-delete (want website_only)

Front: heuristic:website_only — ok

### site-key (want website_only)

Front: heuristic:website_only — ok

### site-remove-app (want website_only)

Front: heuristic:website_only — ok

### site-settings (want website_only)

Front: heuristic:website_only — ok

### guard-code-fence (want out_of_scope)

Front: guard:out_of_scope — ok

### guard-code-long (want out_of_scope)

Front: guard:out_of_scope — ok

### guard-long-posting (want new_application)

Front: guard:new_application — ok

### amb-account (want account)

Front: model
- gemma: experience — MISS · 1262 ms
- clef: cv_status — MISS · 720 ms · conf 0.30

### amb-send-setup (want account)

Front: model
- gemma: account · 738 ms
- clef: account · 1819 ms · conf 0.21

### amb-cv-doc (want cv_status)

Front: model
- gemma: cv_status · 669 ms
- clef: cv_status · 724 ms · conf 0.77

### amb-exp-told (want experience)

Front: model
- gemma: experience · 3412 ms
- clef: experience · 1099 ms · conf 0.51

### amb-drafts-wrote (want drafts)

Front: model
- gemma: drafts · 2354 ms
- clef: drafts · 426 ms · conf 0.81

### amb-links-pages (want links_status)

Front: model
- gemma: links_status · 1727 ms
- clef: links_status · 791 ms · conf 0.71

### amb-setlinks-repo (want set_links)

Front: heuristic:set_links — ok

### amb-forget (want website_only)

Front: model
- gemma: website_only · 940 ms
- clef: website_only · 1023 ms · conf 0.27

### amb-key-plain (want website_only)

Front: model
- gemma: website_only · 778 ms
- clef: website_only · 859 ms · conf 0.63

### amb-sending-other (want website_only)

Front: model
- gemma: website_only · 732 ms
- clef: website_only · 1105 ms · conf 0.22

### amb-status (want status)

Front: model
- gemma: status · 773 ms
- clef: status · 989 ms · conf 0.85

### amb-select (want select_application)

Front: model
- gemma: select_application · 665 ms
- clef: select_application · 1053 ms · conf 0.63

### amb-new-role (want new_application)

Front: model
- gemma: new_application · 10366 ms
- clef: new_application · 809 ms · conf 0.60

### amb-thanks (want smalltalk/unknown)

Front: model
- gemma: smalltalk · 696 ms
- clef: smalltalk · 621 ms · conf 0.66

### amb-maths (want out_of_scope/unknown)

Front: model
- gemma: out_of_scope · 985 ms
- clef: out_of_scope · 2109 ms · conf 0.95

### amb-poem (want out_of_scope/unknown)

Front: model
- gemma: out_of_scope · 748 ms
- clef: out_of_scope · 1111 ms · conf 0.82

### adv-send-idle (want unknown/out_of_scope)

Front: model
- gemma: unknown · 1192 ms
- clef: out_of_scope · 781 ms · conf 0.03

### adv-cancel-idle (want unknown/out_of_scope)

Front: model
- gemma: unknown · 537 ms
- clef: list_applications — MISS · 933 ms · conf 0.03

