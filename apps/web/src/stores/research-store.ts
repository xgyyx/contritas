import { create } from "zustand";
import type {
  SessionStatus,
  PhaseState,
  ComplexityLevel,
  TokenUsage,
  ProgressEvent,
  Report,
} from "@/types";

interface DimensionState {
  id: string;
  sourcesFound: number;
  round: number;
}

interface SearchLogEntry {
  query: string;
  language: "zh" | "en";
  resultsCount: number;
  timestamp: string;
}

interface EvidenceFeedEntry {
  dimensionId: string;
  source: string;
  credibility: "high" | "medium" | "low";
  timestamp: string;
}

interface ErrorEntry {
  message: string;
  recoverable: boolean;
  timestamp: string;
}

interface ResearchState {
  // Session metadata
  sessionId: string | null;
  status: SessionStatus | null;
  complexity: ComplexityLevel | null;
  phases: PhaseState[];
  tokenUsage: TokenUsage | null;
  searchCallsUsed: number;
  estimatedSecondsRemaining: number | null;

  // Research data
  dimensions: Map<string, DimensionState>;
  searchLog: SearchLogEntry[];
  evidenceFeed: EvidenceFeedEntry[];
  errors: ErrorEntry[];

  // Clarification state
  clarificationQuestions: string[];
  suggestedDirections: string[];

  // Report state
  report: Report | null;

  // Connection state
  isConnected: boolean;
  reconnectCount: number;

  // Validation
  contradictionsFound: number | null;

  // Actions
  setSessionId: (id: string) => void;
  reset: () => void;
  handleEvent: (event: ProgressEvent) => void;
  setStatus: (status: SessionStatus) => void;
  setPhases: (phases: PhaseState[]) => void;
  setReport: (report: Report) => void;
  setConnected: (connected: boolean) => void;
  incrementReconnect: () => void;
  clearClarification: () => void;
  setTokenUsage: (usage: TokenUsage) => void;
  setSearchCallsUsed: (count: number) => void;
  setComplexity: (level: ComplexityLevel) => void;
}

const initialState = {
  sessionId: null,
  status: null,
  complexity: null,
  phases: [],
  tokenUsage: null,
  searchCallsUsed: 0,
  estimatedSecondsRemaining: null,
  dimensions: new Map<string, DimensionState>(),
  searchLog: [],
  evidenceFeed: [],
  errors: [],
  clarificationQuestions: [],
  suggestedDirections: [],
  report: null,
  isConnected: false,
  reconnectCount: 0,
  contradictionsFound: null,
};

export const useResearchStore = create<ResearchState>((set, get) => ({
  ...initialState,

  setSessionId: (id) => set({ sessionId: id }),

  reset: () => set({ ...initialState, dimensions: new Map() }),

  setStatus: (status) => set({ status }),

  setPhases: (phases) => set({ phases }),

  setReport: (report) => set({ report }),

  setConnected: (connected) => set({ isConnected: connected }),

  incrementReconnect: () => set((s) => ({ reconnectCount: s.reconnectCount + 1 })),

  clearClarification: () => set({ clarificationQuestions: [], suggestedDirections: [] }),

  setTokenUsage: (usage) => set({ tokenUsage: usage }),

  setSearchCallsUsed: (count) => set({ searchCallsUsed: count }),

  setComplexity: (level) => set({ complexity: level }),

  handleEvent: (event) => {
    const state = get();

    switch (event.type) {
      case "phase_change": {
        const phases = state.phases.map((p) =>
          p.id === event.phase
            ? {
                ...p,
                status: event.status === "started" ? ("started" as const) : ("completed" as const),
                ...(event.status === "started" ? { startedAt: event.timestamp } : { completedAt: event.timestamp }),
              }
            : p
        );
        set({ phases });
        break;
      }

      case "dimension_update": {
        const dimensions = new Map(state.dimensions);
        dimensions.set(event.dimensionId, {
          id: event.dimensionId,
          sourcesFound: event.sourcesFound,
          round: event.round,
        });
        set({ dimensions });
        break;
      }

      case "search_executed": {
        set({
          searchLog: [
            ...state.searchLog,
            {
              query: event.query,
              language: event.language,
              resultsCount: event.resultsCount,
              timestamp: event.timestamp,
            },
          ],
        });
        break;
      }

      case "evidence_added": {
        set({
          evidenceFeed: [
            ...state.evidenceFeed,
            {
              dimensionId: event.dimensionId,
              source: event.source,
              credibility: event.credibility,
              timestamp: event.timestamp,
            },
          ],
        });
        break;
      }

      case "error": {
        set({
          errors: [
            ...state.errors,
            {
              message: event.message,
              recoverable: event.recoverable,
              timestamp: event.timestamp,
            },
          ],
        });
        break;
      }

      case "eta_update": {
        set({ estimatedSecondsRemaining: event.estimatedSecondsRemaining });
        break;
      }

      case "report_ready": {
        set({ status: "completed" });
        break;
      }

      case "clarification": {
        set({
          status: "awaiting_input",
          clarificationQuestions: event.questions,
          suggestedDirections: event.suggestedDirections ?? [],
        });
        break;
      }

      case "validation_complete": {
        set({ contradictionsFound: event.contradictionsFound });
        break;
      }
    }
  },
}));

// Selectors
export const selectCurrentPhase = (state: ResearchState) =>
  state.phases.find((p) => p.status === "started");

export const selectCompletedPhaseCount = (state: ResearchState) =>
  state.phases.filter((p) => p.status === "completed").length;

export const selectProgressPercent = (state: ResearchState) => {
  if (state.phases.length === 0) return 0;
  const completed = state.phases.filter((p) => p.status === "completed").length;
  const started = state.phases.filter((p) => p.status === "started").length;
  return Math.round(((completed + started * 0.5) / state.phases.length) * 100);
};
