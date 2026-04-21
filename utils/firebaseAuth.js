import { browserLocalPersistence, getAuth, onAuthStateChanged, setPersistence, signInAnonymously } from 'firebase/auth';
import { app } from '../config/firebase';

export function ensureAnonymousAuth({ onReady, onError } = {}) {
  const auth = getAuth(app);
  let cancelled = false;
  let attemptedSignIn = false;

  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn('Firebase auth persistence could not be set:', error);
  });

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (cancelled) return;

    if (user) {
      if (onReady) onReady(user);
      return;
    }

    if (attemptedSignIn) return;
    attemptedSignIn = true;

    signInAnonymously(auth).catch((error) => {
      if (cancelled) return;
      if (onError) onError(error);
    });
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
