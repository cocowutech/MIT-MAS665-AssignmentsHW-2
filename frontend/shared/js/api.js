/**
 * API Client Utilities for ESL Assessment System
 * 
 * This module provides centralized API communication functionality shared across all modules.
 * It handles HTTP requests, error handling, and response processing.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// API CLIENT CLASS
// ============================================================================

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
     * @param {string} token - JWT access token
     */
    setAuthToken(token) {
        if (token) {
            this.defaultHeaders['Authorization'] = `Bearer ${token}`;
        } else {
            delete this.defaultHeaders['Authorization'];
        }
    }

    /**
     * Make HTTP request with error handling
     * @param {string} url - Request URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Object>} Response data or error
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
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            // Try to parse JSON, fallback to text
            try {
                return await response.json();
            } catch {
                return { text: await response.text() };
            }
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    /**
     * Make GET request
     * @param {string} url - Request URL
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Response data
     */
    async get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }

    /**
     * Make POST request
     * @param {string} url - Request URL
     * @param {Object} data - Request body data
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Response data
     */
    async post(url, data = null, options = {}) {
        const config = { ...options, method: 'POST' };
        
        if (data) {
            if (data instanceof FormData) {
                config.body = data;
                delete config.headers['Content-Type']; // Let browser set it
            } else {
                config.body = JSON.stringify(data);
            }
        }
        
        return this.request(url, config);
    }

    /**
     * Make PUT request
     * @param {string} url - Request URL
     * @param {Object} data - Request body data
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Response data
     */
    async put(url, data = null, options = {}) {
        const config = { ...options, method: 'PUT' };
        
        if (data) {
            config.body = JSON.stringify(data);
        }
        
        return this.request(url, config);
    }

    /**
     * Make DELETE request
     * @param {string} url - Request URL
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Response data
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
 * Listening module API functions
 */
const ListeningAPI = {
    /**
     * Start a new listening session
     * @returns {Promise<Object>} Session data
     */
    async startSession() {
        return apiClient.post('/listen/session/start', {});
    },

    /**
     * Submit answers for listening questions
     * @param {string} sessionId - Session ID
     * @param {Array} answers - Array of answers
     * @returns {Promise<Object>} Evaluation results
     */
    async submitAnswers(sessionId, answers) {
        return apiClient.post('/listen/session/submit', {
            session_id: sessionId,
            answers
        });
    },

    /**
     * Get current session state
     * @param {string} sessionId - Session ID
     * @returns {Promise<Object>} Session state
     */
    async getSessionState(sessionId) {
        return apiClient.get(`/listen/session/state?session_id=${sessionId}`);
    }
};

/**
 * Speaking module API functions
 */
const SpeakingAPI = {
    /**
     * Start a new speaking session
     * @param {string} startLevel - Initial CEFR level (A1, A2, B1, B2, C1, C2)
     * @returns {Promise<Object>} Session data with first speaking task
     */
    async startSession(startLevel) {
        return apiClient.post('/speaking/start', { start_level: startLevel });
    },

    /**
     * Submit speaking answer for evaluation
     * @param {Object} answer - Answer data with audio_data, transcript, and task_id
     * @returns {Promise<Object>} Evaluation results
     */
    async submitAnswer(answer) {
        return apiClient.post('/speaking/answer', answer);
    },

    /**
     * Get next task in current session
     * @returns {Promise<Object>} Next task or session completion status
     */
    async getNextTask() {
        return apiClient.post('/speaking/next');
    }
};

/**
 * Reading module API functions
 */
