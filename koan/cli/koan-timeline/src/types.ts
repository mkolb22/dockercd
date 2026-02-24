/**
 * Type definitions for koan-timeline.
 */

import type { ProvenanceAction, Concept } from '@zen/koan-core';

/**
 * Timeline action is just a provenance action.
 * We use an alias for clarity in the timeline context.
 */
export type TimelineAction = ProvenanceAction;

/**
 * Options for loading timeline actions.
 */
export interface LoaderOptions {
  projectRoot: string;
  flow?: string;
  from?: Date;
  to?: Date;
  concept?: Concept;
}

/**
 * Options for rendering timeline.
 */
export interface RenderOptions {
  verbose: boolean;
  redact: boolean;
}

/**
 * CLI options parsed from commander.
 */
export interface CliOptions {
  flow?: string;
  from?: string;
  to?: string;
  concept?: string;
  gantt?: boolean;
  format?: 'timeline' | 'json';
  redact?: boolean;
  force?: boolean;
  verbose?: boolean;
}
