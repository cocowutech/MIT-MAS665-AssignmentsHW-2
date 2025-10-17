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
    updateAuthHeader: function(token: string | null): void {
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
                body: JSON.stringify({ start_level: level })
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
            return APIUtils.makeRequest("/listen/session/start", {
                method: "POST",
                body: JSON.stringify({ level })
            });
        },

        submitAnswer: async function(answer: any): Promise<any> {
            return APIUtils.makeRequest("/listen/session/submit", {
                method: "POST",
                body: JSON.stringify(answer)
            });
        },

        getNextTask: async function(sessionId: string): Promise<any> {
            return APIUtils.makeRequest("/listen/session/state", {
                method: "GET"
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
        /**
         * Fetch a writing prompt from the backend and normalize it to module format
         */
        fetchPrompt: async function(level: string): Promise<any> {
            const promptResponse = await APIUtils.makeRequest("/write/prompt", {
                method: "POST",
                body: JSON.stringify({ band: level })
            });

            const promptText = typeof promptResponse?.prompt === "string"
                ? promptResponse.prompt.trim()
                : "Write approximately 350 words about a memorable experience and what you learned from it.";

            const timestampId = Date.now().toString();

            return {
                session: {
                    session_id: promptResponse?.session_id || `local-session-${timestampId}`,
                    asked: promptResponse?.asked ?? 0,
                    remaining: promptResponse?.remaining ?? 1,
                    target_cefr: promptResponse?.target_cefr || level,
                    current_level: promptResponse?.current_level || level,
                    current_prompt: {
                        id: promptResponse?.prompt_id || `prompt-${timestampId}`,
                        title: promptResponse?.title || "Writing Prompt",
                        description: promptText,
                        instructions: Array.isArray(promptResponse?.instructions) && promptResponse.instructions.length
                            ? promptResponse.instructions
                            : [
                                "Write approximately 350 words responding to the prompt below.",
                                "Organize your ideas into clear paragraphs with an introduction and conclusion.",
                                "Use a range of vocabulary and grammatical structures appropriate for the topic."
                            ],
                        word_limit: Number(promptResponse?.word_limit) || 350,
                        time_limit: Number(promptResponse?.time_limit) || 30,
                        level: promptResponse?.level || level,
                        type: promptResponse?.type || "Essay",
                        structure_hints: Array.isArray(promptResponse?.structure_hints)
                            ? promptResponse.structure_hints
                            : ["Introduction", "Main points", "Conclusion"]
                    }
                },
                finished: false
            };
        },

        startSession: async function(level: string): Promise<any> {
            return this.fetchPrompt(level);
        },

        submitAnswer: async function(answer: any): Promise<any> {
            const evaluationResponse = await APIUtils.makeRequest("/write/score/text", {
                method: "POST",
                body: JSON.stringify({ text: answer?.text || "" })
            });

            return { evaluation: evaluationResponse };
        },

        getNextTask: async function(level: string = "A2"): Promise<any> {
            return this.fetchPrompt(level);
        }
    }
};

// Export for global access
(window as any).APIUtils = APIUtils;
