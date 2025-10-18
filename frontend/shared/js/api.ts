/**
 * API utilities for the ESL Assessment System
 * This file provides common API functions used across modules
 */

const VALID_CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

const sanitizeWritingText = (value: unknown): string => {
    if (typeof value !== "string") return "";
    let text = value.trim();
    if (!text) return "";

    // Remove fenced code blocks
    text = text.replace(/^```json\s*/i, "");
    text = text.replace(/^```/i, "");
    text = text.replace(/```$/i, "");

    // Attempt to extract prompt value from inline JSON
    const promptMatch = text.match(/"prompt"\s*:\s*"([\s\S]*?)"\s*}?$/i);
    if (promptMatch) {
        text = promptMatch[1];
    }

    try {
        // Final attempt to parse as JSON
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.prompt === "string") {
            text = parsed.prompt;
        }
    } catch (_err) {
        // Ignore parse errors; fall back to cleaned text
    }

    text = text.replace(/\\n/g, "\n").replace(/\\"/g, '"');

    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1);
    }

    return text.trim();
};

const normalizeCefrLevel = (value: unknown, fallback: string = "A2"): string => {
    if (typeof value === "string") {
        const level = value.trim().toUpperCase();
        if (VALID_CEFR_LEVELS.includes(level as typeof VALID_CEFR_LEVELS[number])) {
            return level;
        }
    }
    return fallback;
};

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
            return APIUtils.makeRequest("/read/session/start", {
                method: "POST",
                body: JSON.stringify({ start_level: level })
            });
        },

        submitAnswer: async function(answer: any): Promise<any> {
            return APIUtils.makeRequest("/read/session/submit", {
                method: "POST",
                body: JSON.stringify(answer)
            });
        },

        getSessionState: async function(sessionId: string): Promise<any> {
            return APIUtils.makeRequest(`/read/session/state?session_id=${encodeURIComponent(sessionId)}`, {
                method: "GET"
            });
        },

        preloadNextPassage: async function(payload: any): Promise<any> {
            return APIUtils.makeRequest("/read/session/preload", {
                method: "POST",
                body: JSON.stringify(payload)
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

        getNextQuestion: async function(sessionId: string): Promise<any> {
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
                ? sanitizeWritingText(promptResponse.prompt)
                : "Write approximately 350 words about a memorable experience and what you learned from it.";

            const timestampId = Date.now().toString();

            const normalizedInstructions = Array.isArray(promptResponse?.instructions) && promptResponse.instructions.length
                ? promptResponse.instructions.map((entry: unknown) => sanitizeWritingText(entry)).filter((entry: string) => entry.length > 0)
                : [
                    "Write approximately 350 words responding to the prompt below.",
                    "Organize your ideas into clear paragraphs with an introduction and conclusion.",
                    "Use a range of vocabulary and grammatical structures appropriate for the topic."
                ];

            const normalizedHints = Array.isArray(promptResponse?.structure_hints)
                ? promptResponse.structure_hints
                    .map((entry: unknown) => sanitizeWritingText(entry))
                    .filter((entry: string) => entry.length > 0)
                : ["Introduction", "Main points", "Conclusion"];

            const normalizedLevel = normalizeCefrLevel(promptResponse?.level || level, level);
            const normalizedType = typeof promptResponse?.type === "string" && promptResponse.type.trim()
                ? promptResponse.type.trim()
                : "Essay";

            const normalizedTitle = typeof promptResponse?.title === "string" && promptResponse.title.trim()
                ? sanitizeWritingText(promptResponse.title)
                : "Writing Prompt";

            const timeLimit = Number(promptResponse?.time_limit);
            const normalizedTimeLimit = Number.isFinite(timeLimit) && timeLimit > 0 ? timeLimit : 30;
            const wordLimit = Number(promptResponse?.word_limit);
            const normalizedWordLimit = Number.isFinite(wordLimit) && wordLimit > 0 ? wordLimit : 350;

            return {
                session: {
                    session_id: promptResponse?.session_id || `local-session-${timestampId}`,
                    asked: promptResponse?.asked ?? 0,
                    remaining: promptResponse?.remaining ?? 1,
                    target_cefr: normalizeCefrLevel(promptResponse?.target_cefr || level, level),
                    current_level: normalizedLevel,
                    current_prompt: {
                        id: promptResponse?.prompt_id || `prompt-${timestampId}`,
                        title: normalizedTitle,
                        description: promptText,
                        instructions: normalizedInstructions,
                        word_limit: normalizedWordLimit,
                        time_limit: normalizedTimeLimit,
                        level: normalizedLevel,
                        type: normalizedType,
                        structure_hints: normalizedHints
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
        },

        getDefaultLevel: async function(): Promise<string> {
            try {
                const response = await APIUtils.makeRequest("/write/default_band", {
                    method: "GET"
                });
                return normalizeCefrLevel(response?.band, "A2");
            } catch (_error) {
                return "A2";
            }
        }
    }
};

// Export for global access
(window as any).APIUtils = APIUtils;