const ReadingAPI = {
    /**
     * Start a new reading session
     * @param {string} startLevel - Initial CEFR level (A1, A2, B1, B2, C1, C2)
     * @returns {Promise<Object>} Session data with first reading task
     */
    async startSession(startLevel) {
        return apiClient.post('/read/session/start', { start_level: startLevel });
    },

    /**
     * Submit reading answer for evaluation
     * @param {Object} answer - Answer data with question_id, selected_answer, and time_taken
     * @returns {Promise<Object>} Evaluation results
     */
    async submitAnswer(answer) {
        return apiClient.post('/read/session/submit', answer);
    },

    /**
     * Preload next passage and questions for faster loading
     * @param {Object} answer - Current answer data to trigger preloading
     * @returns {Promise<Object>} Preload status
     */
    async preloadNextPassage(answer) {
        return apiClient.post('/read/session/preload', answer);
    },

    /**
     * Get next question in current session
     * Note: Next question is returned in submit response, no separate endpoint needed
     * @returns {Promise<Object>} Next question or session completion status
     */
    async getNextQuestion() {
        // This method is deprecated - next question comes from submit response
        throw new Error('getNextQuestion is deprecated - use submit response instead');
    }
};

/**
 * Vocabulary module API functions
 */
const VocabularyAPI = {
    /**
     * Start a new vocabulary session
     * @param {string} startLevel - Initial CEFR level (A1, A2, B1, B2, C1, C2)
     * @returns {Promise<Object>} Session data with first vocabulary task
     */
    async startSession(startLevel) {
        return apiClient.post('/vocabulary/start', { start_level: startLevel });
    },

    /**
     * Submit vocabulary answer for evaluation
     * @param {Object} answer - Answer data with question_id, selected_answer, and time_taken
     * @returns {Promise<Object>} Evaluation results
     */
    async submitAnswer(answer) {
        return apiClient.post('/vocabulary/answer', answer);
    },

    /**
     * Get next question in current session
     * @param {string} sessionId - Session ID
     * @returns {Promise<Object>} Next question or session completion status
     */
    async getNextQuestion(sessionId) {
        return apiClient.post('/vocabulary/next_question', { session_id: sessionId });
    }
};

/**
 * Writing module API functions
 */
const WritingAPI = {
    /**
     * Start a new writing session
     * @param {string} startLevel - Initial CEFR level (A1, A2, B1, B2, C1, C2)
     * @returns {Promise<Object>} Session data with first writing task
     */
    async startSession(startLevel) {
        return apiClient.post('/write/prompt', { start_level: startLevel });
    },

    /**
     * Submit writing response for evaluation
     * @param {Object} submission - Submission data with prompt_id, text, word_count, and time_taken
     * @returns {Promise<Object>} Evaluation results
     */
    async submitResponse(submission) {
        return apiClient.post('/write/score/text', submission);
    },

    /**
     * Get next prompt in current session
     * Note: Writing module doesn't have a next endpoint - prompts are generated individually
     * @returns {Promise<Object>} Next prompt or session completion status
     */
    async getNextPrompt() {
        // This method is deprecated - writing prompts are generated individually
        throw new Error('getNextPrompt is deprecated - use startSession for new prompts');
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * DOM element selector utility
 * @param {string} id - Element ID to select
 * @returns {HTMLElement|null} DOM element or null if not found
 */
const $element = (id) => document.getElementById(id);

/**
 * Show error message to user
 * @param {string} message - Error message
 * @param {HTMLElement} element - Element to show message in
 */
function showError(message, element) {
    if (element) {
        element.textContent = message;
        element.className = 'status-message error';
        element.style.display = 'block';
    }
}

/**
 * Show success message to user
 * @param {string} message - Success message
 * @param {HTMLElement} element - Element to show message in
 */
function showSuccess(message, element) {
    if (element) {
        element.textContent = message;
        element.className = 'status-message success';
        element.style.display = 'block';
    }
}

/**
 * Show info message to user
 * @param {string} message - Info message
 * @param {HTMLElement} element - Element to show message in
 */
function showInfo(message, element) {
    if (element) {
        element.textContent = message;
        element.className = 'status-message info';
        element.style.display = 'block';
    }
}

/**
 * Clear message from element
 * @param {HTMLElement} element - Element to clear
 */
function clearMessage(element) {
    if (element) {
        element.textContent = '';
        element.style.display = 'none';
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export for use in modules
window.APIUtils = {
    apiClient,
    ListeningAPI,
    SpeakingAPI,
    ReadingAPI,
    VocabularyAPI,
    WritingAPI,
    $element,
    showError,
    showSuccess,
    showInfo,
    clearMessage
};
