/**
 * API Client Utilities for ESL Assessment System (TypeScript)
 * 
 * This module provides centralized API communication functionality shared across all modules.
 * It handles HTTP requests, error handling, and response processing.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

import { APIResponse, APIError } from '../types/common.js';

// ============================================================================
// API CLIENT CLASS
// ============================================================================

/**
 * Request configuration interface
 */
interface RequestConfig extends RequestInit {
    headers?: Record<string, string>;
}

/**
 * Centralized API client for making HTTP requests
 * Provides consistent error handling and authentication
 */
class APIClient {
    private baseURL: string = '';
    private defaultHeaders: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    /**
     * Set authorization token for requests
     * @param token - JWT access token
     */
    setAuthToken(token: string | null): void {
        if (token) {
            this.defaultHeaders['Authorization'] = `Bearer ${token}`;
        } else {
            delete this.defaultHeaders['Authorization'];
        }
    }

    /**
     * Make HTTP request with error handling
     * @param url - Request URL
     * @param options - Fetch options
     * @returns Promise<APIResponse<T>> Response data or error
     */
    async request<T = any>(url: string, options: RequestConfig = {}): Promise<APIResponse<T>> {
        const config: RequestInit = {
            ...options,
            headers: {
                ...this.defaultHeaders,
                ...options.headers
            }
        };

        try {
            const response: Response = await fetch(url, config);
            
            if (!response.ok) {
                const errorData: APIError = await response.json().catch(() => ({
                    detail: `HTTP ${response.status}: ${response.statusText}`,
                    status_code: response.status
                }));
                
                return {
                    success: false,
                    error: errorData
                };
            }

            const data: T = await response.json();
            return {
                success: true,
                data
            };
        } catch (error) {
            console.error('API request failed:', error);
            return {
                success: false,
                error: {
                    detail: (error as Error).message,
                    status_code: 0
                }
            };
        }
    }

    /**
     * Make GET request
     * @param url - Request URL
     * @param options - Additional options
     * @returns Promise<APIResponse<T>> Response data
     */
    async get<T = any>(url: string, options: RequestConfig = {}): Promise<APIResponse<T>> {
        return this.request<T>(url, { ...options, method: 'GET' });
    }

    /**
     * Make POST request
     * @param url - Request URL
     * @param data - Request body data
     * @param options - Additional options
     * @returns Promise<APIResponse<T>> Response data
     */
    async post<T = any>(url: string, data?: any, options: RequestConfig = {}): Promise<APIResponse<T>> {
        return this.request<T>(url, {
            ...options,
            method: 'POST',
            body: data ? JSON.stringify(data) : null
        });
    }

    /**
     * Make PUT request
     * @param url - Request URL
     * @param data - Request body data
     * @param options - Additional options
     * @returns Promise<APIResponse<T>> Response data
     */
    async put<T = any>(url: string, data?: any, options: RequestConfig = {}): Promise<APIResponse<T>> {
        return this.request<T>(url, {
            ...options,
            method: 'PUT',
            body: data ? JSON.stringify(data) : null
        });
    }

    /**
     * Make DELETE request
     * @param url - Request URL
     * @param options - Additional options
     * @returns Promise<APIResponse<T>> Response data
     */
    async delete<T = any>(url: string, options: RequestConfig = {}): Promise<APIResponse<T>> {
        return this.request<T>(url, { ...options, method: 'DELETE' });
    }
}

// Global API client instance
export const apiClient = new APIClient();

// ============================================================================
// MODULE-SPECIFIC API FUNCTIONS
// ============================================================================

/**
 * Reading module API functions
 */
export const ReadingAPI = {
    /**
     * Start reading session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel?: string): Promise<APIResponse<any>> {
        return apiClient.post('/reading/start', { start_level: startLevel });
    },

    /**
     * Submit reading answers
     * @param sessionId - Session ID
     * @param answers - User answers
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitAnswers(sessionId: string, answers: any[]): Promise<APIResponse<any>> {
        return apiClient.post('/reading/submit', { session_id: sessionId, answers });
    }
};

/**
 * Vocabulary module API functions
 */
export const VocabularyAPI = {
    /**
     * Start vocabulary session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel?: string): Promise<APIResponse<any>> {
        return apiClient.post('/vocabulary/start', { start_level: startLevel });
    },

    /**
     * Submit vocabulary answers
     * @param sessionId - Session ID
     * @param answers - User answers
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitAnswers(sessionId: string, answers: any[]): Promise<APIResponse<any>> {
        return apiClient.post('/vocabulary/submit', { session_id: sessionId, answers });
    },

    /**
     * Submit single vocabulary answer
     * @param answer - Answer data
     * @returns Promise<APIResponse<AnswerResponse>>
     */
    async submitAnswer(answer: any): Promise<APIResponse<any>> {
        return apiClient.post('/vocabulary/answer', answer);
    },

    /**
     * Get next question in vocabulary session
     * @param sessionId - Session ID
     * @returns Promise<APIResponse<NextQuestionResponse>>
     */
    async getNextQuestion(sessionId: string): Promise<APIResponse<any>> {
        return apiClient.post('/vocabulary/next_question', { session_id: sessionId });
    }
};

/**
 * Listening module API functions
 */
export const ListeningAPI = {
    /**
     * Start listening session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel?: string): Promise<APIResponse<any>> {
        return apiClient.post('/listening/start', { start_level: startLevel });
    },

    /**
     * Submit listening answers
     * @param sessionId - Session ID
     * @param answers - User answers
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitAnswers(sessionId: string, answers: any[]): Promise<APIResponse<any>> {
        return apiClient.post('/listening/submit', { session_id: sessionId, answers });
    }
};

/**
 * Speaking module API functions
 */
export const SpeakingAPI = {
    /**
     * Start speaking session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel?: string): Promise<APIResponse<any>> {
        return apiClient.post('/speaking/start', { start_level: startLevel });
    },

    /**
     * Submit speaking response
     * @param sessionId - Session ID
     * @param taskId - Task ID
     * @param transcript - Speech transcript
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitResponse(sessionId: string, taskId: string, transcript: string): Promise<APIResponse<any>> {
        return apiClient.post('/speaking/submit', { 
            session_id: sessionId, 
            task_id: taskId, 
            transcript 
        });
    }
};

/**
 * Writing module API functions
 */
export const WritingAPI = {
    /**
     * Get writing prompt
     * @param level - Difficulty level
     * @returns Promise<APIResponse<WritingPrompt>>
     */
    async getPrompt(level?: string): Promise<APIResponse<any>> {
        return apiClient.get(`/writing/prompt${level ? `?level=${level}` : ''}`);
    },

    /**
     * Submit writing response
     * @param promptId - Prompt ID
     * @param text - Written text
     * @returns Promise<APIResponse<WritingEvaluation>>
     */
    async submitResponse(promptId: string, text: string): Promise<APIResponse<any>> {
        return apiClient.post('/writing/submit', { prompt_id: promptId, text });
    }
};

// ============================================================================
// EXPORTS
// ============================================================================

// DOM element selector helper
const $element = (id: string): HTMLElement | null => document.getElementById(id);

// Export for use in modules
(window as any).APIUtils = {
    apiClient,
    ReadingAPI,
    VocabularyAPI,
    ListeningAPI,
    SpeakingAPI,
    WritingAPI,
    $element
};

// Note: Exports removed for browser compatibility
