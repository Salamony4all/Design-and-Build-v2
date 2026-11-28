/**
 * A message a person can read from a failed API response, whatever shape its body has.
 *
 * Our own routes answer `{ error: string }`. The hosting platform answers for itself
 * when a request never reaches a route, with `{ error: { code, message } }` or no JSON
 * at all: an upload over its 4.5 MB body limit comes back that way (413). Passing such
 * an object on as the message crashed the app, since a message is rendered as text.
 */
export const UPLOAD_TOO_LARGE =
  'This file is too large to upload here: the hosted app takes files up to 4.5 MB. Export only the plan sheets, or run the app on your computer.';

export function apiErrorMessage(status: number, body: unknown, what: string): string {
  const b = (body ?? {}) as { error?: unknown; message?: unknown };
  if (typeof b.error === 'string' && b.error.trim()) return b.error;
  if (status === 413) return UPLOAD_TOO_LARGE;
  const nested = (b.error ?? {}) as { message?: unknown };
  if (typeof nested.message === 'string' && nested.message.trim()) return `${what} failed: ${nested.message} (${status}).`;
  if (typeof b.message === 'string' && b.message.trim()) return `${what} failed: ${b.message} (${status}).`;
  return `${what} failed (${status}).`;
}
