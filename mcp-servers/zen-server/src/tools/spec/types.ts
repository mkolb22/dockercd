/**
 * Types for the ZenSpec specification DSL module.
 * Defines structured specs that transform into code generation prompts.
 */

export type SpecStatus = "draft" | "ready" | "generating" | "generated" | "verified";
export type SpecTargetLanguage = "go" | "swift" | "rust" | "typescript" | "python";

export interface SpecEffect {
  type: "io" | "network" | "database" | "filesystem" | "none";
  description?: string;
}

export interface SpecParam {
  name: string;
  type: string;
  description?: string;
  constraints?: string;
}

export interface SpecFunction {
  name: string;
  params: SpecParam[];
  returns: string;
  errors?: string[];
  effects?: SpecEffect[];
  requires?: string[];
  ensures?: string[];
  description?: string;
}

export interface SpecProperty {
  name: string;
  description: string;
  forall?: string[];
  body: string;
}

export interface SpecType {
  name: string;
  fields: SpecParam[];
  description?: string;
}

export interface SpecData {
  name: string;
  description: string;
  types?: SpecType[];
  functions: SpecFunction[];
  properties?: SpecProperty[];
  target_language: SpecTargetLanguage;
}

export interface SpecRecord {
  id: string;
  name: string;
  data: SpecData;
  status: SpecStatus;
  generatedCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Portable spec format for export/import across projects */
export interface PortableSpec {
  name: string;
  status: SpecStatus;
  data: SpecData;
}
