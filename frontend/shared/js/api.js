/**
 * API Client Utilities for ESL Assessment System (TypeScript)
 *
 * This module provides centralized API communication functionality shared across all modules.
 * It handles HTTP requests, error handling, and response processing.
 *
 * @author ESL Assessment System
 * @version 1.0
 */
/**
 * Centralized API client for making HTTP requests
 * Provides consistent error handling and authentication
 */
class APIClient {
    constructor() {
        this.baseURL = '';
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
    }
    /**
     * Set authorization token for requests
     * @param token - JWT access token
     */
    setAuthToken(token) {
        if (token) {
            this.defaultHeaders['Authorization'] = `Bearer ${token}`;
        }
        else {
            delete this.defaultHeaders['Authorization'];
        }
    }
    /**
     * Make HTTP request with error handling
     * @param url - Request URL
     * @param options - Fetch options
     * @returns Promise<APIResponse<T>> Response data or error
     */
    async request(url, options = {}) {
        const config = {
            ...options,
            headers: {
                ...this.defaultHeaders,
                ...options.headers
            }
        };
        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({
                    detail: `HTTP ${response.status}: ${response.statusText}`,
                    status_code: response.status
                }));
                return {
                    success: false,
                    error: errorData
                };
            }
            const data = await response.json();
            return {
                success: true,
                data
            };
        }
        catch (error) {
            console.error('API request failed:', error);
            return {
                success: false,
                error: {
                    detail: error.message,
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
    async get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }
    /**
     * Make POST request
     * @param url - Request URL
     * @param data - Request body data
     * @param options - Additional options
     * @returns Promise<APIResponse<T>> Response data
     */
    async post(url, data, options = {}) {
        return this.request(url, {
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
    async put(url, data, options = {}) {
        return this.request(url, {
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
    async delete(url, options = {}) {
        return this.request(url, { ...options, method: 'DELETE' });
    }
}
// Global API client instance
const apiClient = new APIClient();
// ============================================================================
// MODULE-SPECIFIC API FUNCTIONS
// ============================================================================
/**
 * Reading module API functions
 */
    /**
     * Start reading session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel) {
        return apiClient.post('/reading/start', { start_level: startLevel });
    },
    /**
     * Submit reading answers
     * @param sessionId - Session ID
     * @param answers - User answers
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitAnswers(sessionId, answers) {
        return apiClient.post('/reading/submit', { session_id: sessionId, answers });
    }
};
/**
 * Vocabulary module API functions
 */
    /**
     * Start vocabulary session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel) {
        return apiClient.post('/vocabulary/start', { start_level: startLevel });
    },
    /**
     * Submit vocabulary answers
     * @param sessionId - Session ID
     * @param answers - User answers
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitAnswers(sessionId, answers) {
        return apiClient.post('/vocabulary/submit', { session_id: sessionId, answers });
    },
    /**
     * Submit single vocabulary answer
     * @param answer - Answer data
     * @returns Promise<APIResponse<AnswerResponse>>
     */
    async submitAnswer(answer) {
        return apiClient.post('/vocabulary/answer', answer);
    },
    /**
     * Get next question in vocabulary session
     * @param sessionId - Session ID
     * @returns Promise<APIResponse<NextQuestionResponse>>
     */
    async getNextQuestion(sessionId) {
        return apiClient.post('/vocabulary/next_question', { session_id: sessionId });
    }
};
/**
 * Listening module API functions
 */
    /**
     * Start listening session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel) {
        return apiClient.post('/listening/start', { start_level: startLevel });
    },
    /**
     * Submit listening answers
     * @param sessionId - Session ID
     * @param answers - User answers
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitAnswers(sessionId, answers) {
        return apiClient.post('/listening/submit', { session_id: sessionId, answers });
    }
};
/**
 * Speaking module API functions
 */
    /**
     * Start speaking session
     * @param startLevel - Starting difficulty level
     * @returns Promise<APIResponse<SessionStartResponse>>
     */
    async startSession(startLevel) {
        return apiClient.post('/speaking/start', { start_level: startLevel });
    },
    /**
     * Submit speaking response
     * @param sessionId - Session ID
     * @param taskId - Task ID
     * @param transcript - Speech transcript
     * @returns Promise<APIResponse<SessionSubmitResponse>>
     */
    async submitResponse(sessionId, taskId, transcript) {
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
    /**
     * Get writing prompt
     * @param level - Difficulty level
     * @returns Promise<APIResponse<WritingPrompt>>
     */
    async getPrompt(level) {
        return apiClient.get(`/writing/prompt${level ? `?level=${level}` : ''}`);
    },
    /**
     * Submit writing response
     * @param promptId - Prompt ID
     * @param text - Written text
     * @returns Promise<APIResponse<WritingEvaluation>>
     */
    async submitResponse(promptId, text) {
        return apiClient.post('/writing/submit', { prompt_id: promptId, text });
    }
};
// ============================================================================
// EXPORTS
// ============================================================================
// DOM element selector helper
const $element = (id) => document.getElementById(id);
// Export for use in modules
window.APIUtils = {
    apiClient,
    ReadingAPI,
    VocabularyAPI,
    ListeningAPI,
    SpeakingAPI,
    WritingAPI,
    $element
};
// Note: Exports removed for browser compatibility
//# sourceMappingURL=api.js.map