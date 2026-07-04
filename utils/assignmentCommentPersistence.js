export const ASSIGNMENT_COMMENT_MAX_LENGTH = 180;

export function normalizeAssignmentComment(comment) {
  return String(comment || '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, ASSIGNMENT_COMMENT_MAX_LENGTH);
}

export function resolveAssignmentCommentForSave({
  commentInput,
  embeddedComment,
  sharedComment,
}) {
  if (commentInput === null) return null;

  if (commentInput !== undefined) {
    return normalizeAssignmentComment(commentInput) || null;
  }

  const existingComment =
    normalizeAssignmentComment(embeddedComment) ||
    normalizeAssignmentComment(sharedComment);

  return existingComment || undefined;
}

export function shouldSyncAssignmentComment({ commentInput, resolvedComment }) {
  return commentInput !== undefined || Boolean(normalizeAssignmentComment(resolvedComment));
}
