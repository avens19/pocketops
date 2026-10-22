/**
 * The Open tab presents the link modal whenever it gains focus, and gains focus again when the modal
 * closes. This remembers when the modal last closed so that return trip does not reopen it.
 */
let closedAt = 0;

export function markLinkModalClosed() {
  closedAt = Date.now();
}

export function linkModalJustClosed(now = Date.now()) {
  return now - closedAt < 1000;
}
