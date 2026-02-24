/**
 * Date parsing and formatting utilities for koan CLI tools.
 * Provides shared date handling logic to eliminate duplication.
 */

export type RelativeUnit = 'd' | 'w' | 'm' | 'y';

/**
 * Parse a date string that can be either:
 * - Relative: "7d", "2w", "1m", "1y" (days, weeks, months, years ago)
 * - Absolute: ISO date string (e.g., "2026-01-01")
 *
 * @param dateStr - Date string to parse
 * @param baseDate - Base date for relative calculations (defaults to now)
 * @returns Parsed Date object
 * @throws Error if date format is invalid
 */
export function parseRelativeDate(
  dateStr: string,
  baseDate: Date = new Date()
): Date {
  // Handle relative dates like "7d", "30d", "1w"
  const relativeMatch = dateStr.match(/^(\d+)([dwmy])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2] as RelativeUnit;
    const result = new Date(baseDate);

    switch (unit) {
      case 'd':
        result.setDate(result.getDate() - value);
        break;
      case 'w':
        result.setDate(result.getDate() - value * 7);
        break;
      case 'm':
        result.setMonth(result.getMonth() - value);
        break;
      case 'y':
        result.setFullYear(result.getFullYear() - value);
        break;
    }

    return result;
  }

  // Try to parse as ISO date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(
      `Invalid date format: ${dateStr}. Use ISO date (YYYY-MM-DD) or relative (e.g., 7d, 2w)`
    );
  }

  return date;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration (e.g., "150ms", "2.5s", "3.2m", "1.5h")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${(ms / 3600000).toFixed(1)}h`;
}
