/**
 * Tests for SEC-004: Context sanitization.
 */

import { describe, it, expect } from 'vitest';
import { detectPII, detectSecrets, sanitize } from './context-sanitizer.js';

describe('detectPII', () => {
  it('should detect email addresses', () => {
    const text = 'Contact john.doe@example.com for details';
    const matches = detectPII(text);

    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('email');
    expect(matches[0].value).toBe('john.doe@example.com');
  });

  it('should detect phone numbers', () => {
    const text = 'Call us at +1-555-123-4567';
    const matches = detectPII(text);

    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('phone');
  });

  it('should detect SSN', () => {
    const text = 'SSN: 123-45-6789';
    const matches = detectPII(text);

    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('ssn');
    expect(matches[0].value).toBe('123-45-6789');
  });

  it('should detect multiple PII types', () => {
    const text = 'Contact john@example.com or call 555-1234';
    const matches = detectPII(text);

    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('detectSecrets', () => {
  it('should detect AWS keys', () => {
    const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
    const matches = detectSecrets(text);

    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('aws_key');
  });

  it('should detect API keys', () => {
    const text = 'api_key: "sk_live_1234567890abcdefghijklmnop"';
    const matches = detectSecrets(text);

    expect(matches.length).toBeGreaterThanOrEqual(1);
    if (matches.length > 0) {
      expect(matches[0].type).toBe('generic_api_key');
    }
  });

  it('should detect JWT tokens', () => {
    const text = 'Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const matches = detectSecrets(text);

    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('jwt');
  });

  it('should detect private keys', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...\n-----END RSA PRIVATE KEY-----';
    const matches = detectSecrets(text);

    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('private_key');
  });
});

describe('sanitize', () => {
  it('should redact PII', () => {
    const text = 'Send email to alice@example.com';
    const result = sanitize(text);

    expect(result.sanitized_text).toContain('[EMAIL_REDACTED]');
    expect(result.sanitized_text).not.toContain('alice@example.com');
    expect(result.redactions.length).toBeGreaterThan(0);
    expect(result.redactions[0].type).toBe('pii');
  });

  it('should redact secrets', () => {
    const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
    const result = sanitize(text);

    expect(result.sanitized_text).toContain('[AWS_KEY_REDACTED]');
    expect(result.sanitized_text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.redactions.length).toBeGreaterThan(0);
    expect(result.redactions[0].type).toBe('secret');
  });

  it('should redact multiple patterns', () => {
    const text = 'Contact alice@example.com with key AKIAIOSFODNN7EXAMPLE';
    const result = sanitize(text);

    expect(result.sanitized_text).toContain('[EMAIL_REDACTED]');
    expect(result.sanitized_text).toContain('[AWS_KEY_REDACTED]');
    expect(result.redactions.length).toBe(2);
  });

  it('should preserve non-sensitive content', () => {
    const text = 'This is a normal architecture description with no secrets';
    const result = sanitize(text);

    expect(result.sanitized_text).toBe(text);
    expect(result.redactions.length).toBe(0);
  });

  it('should track original hash', () => {
    const text = 'Some content';
    const result = sanitize(text);

    expect(result.original_hash).toBeDefined();
    expect(result.original_hash.length).toBeGreaterThan(0);
  });
});
