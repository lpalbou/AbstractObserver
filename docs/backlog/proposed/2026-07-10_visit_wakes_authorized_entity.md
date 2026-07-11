# Visit wakes the entity when the visitor is authorized

- **Status**: proposed (maintainer request, 2026-07-10 20:17)
- **Origin**: maintainer screenshot — clicking "visit Mnemosyne" while she
  was asleep answered with the door's refusal: *"entity:mnemosyne@… is
  asleep (by the operator (web controls)) — wake him first (`entity wake`)
  or let his loop negotiate the visit"*. His ruling: **"if i click visit,
  it should wake up the entity, provided i am authorized to talk to that
  entity."**

## The shape

One click = wake + visit, for authorized visitors only:

1. The chat drawer's open path catches the door's asleep refusal (the
   409/423-class answer naming the state).
2. If the signed-in principal is authorized to wake (today: the operator;
   under GW-G/item-13 grants: a granted visitor), the drawer POSTs the
   wake (`state=awake`, reason "visit by <principal>"), then retries the
   open — one flow, no manual `entity wake` step.
3. The wake stays a VISIBLE host marker in the stream (never a silent
   side effect), and an unauthorized visitor still gets the honest
   refusal — authorization is the door's answer, never a client check.

## Why not now

- The authorization half belongs to the door (who may wake whom is a
  GW-G-class grant question — phase-4 lane, gateway seat). The observer
  should not encode "operator may, others may not" client-side; it
  retries on the door's yes and renders the door's no.
- Sequenced behind the GW-G ACL build so the retry logic lands once,
  against the real grant answers.

## Acceptance

- Signed-in operator clicks "visit" on an asleep entity → the entity
  wakes (host marker visible in the ledger) and the visit opens, one
  click.
- A visitor without wake authority gets the door's refusal verbatim.
- No client-side authorization logic — the drawer only sequences
  wake→open on the door's acceptance.
