import { ProofreadFlagValue, ProofreadFlags } from "../../types/word.js";

export function isProofreadFlag(value: unknown): value is boolean | ProofreadFlagValue {
  return value === true || (typeof value === "object" && value !== null && "verified" in value);
}

export function getProofreadSource(
  value: boolean | ProofreadFlagValue | undefined
): "human" | "agent" | null {
  if (value === true) return "agent";
  if (value && typeof value === "object" && "source" in value) {
    return (value as ProofreadFlagValue).source;
  }
  return null;
}

export function normalizeProofreadFlag(
  value: boolean | ProofreadFlagValue | undefined,
  source: "human" | "agent",
  metadata?: { login?: string; model?: string; batch?: string; timestamp?: string }
): ProofreadFlagValue {
  if (typeof value === "object" && value !== null && "verified" in value) {
    return value as ProofreadFlagValue;
  }

  return {
    verified: value === true,
    source,
    timestamp: metadata?.timestamp || new Date().toISOString(),
    ...(source === "human" && metadata?.login && { login: metadata.login }),
    ...(source === "agent" && metadata?.model && { model: metadata.model }),
    ...(source === "agent" && metadata?.batch && { batch: metadata.batch }),
  };
}

export function createHumanProofreadFlag(login: string): ProofreadFlagValue {
  return {
    verified: true,
    source: "human",
    login,
    timestamp: new Date().toISOString(),
  };
}

export function createAgentProofreadFlag(
  model: string,
  batch?: string,
  timestamp?: string
): ProofreadFlagValue {
  return {
    verified: true,
    source: "agent",
    model,
    ...(batch && { batch }),
    timestamp: timestamp || new Date().toISOString(),
  };
}

export function mergeProofreadFlags(existing: ProofreadFlags, updates: Partial<ProofreadFlags>): ProofreadFlags {
  const result = { ...existing };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete (result as any)[key];
    } else {
      (result as any)[key] = value;
    }
  }

  return result;
}
