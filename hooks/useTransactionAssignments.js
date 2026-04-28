import { useState } from 'react';
import { ref, set } from 'firebase/database';
import { db } from '../config/firebase';
import { applyPetActionProgress, normalizePetState } from '../utils/petProgression';
import { getSubmissionDateKeyEntry, getSubmissionStatus } from '../utils/reconciliation';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistSubmissionWithRetry(submissionRef, payload, attempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await set(submissionRef, payload);
      return true;
    } catch (error) {
      lastError = error;

      if (attempt < attempts - 1) {
        await wait(200 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

function buildSubmissionPayload({ day, dateKey, ts, value }) {
  if (value === undefined) {
    throw new Error('Cannot persist an assignment without a value.');
  }

  const payload = {
    ts,
    value,
  };
  const numericDay = Number(day);

  if (Number.isFinite(numericDay)) {
    payload.day = numericDay;
  }

  if (dateKey) {
    payload.dateKey = dateKey;
  }

  return payload;
}

export function useTransactionAssignments({
  currentUser,
  day,
  referenceDateKey,
  submissions,
  setSubmissions,
  petProfiles,
  setPetProfiles,
  updateActivePet,
  addCoinPop,
}) {
  const [undoStack, setUndoStack] = useState([]);
  const [assignmentError, setAssignmentError] = useState(null);

  const handleAssign = async (txId, value, event) => {
    if (!currentUser) return;
    setAssignmentError(null);
    const txSubmissions = submissions[txId] || {};
    const currentSubmission = txSubmissions[currentUser] || null;
    const previousValue = currentSubmission?.value ?? null;
    const previousStatus = getSubmissionStatus(txSubmissions);
    const ts = Date.now();
    const submissionPayload = buildSubmissionPayload({
      day,
      dateKey: referenceDateKey,
      ts,
      value,
    });
    const nextSubmission = {
      ...(currentSubmission || {}),
      ...submissionPayload,
    };
    const nextStatus = getSubmissionStatus({
      ...txSubmissions,
      [currentUser]: nextSubmission,
    });
    const earnedCloseReward = !previousStatus.resolved && nextStatus.resolved;
    const shouldReward = previousValue !== value || earnedCloseReward;
    const previousPetState = shouldReward ? normalizePetState(petProfiles[currentUser], referenceDateKey) : null;

    setUndoStack((prev) => [
      ...prev,
      {
        txId,
        user: currentUser,
        prev: submissions[txId]?.[currentUser] || null,
        petUser: currentUser,
        petPrev: previousPetState,
      },
    ]);

    setSubmissions((prev) => ({
      ...prev,
      [txId]: {
        ...prev[txId],
        [currentUser]: nextSubmission,
      },
    }));

    try {
      await persistSubmissionWithRetry(ref(db, `submissions/${txId}/${currentUser}`), submissionPayload);
    } catch (error) {
      setUndoStack((prev) => prev.slice(0, -1));
      setSubmissions((prev) => {
        const next = { ...prev };
        const existing = next[txId] ? { ...next[txId] } : {};

        if (currentSubmission) {
          existing[currentUser] = currentSubmission;
        } else {
          delete existing[currentUser];
        }

        if (Object.keys(existing).length > 0) {
          next[txId] = existing;
        } else {
          delete next[txId];
        }

        return next;
      });
      setAssignmentError('Assignment did not sync to Firebase. Please try again.');
      console.error('Failed to persist submission to Firebase:', error);
      return;
    }

    if (shouldReward) {
      try {
        updateActivePet((pet) =>
          applyPetActionProgress(pet, {
            dateKey: referenceDateKey,
            kind: 'assign',
            coinReward: 1,
          }).pet
        );
        addCoinPop(event);
      } catch (error) {
        console.error('Assignment saved, but reward UI failed:', error);
      }
    }
  };

  const undo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setSubmissions((prev) => {
      const next = { ...prev };
      if (!next[last.txId]) return next;
      if (last.prev) next[last.txId][last.user] = last.prev;
      else delete next[last.txId][last.user];
      return next;
    });

    if (last.petPrev && last.petUser) {
      setPetProfiles((prev) => ({
        ...prev,
        [last.petUser]: normalizePetState(last.petPrev, referenceDateKey),
      }));
    }

    try {
      if (last.prev) {
        await set(ref(db, `submissions/${last.txId}/${last.user}`), buildSubmissionPayload({
          day,
          dateKey: getSubmissionDateKeyEntry(last.prev),
          ts: last.prev.ts || Date.now(),
          value: last.prev.value,
        }));
      } else {
        await set(ref(db, `submissions/${last.txId}/${last.user}`), null);
      }
    } catch (error) {
      console.error('Failed to undo submission in Firebase:', error);
    }
  };

  return {
    assignmentError,
    undo,
    undoStack,
    setUndoStack,
    handleAssign,
  };
}
