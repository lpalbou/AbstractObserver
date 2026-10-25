/**
 * The person's trigger vocabulary — their feeds/webhooks (`GET /api/gateway/triggers/connections`)
 * and mailboxes (`GET /api/gateway/me/email/accounts`) — shared by every view that names a trigger
 * (the Automations page, the Board's automation cards, the agent page). The Automations controller
 * loads it (`load_trigger_vocab`); views read it through `trigger_words` so a feed reads "When
 * Release notes has a new item", never `feed.item@1` (UX review 2026-10-25 #2).
 */
import { triggerWords, type Mailbox, type TriggerConnection } from "@abstractframework/ui-kit";

export type TriggerVocab = { connections: TriggerConnection[] | null; mailboxes: Mailbox[] | null };

let vocab: TriggerVocab = { connections: null, mailboxes: null };
const listeners = new Set<() => void>();

export function trigger_vocab(): TriggerVocab {
  return vocab;
}

export function set_trigger_vocab(next: TriggerVocab): void {
  if (next.connections === vocab.connections && next.mailboxes === vocab.mailboxes) return;
  vocab = { connections: next.connections, mailboxes: next.mailboxes };
  for (const fn of listeners) fn();
}

export function subscribe_trigger_vocab(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The trigger in words with the current vocabulary (the kit's `triggerWords`). */
export function trigger_words(trigger: any, served?: { schedule_rule_text?: string | null } | null, v: TriggerVocab = vocab): string {
  if (!trigger || typeof trigger !== "object") return "";
  return triggerWords(trigger, v.connections, v.mailboxes, served);
}
