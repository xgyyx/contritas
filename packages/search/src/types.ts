import type { SourceType, Credibility, Relationship, Language } from "@contritas/shared";

// ══════════════════════════════════════════
// Search Provider
// ══════════════════════════════════════════

export interface SearchProvider {
  readonly name: string;
  search(params: SearchParams): Promise<SearchResult[]>;
}

export interface SearchParams {
  query: string;
  language: Language;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
}

// ══════════════════════════════════════════
// Content Extractor
// ══════════════════════════════════════════

export interface ContentExtractor {
  readonly name: string;
  extract(url: string): Promise<ExtractedContent>;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  wordCount: number;
  success: boolean;
  error?: string;
}

// ══════════════════════════════════════════
// Search Cache
// ══════════════════════════════════════════

export interface SearchCache {
  get(key: string): Promise<SearchResult[] | null>;
  set(key: string, results: SearchResult[], ttlSeconds: number): Promise<void>;
}

export interface ContentCache {
  get(url: string): Promise<ExtractedContent | null>;
  set(url: string, content: ExtractedContent, ttlSeconds: number): Promise<void>;
}

// ══════════════════════════════════════════
// Orchestrator Types
// ══════════════════════════════════════════

export interface SearchOrchestratorConfig {
  searchProvider: SearchProvider;
  fallbackSearchProvider?: SearchProvider;
  contentExtractor: ContentExtractor;
  searchConcurrencyLimit: number;
  extractConcurrencyLimit: number;
  maxSearchCallsPerSession: number;
  cache?: SearchCache;
  contentCache?: ContentCache;
}

export interface DimensionSearchInput {
  dimensionId: string;
  sessionId: string;
  name: string;
  coreQuestion: string;
  counterQuestion: string;
  keywords: { zh: string[]; en: string[] };
  maxRounds: number;
}

export interface DimensionSearchResult {
  dimensionId: string;
  evidence: EvidenceCandidate[];
  roundsUsed: number;
  searchCallsUsed: number;
  sufficient: boolean;
}

export interface EvidenceCandidate {
  url: string;
  title: string;
  sourceName: string;
  sourceType: SourceType;
  credibility: Credibility;
  publishedDate?: string;
  language: Language;
  keyExcerpt: string;
  relationship: Relationship;
  timelinessRisk: boolean;
  searchQuery: string;
  searchRound: number;
}

// ══════════════════════════════════════════
// Event Callback
// ══════════════════════════════════════════

export type SearchEventCallback = (event: SearchEvent) => void;

export type SearchEvent =
  | { type: "dimension_update"; dimensionId: string; sourcesFound: number; round: number }
  | { type: "search_executed"; query: string; language: Language; resultsCount: number }
  | { type: "evidence_added"; dimensionId: string; source: string; credibility: Credibility };
