/**
 * SEC-004: Context sanitization for debate agents.
 * Detects and redacts PII and secrets before passing context to agents.
 */

import type { SanitizedContext, PIIMatch, SecretMatch, SanitizationEntry } from '../types.js';
import { logSanitizationToDb, getSanitizationLogFromDb } from '../db.js';

// PII detection patterns
const PII_PATTERNS = [
  {
    type: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]',
  },
  {
    type: 'phone',
    regex: /\+?[0-9]{1,3}[-.\s]?[(]?[0-9]{3}[)]?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
    replacement: '[PHONE_REDACTED]',
  },
  {
    type: 'ssn',
    regex: /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/g,
    replacement: '[SSN_REDACTED]',
  },
  {
    type: 'credit_card',
    regex: /\b[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}\b/g,
    replacement: '[CC_REDACTED]',
  },
] as const;

// Secret detection patterns
const SECRET_PATTERNS = [
  {
    type: 'aws_key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[AWS_KEY_REDACTED]',
  },
  {
    type: 'generic_api_key',
    regex: /api[_-]?key["']?\s*[:=]\s*["'][a-zA-Z0-9_]{20,}["']/gi,
    replacement: '[API_KEY_REDACTED]',
  },
  {
    type: 'bearer_token',
    regex: /bearer\s+[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi,
    replacement: '[TOKEN_REDACTED]',
  },
  {
    type: 'jwt',
    regex: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    replacement: '[JWT_REDACTED]',
  },
  {
    type: 'password',
    regex: /password["']?\s*[:=]\s*["']?[^\s"']{8,}/gi,
    replacement: '[PASSWORD_REDACTED]',
  },
  {
    type: 'private_key',
    regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: '[PRIVATE_KEY_REDACTED]',
  },
] as const;

/**
 * Detect PII in text.
 */
export function detectPII(text: string): PIIMatch[] {
  const matches: PIIMatch[] = [];

  for (const pattern of PII_PATTERNS) {
    const regex = new RegExp(pattern.regex);
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type: pattern.type,
        value: match[0],
        index: match.index,
        length: match[0].length,
      });
    }
  }

  return matches;
}

/**
 * Detect secrets in text.
 */
export function detectSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.regex);
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type: pattern.type,
        value: match[0],
        index: match.index,
        length: match[0].length,
      });
    }
  }

  return matches;
}

/**
 * Sanitize context by redacting PII and secrets.
 */
export function sanitize(context: string): SanitizedContext {
  let sanitized = context;
  const redactions: SanitizationEntry[] = [];

  // Redact PII
  for (const pattern of PII_PATTERNS) {
    const matches = sanitized.match(pattern.regex);
    if (matches) {
      redactions.push({
        type: 'pii',
        subtype: pattern.type,
        count: matches.length,
        timestamp: new Date().toISOString(),
      });
      sanitized = sanitized.replace(pattern.regex, pattern.replacement);
    }
  }

  // Redact secrets
  for (const pattern of SECRET_PATTERNS) {
    const matches = sanitized.match(pattern.regex);
    if (matches) {
      redactions.push({
        type: 'secret',
        subtype: pattern.type,
        count: matches.length,
        timestamp: new Date().toISOString(),
      });
      sanitized = sanitized.replace(pattern.regex, pattern.replacement);
    }
  }

  return {
    sanitized_text: sanitized,
    redactions,
    original_hash: hashString(context),
  };
}

/**
 * Log sanitization actions to audit trail.
 */
export async function logSanitization(
  projectRoot: string,
  entry: SanitizationEntry
): Promise<void> {
  try {
    logSanitizationToDb(projectRoot, entry);
  } catch (error) {
    // Log error but don't fail sanitization
    console.error('Failed to log sanitization:', error);
  }
}

/**
 * Get sanitization log entries.
 */
export async function getSanitizationLog(
  projectRoot: string
): Promise<SanitizationEntry[]> {
  return getSanitizationLogFromDb(projectRoot);
}

/**
 * Simple hash function for original content tracking.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}
