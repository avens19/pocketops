/**
 * The log ids in the order the Logs list shows them, so the detail screen can step to the next or previous one.
 * Kept outside the screens because the detail is a separate route from the list.
 */
let ids: string[] = [];

export function setLogNeighbors(next: string[]) {
  ids = next;
}

export function logNeighbors(id: string): { previous?: string; next?: string } {
  const i = ids.indexOf(id);
  if (i < 0) return {};
  return { previous: ids[i - 1], next: ids[i + 1] };
}
