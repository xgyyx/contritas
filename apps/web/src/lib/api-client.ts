import type {
  CreateResearchRequest,
  CreateResearchResponse,
  SessionStatusResponse,
  CancelResearchResponse,
  UserRespondRequest,
  IterateResearchRequest,
  Report,
  Evidence,
} from "@/types";
import { API_URL, API_TOKEN } from "./constants";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body.details);
  }

  return res.json() as Promise<T>;
}

export const api = {
  createResearch(data: CreateResearchRequest): Promise<CreateResearchResponse> {
    return request("/api/research", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getSession(id: string): Promise<SessionStatusResponse> {
    return request(`/api/research/${id}`);
  },

  getReport(id: string): Promise<{ id: string; sessionId: string; version: number; markdownContent: string; overallScore?: string; overallVerdict?: string; charCount?: number; sourceCount?: number; generatedAt: string }> {
    return request(`/api/research/${id}/report`);
  },

  getEvidence(id: string): Promise<{ evidence: Evidence[] }> {
    return request(`/api/research/${id}/evidence`);
  },

  respond(id: string, data: UserRespondRequest): Promise<{ success: boolean }> {
    return request(`/api/research/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  iterate(id: string, data: IterateResearchRequest): Promise<CreateResearchResponse> {
    return request(`/api/research/${id}/iterate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  cancel(id: string): Promise<CancelResearchResponse> {
    return request(`/api/research/${id}`, { method: "DELETE" });
  },
};
