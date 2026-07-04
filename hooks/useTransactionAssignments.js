import { useCallback, useState } from 'react';
import { ref, set } from 'firebase/database';
import { db } from '../config/firebase';
import { applyPetActionProgress, markPetStateUpdated, normalizePetState } from '../utils/petProgression';
import {
  getSubmissionDateKeyEntry,
  getSubmissionStatus,
  getSurfacedSubmissionStatus,
} from '../utils/reconciliation';
import {
  normalizeAssignmentComment,
  resolveAssignmentCommentForSave,
  shouldSyncAssignmentComment,
} from '../utils/assignmentCommentPersistence';

const ASSIGNMENT_COMMENTS_ROOT = 'cc_v5_app_state/assignmentComments';
const USER_ACTIVITY_ROOT = 'cc_v5_app_state/userActivity';

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

function buildSubmissionPayload({ day, dateKey, ts, value, comment }) {
  if (value === undefined) {
    throw new Error('Cannot persist an assignment without a value.');
  }

  const payload = {
    ts,
    value,
  };
  const normalizedComment = normalizeAssignmentComment(comment);
  const numericDay = Number(day);

  if (Number.isFinite(numericDay)) {
    payload.day = numericDay;
  }

  if (dateKey) {
    payload.dateKey = dateKey;
  }

  if (normalizedComment) {
    payload.comment = normalizedComment;
  }

  return payload;
}

function addPreviousSubmissionSnapshot(payload, currentSubmission) {
  if (!currentSubmission?.value) return payload;
  const previousDateKey = getSubmissionDateKeyEntry(currentSubmission);
  if (!previousDateKey) return payload;

  return {
    ...payload,
    previousValue: currentSubmission.value,
    previousDateKey,
  };
}

function buildCommentPayload(submission) {
  const comment = normalizeAssignmentComment(submission?.comment);
  if (!comment) return null;

  return {
    comment,
    value: submission.value,
    ts: submission.ts || Date.now(),
    dateKey: getSubmissionDateKeyEntry(submission),
  };
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

  const handleAssign = useCallback(async (txId, value, event, comment) => {
    if (!currentUser) return;
    setAssignmentError(null);
    const txSubmissions = submissions[txId] || {};
    const currentSubmission = txSubmissions[currentUser] || null;
    const previousValue = currentSubmission?.value ?? null;
    const previousStatus = getSubmissionStatus(txSubmissions);
    const previousSurfacedStatus = getSurfacedSubmissionStatus(txSubmissions, referenceDateKey);
    const ts = Date.now();
    const resolvedComment = resolveAssignmentCommentForSave({
      commentInput: comment,
      embeddedComment: currentSubmission?.comment,
    });
    let submissionPayload = buildSubmissionPayload({
      day,
      dateKey: referenceDateKey,
      ts,
      value,
      comment: resolvedComment,
    });
    const currentSubmissionDateKey = getSubmissionDateKeyEntry(currentSubmission);

    if (
      (previousSurfacedStatus.conflict || previousSurfacedStatus.unsure) &&
      currentSubmissionDateKey &&
      currentSubmissionDateKey < referenceDateKey
    ) {
      submissionPayload = addPreviousSubmissionSnapshot(submissionPayload, currentSubmission);
    }
    const nextSubmission = {
      ...(currentSubmission || {}),
      ...submissionPayload,
    };

    if (resolvedComment === null) {
      delete nextSubmission.comment;
    }

    if (!nextSubmission.comment) {
      delete nextSubmission.comment;
    }

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

    set(ref(db, `${USER_ACTIVITY_ROOT}/${currentUser}`), {
      user: currentUser,
      lastSeen: ts,
    }).catch((error) => {
      console.error('Assignment saved, but user activity sync failed:', error);
    });

    if (shouldSyncAssignmentComment({ commentInput: comment, resolvedComment })) {
      try {
        await persistSubmissionWithRetry(
          ref(db, `${ASSIGNMENT_COMMENTS_ROOT}/${txId}/${currentUser}`),
          buildCommentPayload(nextSubmission)
        );
      } catch (error) {
        console.error('Assignment saved, but shared note sync failed:', error);
      }
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
  }, [
    addCoinPop,
    currentUser,
    day,
    petProfiles,
    referenceDateKey,
    setSubmissions,
    submissions,
    updateActivePet,
  ]);

  const undo = useCallback(async () => {
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
      setPetProfiles((prev) => {
        const currentUpdatedAt = Number(prev[last.petUser]?.updatedAt || 0);
        const restoredPet = {
          ...last.petPrev,
          updatedAt: Math.max(Number(last.petPrev.updatedAt || 0), currentUpdatedAt),
        };

        return {
          ...prev,
          [last.petUser]: markPetStateUpdated(restoredPet, referenceDateKey),
        };
      });
    }

    try {
      if (last.prev) {
        const previousSubmissionPayload = buildSubmissionPayload({
          day,
          dateKey: getSubmissionDateKeyEntry(last.prev),
          ts: last.prev.ts || Date.now(),
          value: last.prev.value,
          comment: last.prev.comment,
        });
        await set(ref(db, `submissions/${last.txId}/${last.user}`), previousSubmissionPayload);
        await set(ref(db, `${ASSIGNMENT_COMMENTS_ROOT}/${last.txId}/${last.user}`), buildCommentPayload(previousSubmissionPayload));
      } else {
        await set(ref(db, `submissions/${last.txId}/${last.user}`), null);
        await set(ref(db, `${ASSIGNMENT_COMMENTS_ROOT}/${last.txId}/${last.user}`), null);
      }
      await set(ref(db, `${USER_ACTIVITY_ROOT}/${last.user}`), {
        user: last.user,
        lastSeen: Date.now(),
      });
    } catch (error) {
      console.error('Failed to undo submission in Firebase:', error);
    }
  }, [day, referenceDateKey, setPetProfiles, setSubmissions, undoStack]);

  return {
    assignmentError,
    undo,
    undoStack,
    setUndoStack,
    handleAssign,
  };
}
