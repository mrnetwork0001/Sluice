"use client";

/**
 * Persisted Circle user session, shared between the onboard page (which mints
 * it) and the sidebar (which displays the signed-in payroll wallet).
 *
 * Circle user tokens live ~60 minutes; the stored copy carries an expiry and
 * loads return nothing once it passes, so a stale token is never presented as
 * a signed-in state. Sensitive actions still require the user's PIN via a
 * Circle challenge - the token alone cannot move funds.
 */

const KEY = "sluice.circleSession";
const EVENT = "sluice-circle-session";
const TTL_MS = 55 * 60 * 1000;

export interface CircleSession {
  userToken: string;
  encryptionKey: string;
  userId?: string;
  address?: string;
  expiresAt: number;
}

export function saveCircleSession(session: Omit<CircleSession, "expiresAt"> & { expiresAt?: number }) {
  const stored: CircleSession = { expiresAt: Date.now() + TTL_MS, ...session };
  window.localStorage.setItem(KEY, JSON.stringify(stored));
  window.dispatchEvent(new Event(EVENT));
  return stored;
}

export function loadCircleSession(): CircleSession | undefined {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return undefined;
    const session = JSON.parse(raw) as CircleSession;
    if (!session.userToken || Date.now() >= session.expiresAt) {
      window.localStorage.removeItem(KEY);
      return undefined;
    }
    return session;
  } catch {
    return undefined;
  }
}

export function clearCircleSession() {
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

/** Subscribe to session changes (same-tab saves/clears and cross-tab storage). */
export function onCircleSessionChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
