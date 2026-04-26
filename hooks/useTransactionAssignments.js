import { useState } from 'react';
import { ref, set } from 'firebase/database';
import { db } from '../config/firebase';
import { applyPetActionProgress, normalizePetState } from '../utils/petProgression';
import { getSubmissionDateKeyEntry, getSubmissionStatus } from '../utils/reconciliation';

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

  const handleAssign = async (txId, value, event) => {
    if (!currentUser) return;
    const txSubmissions = submissions[txId] || {};
    const currentSubmission = txSubmissions[currentUser] || null;
    const previousValue = currentSubmission?.value ?? null;
    const previousStatus = getSubmissionStatus(txSubmissions);
    const ts = Date.now();
    const nextSubmission = {
      ...(currentSubmission || {}),
      day,
      dateKey: referenceDateKey,
      ts,
      value,
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
      await set(ref(db, `submissions/${txId}/${currentUser}`), {
        day,
        dateKey: referenceDateKey,
        ts,
        value,
      });

      if (shouldReward) {
        updateActivePet((pet) =>
          applyPetActionProgress(pet, {
            dateKey: referenceDateKey,
            kind: 'assign',
            coinReward: 1,
          }).pet
        );
        addCoinPop(event);
      }
    } catch (error) {
      console.error('Failed to persist submission to Firebase:', error);
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
        await set(ref(db, `submissions/${last.txId}/${last.user}`), {
          day,
          dateKey: getSubmissionDateKeyEntry(last.prev),
          ts: last.prev.ts || Date.now(),
          value: last.prev.value,
        });
      } else {
        await set(ref(db, `submissions/${last.txId}/${last.user}`), null);
      }
    } catch (error) {
      console.error('Failed to undo submission in Firebase:', error);
    }
  };

  return {
    undo,
    undoStack,
    setUndoStack,
    handleAssign,
  };
}
