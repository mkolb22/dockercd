/**
 * Schema registry mapping koan/ directories to JSON schemas
 */

import type { SchemaRegistryEntry } from './types.js';

export const SCHEMA_REGISTRY: SchemaRegistryEntry[] = [
  {
    dir: 'stories',
    schemaFile: 'story.schema.json',
  },
  {
    dir: 'architecture',
    schemaFile: 'architecture.schema.json',
  },
  {
    dir: 'implementations',
    schemaFile: 'implementation.schema.json',
  },
  {
    dir: 'provenance',
    schemaFile: 'provenance.schema.json',
    glob: 'provenance/actions/*.yaml',
  },
  {
    dir: 'reviews',
    schemaFile: 'review.schema.json',
  },
  {
    dir: 'tasks',
    schemaFile: 'task.schema.json',
  },
  {
    dir: 'slo',
    schemaFile: 'slo.schema.json',
  },
  {
    dir: 'retrospectives',
    schemaFile: 'retrospective.schema.json',
  },
  {
    dir: 'verifications',
    schemaFile: 'verification.schema.json',
  },
  {
    dir: 'plans',
    schemaFile: 'planning.schema.json',
  },
  {
    dir: 'explorations',
    schemaFile: 'tree-of-thoughts.schema.json',
  },
];
