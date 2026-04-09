// src/lib/persistence/index.ts
import { FirebaseAdapter } from './adapters/firebase';
import { SupabaseAdapter } from './adapters/supabase';
import { StudyDatabase } from './types';

// The switcher logic determines which backend to use based on environment variables
const backendType = import.meta.env.VITE_DATABASE_TYPE || 'firebase';

console.info(`[Database] Initializing persistence layer with backend: ${backendType}`);

let dbInstance: StudyDatabase;

if (backendType === 'supabase') {
  dbInstance = new SupabaseAdapter();
} else {
  dbInstance = new FirebaseAdapter();
}

export const persistence = dbInstance;

/**
 * Global helper for logging application errors to the active backend.
 */
export async function logAppError(action: string, error: any, context?: any) {
  const shortId = Math.random().toString(36).substring(2, 7).toUpperCase();
  try {
    const errorData = {
      shortId,
      action,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      context: context || {},
      timestamp: new Date(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };
    await persistence.logError(errorData);
    return shortId;
  } catch (logErr) {
    console.error("Failed to log error to persistence layer:", logErr);
    return shortId;
  }
}

export * from './types';

