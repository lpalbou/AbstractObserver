import { randomId } from "@abstractframework/ui-kit";

/** A v4 UUID; works over plain http too (crypto.randomUUID is https/localhost only). */
export function random_id(): string {
  return randomId();
}
