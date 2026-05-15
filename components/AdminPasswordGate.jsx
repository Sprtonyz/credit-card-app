import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const ADMIN_ACCESS_SESSION_KEY = 'cc_admin_tools_access';

export function hasStoredAdminAccess() {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(ADMIN_ACCESS_SESSION_KEY) === 'granted';
}

function storeAdminAccess() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ADMIN_ACCESS_SESSION_KEY, 'granted');
}

export function clearStoredAdminAccess() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(ADMIN_ACCESS_SESSION_KEY);
}

export async function verifyAdminPassword(password) {
  const response = await fetch('/api/admin-auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Password check failed.');
  }

  storeAdminAccess();
  return true;
}

function AdminPasswordForm({
  title = 'Protected tools',
  description = 'Enter the admin tools password to continue.',
  onAuthorized,
  onCancel = null,
  mode = 'page',
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextPassword = password.trim();

    if (!nextPassword) {
      setError('Enter the admin tools password.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await verifyAdminPassword(nextPassword);
      setPassword('');
      onAuthorized?.();
    } catch (err) {
      setError(err.message || 'Password check failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cardClass =
    mode === 'modal'
      ? 'w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl'
      : 'w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900/95 p-6 shadow-2xl';

  return (
    <form onSubmit={handleSubmit} className={cardClass}>
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Locked</p>
        <h1 className="mt-1 text-2xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
      </div>

      <label className="block text-sm font-medium text-slate-200" htmlFor="admin-tools-password">
        Password
      </label>
      <input
        id="admin-tools-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoFocus
        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-white outline-none transition focus:border-cyan-500"
      />

      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

      <div className="mt-5 flex gap-3">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-600 disabled:opacity-50"
        >
          {isSubmitting ? 'Checking...' : 'Unlock'}
        </button>
      </div>
    </form>
  );
}

export function AdminPasswordModal({
  open,
  title = 'Protected tools',
  description = 'Enter the admin tools password to continue.',
  onAuthorized,
  onCancel,
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4">
      <AdminPasswordForm
        title={title}
        description={description}
        onAuthorized={onAuthorized}
        onCancel={onCancel}
        mode="modal"
      />
    </div>,
    document.body
  );
}

export default function AdminPasswordGate({
  children,
  title = 'Protected admin area',
  description = 'Enter the admin tools password to continue.',
}) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsAuthorized(hasStoredAdminAccess());
    setIsReady(true);
  }, []);

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-300">
        Checking access...
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <AdminPasswordForm
          title={title}
          description={description}
          onAuthorized={() => setIsAuthorized(true)}
        />
      </div>
    );
  }

  return children;
}
