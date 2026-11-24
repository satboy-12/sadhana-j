import type { User as FirebaseUser } from 'firebase/auth';
import { ApiError } from '../api/client';
import { auth } from '../firebase/firebase';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrors';

export { OperationType };

export function requireAuthenticatedUser(endpoint: string, method: string): FirebaseUser {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError({
      message: 'Please sign in to access your private health records.',
      code: 'UNAUTHORIZED',
      status: 401,
      endpoint,
      method,
    });
  }
  return user;
}

export function isPermissionDeniedError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code).toLowerCase()
      : '';
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err || '').toLowerCase();
  return (
    code.includes('permission-denied') ||
    code.includes('permission_denied') ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('permission_denied') ||
    msg.includes('permission denied')
  );
}

export function isNetworkOrUnavailableError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code).toLowerCase()
      : '';
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err || '').toLowerCase();
  return (
    code.includes('network') ||
    code.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('disconnected')
  );
}

export function mapMethodToOperationType(method: string): OperationType {
  switch (method.toUpperCase()) {
    case 'POST':
      return OperationType.CREATE;
    case 'PUT':
    case 'PATCH':
      return OperationType.UPDATE;
    case 'DELETE':
      return OperationType.DELETE;
    default:
      return OperationType.GET;
  }
}

export function formatErrorText(raw: string): string {
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && parsed.error) {
        return `Database ${parsed.operationType || 'operation'} failed${
          parsed.path ? ` (${parsed.path})` : ''
        }: ${parsed.error}`;
      }
    } catch {
      // fall through to raw message
    }
  }
  return raw;
}

export function getReadableErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return formatErrorText(err.message) || fallback;
  }
  if (err instanceof Error && err.message) {
    return formatErrorText(err.message);
  }
  return fallback;
}

export function toBannerError(err: unknown, fallback: string): ApiError | string {
  if (err instanceof ApiError) {
    return err;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

export function isStructuredFirestoreError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const trimmed = err.message.trim();
  return trimmed.startsWith('{') && trimmed.includes('"operationType"') && trimmed.includes('"authInfo"');
}

export function wrapFirestoreError(
  err: unknown,
  endpoint: string,
  method: string,
  fallback: string,
  path: string | null = null,
  operationType?: OperationType,
): never {
  if (err instanceof ApiError || isStructuredFirestoreError(err)) {
    throw err;
  }

  if (isPermissionDeniedError(err)) {
    handleFirestoreError(err, operationType ?? mapMethodToOperationType(method), path);
  }

  if (isNetworkOrUnavailableError(err)) {
    throw new ApiError({
      message:
        'Unable to reach Cloud Firestore right now. Check your connection and try again.',
      code: 'BACKEND_UNAVAILABLE',
      status: 503,
      endpoint,
      method,
    });
  }

  const rawMessage = err instanceof Error && err.message ? err.message : fallback;
  throw new ApiError({
    message: rawMessage,
    code: 'SERVER_ERROR',
    status: 500,
    endpoint,
    method,
  });
}
