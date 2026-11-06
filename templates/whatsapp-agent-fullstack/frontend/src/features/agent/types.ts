/** The model the agent answers with, as Bedrock Prompt Management stores it. */
export interface AgentModel {
  /** A Claude inference profile, e.g. `us.anthropic.claude-sonnet-4-6`. */
  id: string;
  temperature: number;
  maxTokens: number;
  /** Optional; Anthropic recommends tuning temperature or topP, not both. */
  topP: number | null;
}

/** What the prompt manager edits. */
export interface AgentConfig {
  enabled: boolean;
  businessName: string;
  /** The system prompt of the Bedrock prompt; may use {{variables}}. */
  instructions: string;
  greeting: string;
  refusal: string;
  handoffMessage: string;
  model: AgentModel;
  /** Value of each {{variable}} used in the instructions. */
  parameters: Record<string, string>;
}

export interface AgentVersion {
  /** `v0000` is the configuration deployed before the first publish. */
  version: string;
  config: AgentConfig;
  /** The Bedrock Prompt Management version it uses. */
  bedrockVersion: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  comment: string;
  rollbackOf?: string | null;
  /** `web`, `console` (adopted from the AWS console) or `deploy`. */
  source?: string;
}

export type AgentVersionSummary = Omit<AgentVersion, 'config'>;

/** A Bedrock version created in the AWS console that the agent does not use yet. */
export interface ConsoleVersion {
  bedrockVersion: string;
  createdAt: string | null;
  description: string;
}

export interface AgentVersions {
  versions: AgentVersionSummary[];
  consoleVersions: ConsoleVersion[];
}

export interface AgentDraft {
  config: AgentConfig;
  /** Sent back on save and publish: a stale one means someone else saved meanwhile. */
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  basedOn: string | null;
}

export interface AgentConfigState {
  published: AgentVersion;
  draft: AgentDraft | null;
  /** False when the configuration in use was changed outside this screen (a deploy). */
  liveMatches: boolean;
  /** The Bedrock DRAFT, when someone edited it in the AWS console. */
  consoleDraft: Pick<AgentConfig, 'instructions' | 'model'> | null;
  bedrockPrompt: { id: string; arn: string; name: string } | null;
}

export interface ModelOption {
  id: string;
  name: string;
}

/** Used when the API sends no model (a backend from before the model existed). */
export const DEFAULT_MODEL: AgentModel = {
  id: 'us.anthropic.claude-sonnet-4-6',
  temperature: 0.3,
  maxTokens: 4096,
  topP: null,
};

/** A config with every field, whatever version of the API sent it. */
export function normalizeConfig(config: Partial<AgentConfig> | null | undefined): AgentConfig {
  const value = config ?? {};
  return {
    enabled: value.enabled ?? true,
    businessName: value.businessName ?? '',
    instructions: value.instructions ?? '',
    greeting: value.greeting ?? '',
    refusal: value.refusal ?? '',
    handoffMessage: value.handoffMessage ?? '',
    model: { ...DEFAULT_MODEL, ...(value.model ?? {}) },
    parameters: { ...(value.parameters ?? {}) },
  };
}

/** Limits the backend enforces too (src/lambda/agent/config-admin). */
export const LIMITS = {
  businessName: 80,
  instructions: 7000,
  message: 1000,
  instructionsMin: 50,
  parameter: 200,
} as const;

const VARIABLE = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,99})\s*\}\}/g;
/** The user turn of the Bedrock template: not a business parameter. */
const QUESTION_VARIABLE = 'pregunta';

/** The {{variables}} of a text, in order of first use. */
export function variablesOf(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(VARIABLE)) {
    const name = match[1]!;
    if (name !== QUESTION_VARIABLE && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Deep equality for configs (key order does not matter). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
      return false;
  }
  return true;
}
