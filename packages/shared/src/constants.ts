import type { PhaseId } from "./types/entities.js";

export const PHASE_IDS: PhaseId[] = [
  "inputValidation",
  "decomposition",
  "planning",
  "retrieval",
  "validation",
  "synthesis",
];

export const MAX_SEARCH_ROUNDS_PER_DIMENSION = 5;
export const MAX_SEARCH_CALLS_PER_SESSION = 150;
export const MIN_SOURCES_PER_DIMENSION = 3;
export const TARGET_SOURCES_PER_DIMENSION = 5;
export const MIN_HIGH_CREDIBILITY_SOURCES = 2;

export const SEARCH_CONCURRENT_LIMIT = 3;
export const EXTRACT_CONCURRENT_LIMIT = 5;
export const SEARCH_CACHE_TTL_SECONDS = 24 * 3600; // 24 hours
export const LLM_CACHE_TTL_SECONDS = 7 * 24 * 3600; // 7 days
export const EVENT_TTL_SECONDS = 7 * 24 * 3600; // 7 days

export const WORKER_LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
export const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
export const CLARIFICATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
