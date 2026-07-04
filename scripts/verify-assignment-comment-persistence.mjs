import assert from 'assert/strict';
import {
  normalizeAssignmentComment,
  resolveAssignmentCommentForSave,
  shouldSyncAssignmentComment,
} from '../utils/assignmentCommentPersistence.js';

assert.equal(
  resolveAssignmentCommentForSave({
    commentInput: undefined,
    embeddedComment: null,
    sharedComment: 'Saved before assignment',
  }),
  'Saved before assignment',
  'a shared note saved before assignment must be carried into the assignment'
);

assert.equal(
  resolveAssignmentCommentForSave({
    commentInput: undefined,
    embeddedComment: 'Existing embedded note',
    sharedComment: 'Older shared note',
  }),
  'Existing embedded note',
  'the embedded assignment note remains authoritative when present'
);

assert.equal(
  resolveAssignmentCommentForSave({
    commentInput: 'New note',
    embeddedComment: 'Existing note',
    sharedComment: 'Existing note',
  }),
  'New note',
  'an explicit edited note wins'
);

assert.equal(
  resolveAssignmentCommentForSave({
    commentInput: null,
    embeddedComment: 'Existing note',
    sharedComment: 'Existing note',
  }),
  null,
  'an explicit clear removes the note'
);

assert.equal(
  resolveAssignmentCommentForSave({
    commentInput: undefined,
    embeddedComment: null,
    sharedComment: null,
  }),
  undefined,
  'an untouched assignment has no comment intent'
);

assert.equal(
  shouldSyncAssignmentComment({
    commentInput: undefined,
    resolvedComment: undefined,
  }),
  false,
  'an untouched assignment must not overwrite the shared-note path with null'
);

assert.equal(
  shouldSyncAssignmentComment({
    commentInput: null,
    resolvedComment: null,
  }),
  true,
  'an explicit clear must sync'
);

assert.equal(
  normalizeAssignmentComment(`  ${'x'.repeat(200)}  `).length,
  180,
  'comments remain normalized and length-limited'
);

console.log('assignment comment persistence verification passed');
