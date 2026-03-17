/** LLM abstraction types. */

export type LLMProvider = "openai" | "anthropic" | "ollama" | "lm-studio";

export interface LLMOptions {
  provider?: LLMProvider;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
  isLocal?: boolean;
}

export interface LLMResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
  _cached?: boolean;
}

export interface ProviderConfig {
  url: string;
  model: string;
  keyEnv: string | null;
}

export interface OpenAICompatibleOptions {
  maxTokens: number;
  temperature: number;
  apiKey: string | null;
  jsonMode: boolean;
  jsonSchema: Record<string, unknown> | null;
  timeoutMs: number;
  isLocal: boolean;
}

export interface AnthropicOptions {
  maxTokens: number;
  temperature: number;
  apiKey: string | null;
  jsonSchema: Record<string, unknown> | null;
}

export type ProviderDefaultsMap = Record<LLMProvider, ProviderConfig>;
