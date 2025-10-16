/**
 * API utilities for the ESL Assessment System
 * This file provides common API functions used across modules
 */

// API utilities namespace
const APIUtils = {
    // API base URL
    baseUrl: "",
    
    // Authentication token
    authToken: null as string | null,

    /**
     * Update authentication token for API requests
     */
    updateAuthHeader: function(token: string): void {
        this.authToken = token;
    },

    /**
     * Get DOM element by ID
     */
    $element: function(id: string): HTMLElement | null {
        return document.getElementById(id);
    },

    /**
     * Make API request with authentication
     */
    makeRequest: async function(endpoint: string, options: RequestInit = {}): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            ...options.headers
        };

        if (this.authToken) {
            headers["Authorization"] = `Bearer ${this.authToken}`;
        }

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        return response.json();
    },

    /**
     * Speaking API methods
     */
    SpeakingAPI: {
        startSession: async function(level: string): Promise<any> {
            return APIUtils.makeRequest("/speaking/start", {
                method: "POST",
                body: JSON.stringify({ level })
            });
        },

        submitAnswer: async function(answer: any): Promise<any> {
            return APIUtils.makeRequest("/speaking/answer", {
                method: "POST",
                body: JSON.stringify(answer)
            });
        },

        getNextTask: async function(sessionId: string): Promise<any> {
            return APIUtils.makeRequest("/speaking/next", {
                method: "POST",
                body: JSON.stringify({ session_id: sessionId })
            });
        }
    },

    /**
     * Listening API methods
     */
    ListeningAPI: {
        startSession: async function(level: string): Promise<any> {
            return APIUtils.makeRequest("/listening/start", {
                method: "POST",
                body: JSON.stringify({ level })
            });
        },

        submitAnswer: async function(answer: any): Promise<any> {
            return APIUtils.makeRequest("/listening/answer", {
                method: "POST",
                body: JSON.stringify(answer)
            });
        },

        getNextTask: async function(sessionId: string): Promise<any> {
            return APIUtils.makeRequest("/listening/next", {
                method: "POST",
                body: JSON.stringify({ session_id: sessionId })
            });
        }
    },

    /**
     * Reading API methods
     */
    ReadingAPI: {
        startSession: async function(level: string): Promise<any> {
            return APIUtils.makeRequest("/reading/start", {
                method: "POST",
                body: JSON.stringify({ level })
            });
        },

        submitAnswer: async function(answer: any): Promise<any> {
            return APIUtils.makeRequest("/reading/answer", {
                method: "POST",
                body: JSON.stringify(answer)
            });
        },

        getNextTask: async function(sessionId: string): Promise<any> {
            return APIUtils.makeRequest("/reading/next", {
                method: "POST",
                body: JSON.stringify({ session_id: sessionId })
            });
        }
    },

    /**
     * Vocabulary API methods
     */
    VocabularyAPI: {
        startSession: async function(level: string): Promise<any> {
            return APIUtils.makeRequest("/vocabulary/start", {
                method: "POST",
                body: JSON.stringify({ level })
            });
        },

        submitAnswer: async function(answer: any): Promise<any> {
            return APIUtils.makeRequest("/vocabulary/answer", {
                method: "POST",
                body: JSON.stringify(answer)
            });
        },

        getNextTask: async function(sessionId: string): Promise<any> {
            return APIUtils.makeRequest("/vocabulary/next", {
                method: "POST",
                body: JSON.stringify({ session_id: sessionId })
            });
        }
    },

    /**
     * Writing API methods
     */
    WritingAPI: {
        startSession: async function(level: string): Promise<any> {
            return APIUtils.makeRequest("/writing/start", {
                method: "POST",
                body: JSON.stringify({ level })
            });
        },

        submitAnswer: async function(answer: any): Promise<any> {
            return APIUtils.makeRequest("/writing/answer", {
                method: "POST",
                body: JSON.stringify(answer)
            });
        },

        getNextTask: async function(sessionId: string): Promise<any> {
            return APIUtils.makeRequest("/writing/next", {
                method: "POST",
                body: JSON.stringify({ session_id: sessionId })
            });
        }
    }
};

// Export for global access
(window as any).APIUtils = APIUtils;
