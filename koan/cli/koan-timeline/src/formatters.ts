/**
 * Formatting utilities for koan-timeline.
 * Re-exports shared formatters from koan-core and adds timeline-specific ones.
 */

import chalk from 'chalk';
export { formatDuration, formatCost, formatConcept, formatModel } from '@zen/koan-core';

/**
 * Format timestamp in various formats.
 *
 * @param iso - ISO 8601 timestamp
 * @param format - Output format
 * @returns Formatted timestamp
 */
export function formatTimestamp(
  iso: string,
  format: 'time' | 'datetime' | 'relative' = 'time'
): string {
  const date = new Date(iso);

  if (format === 'time') {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  if (format === 'datetime') {
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  // Relative format (e.g., "2h ago")
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return `${diffSec}s ago`;
}
