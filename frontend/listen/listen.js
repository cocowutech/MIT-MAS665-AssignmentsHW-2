/**
 * Common TypeScript Interfaces for ESL Assessment System
 *
 * This file contains shared TypeScript interfaces and types used across all modules.
 * It provides type safety and consistency for data structures and API responses.
 *
 * @author ESL Assessment System
 * @version 1.0
 */
define("shared/types/common", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
/**
 * API Client Utilities for ESL Assessment System (TypeScript)
 *
 * This module provides centralized API communication functionality shared across all modules.
 * It handles HTTP requests, error handling, and response processing.
 *
 * @author ESL Assessment System
 * @version 1.0
 */
define("shared/js/api", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.WritingAPI = exports.SpeakingAPI = exports.ListeningAPI = exports.VocabularyAPI = exports.ReadingAPI = exports.apiClient = void 0;
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
    exports.apiClient = new APIClient();
    // ============================================================================
    // MODULE-SPECIFIC API FUNCTIONS
    // ============================================================================
    /**
     * Reading module API functions
     */
    exports.ReadingAPI = {
        /**
         * Start reading session
         * @param startLevel - Starting difficulty level
         * @returns Promise<APIResponse<SessionStartResponse>>
         */
        async startSession(startLevel) {
            return exports.apiClient.post('/reading/start', { start_level: startLevel });
        },
        /**
         * Submit reading answers
         * @param sessionId - Session ID
         * @param answers - User answers
         * @returns Promise<APIResponse<SessionSubmitResponse>>
         */
        async submitAnswers(sessionId, answers) {
            return exports.apiClient.post('/reading/submit', { session_id: sessionId, answers });
        }
    };
    /**
     * Vocabulary module API functions
     */
    exports.VocabularyAPI = {
        /**
         * Start vocabulary session
         * @param startLevel - Starting difficulty level
         * @returns Promise<APIResponse<SessionStartResponse>>
         */
        async startSession(startLevel) {
            return exports.apiClient.post('/vocabulary/start', { start_level: startLevel });
        },
        /**
         * Submit vocabulary answers
         * @param sessionId - Session ID
         * @param answers - User answers
         * @returns Promise<APIResponse<SessionSubmitResponse>>
         */
        async submitAnswers(sessionId, answers) {
            return exports.apiClient.post('/vocabulary/submit', { session_id: sessionId, answers });
        },
        /**
         * Submit single vocabulary answer
         * @param answer - Answer data
         * @returns Promise<APIResponse<AnswerResponse>>
         */
        async submitAnswer(answer) {
            return exports.apiClient.post('/vocabulary/answer', answer);
        },
        /**
         * Get next question in vocabulary session
         * @param sessionId - Session ID
         * @returns Promise<APIResponse<NextQuestionResponse>>
         */
        async getNextQuestion(sessionId) {
            return exports.apiClient.post('/vocabulary/next_question', { session_id: sessionId });
        }
    };
    /**
     * Listening module API functions
     */
    exports.ListeningAPI = {
        /**
         * Start listening session
         * @param startLevel - Starting difficulty level
         * @returns Promise<APIResponse<SessionStartResponse>>
         */
        async startSession(startLevel) {
            return exports.apiClient.post('/listening/start', { start_level: startLevel });
        },
        /**
         * Submit listening answers
         * @param sessionId - Session ID
         * @param answers - User answers
         * @returns Promise<APIResponse<SessionSubmitResponse>>
         */
        async submitAnswers(sessionId, answers) {
            return exports.apiClient.post('/listening/submit', { session_id: sessionId, answers });
        }
    };
    /**
     * Speaking module API functions
     */
    exports.SpeakingAPI = {
        /**
         * Start speaking session
         * @param startLevel - Starting difficulty level
         * @returns Promise<APIResponse<SessionStartResponse>>
         */
        async startSession(startLevel) {
            return exports.apiClient.post('/speaking/start', { start_level: startLevel });
        },
        /**
         * Submit speaking response
         * @param sessionId - Session ID
         * @param taskId - Task ID
         * @param transcript - Speech transcript
         * @returns Promise<APIResponse<SessionSubmitResponse>>
         */
        async submitResponse(sessionId, taskId, transcript) {
            return exports.apiClient.post('/speaking/submit', {
                session_id: sessionId,
                task_id: taskId,
                transcript
            });
        }
    };
    /**
     * Writing module API functions
     */
    exports.WritingAPI = {
        /**
         * Get writing prompt
         * @param level - Difficulty level
         * @returns Promise<APIResponse<WritingPrompt>>
         */
        async getPrompt(level) {
            return exports.apiClient.get(`/writing/prompt${level ? `?level=${level}` : ''}`);
        },
        /**
         * Submit writing response
         * @param promptId - Prompt ID
         * @param text - Written text
         * @returns Promise<APIResponse<WritingEvaluation>>
         */
        async submitResponse(promptId, text) {
            return exports.apiClient.post('/writing/submit', { prompt_id: promptId, text });
        }
    };
    // ============================================================================
    // EXPORTS
    // ============================================================================
    // DOM element selector helper
    const $element = (id) => document.getElementById(id);
    // Export for use in modules
    window.APIUtils = {
        apiClient: exports.apiClient,
        ReadingAPI: exports.ReadingAPI,
        VocabularyAPI: exports.VocabularyAPI,
        ListeningAPI: exports.ListeningAPI,
        SpeakingAPI: exports.SpeakingAPI,
        WritingAPI: exports.WritingAPI,
        $element
    };
});
// Note: Exports removed for browser compatibility
/**
 * Authentication Utilities for ESL Assessment System (TypeScript)
 *
 * This module provides centralized authentication functionality shared across all modules.
 * It handles token management, user validation, and authentication state.
 *
 * @author ESL Assessment System
 * @version 1.0
 */
define("shared/js/auth", ["require", "exports", "shared/js/api"], function (require, exports, api_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.authState = exports.AuthState = void 0;
    exports.validateToken = validateToken;
    exports.authenticateUser = authenticateUser;
    exports.logout = logout;
    exports.updateAuthHeader = updateAuthHeader;
    exports.updateUIForAuthStatus = updateUIForAuthStatus;
    exports.initializeAuth = initializeAuth;
    // ============================================================================
    // AUTHENTICATION STATE MANAGEMENT
    // ============================================================================
    /**
     * Global authentication state
     * Tracks user session and authentication status
     */
    class AuthState {
        constructor() {
            this.token = null;
            this.username = null;
            this.isAuthenticated = false;
        }
        /**
         * Initialize authentication state from localStorage
         * Restores user session if valid token exists
         */
        initialize() {
            this.token = localStorage.getItem('token');
            this.username = localStorage.getItem('username');
            this.isAuthenticated = !!this.token;
        }
        /**
         * Set authentication credentials
         * @param token - JWT access token
         * @param username - Username
         */
        setCredentials(token, username) {
            this.token = token;
            this.username = username;
            this.isAuthenticated = true;
            try {
                localStorage.setItem('token', token);
                if (username) {
                    localStorage.setItem('username', username);
                }
            }
            catch (error) {
                console.warn('Failed to save credentials to localStorage:', error);
            }
        }
        /**
         * Clear authentication credentials
         */
        clearCredentials() {
            this.token = null;
            this.username = null;
            this.isAuthenticated = false;
            try {
                localStorage.removeItem('token');
                localStorage.removeItem('username');
            }
            catch (error) {
                console.warn('Failed to clear credentials from localStorage:', error);
            }
        }
        /**
         * Get authorization header for API requests
         * @returns Authorization header value or null
         */
        getAuthHeader() {
            return this.token ? `Bearer ${this.token}` : null;
        }
    }
    exports.AuthState = AuthState;
    // Global authentication state instance
    exports.authState = new AuthState();
    // ============================================================================
    // AUTHENTICATION FUNCTIONS
    // ============================================================================
    /**
     * Validate authentication token with backend
     * @returns Promise<boolean> true if token is valid, false otherwise
     */
    async function validateToken() {
        if (!exports.authState.token)
            return false;
        try {
            const response = await fetch('/auth/me', {
                headers: { 'Authorization': exports.authState.getAuthHeader() }
            });
            if (!response.ok)
                throw new Error('Invalid token');
            const userData = await response.json().catch(() => null);
            if (userData && userData.username) {
                exports.authState.username = userData.username;
                try {
                    localStorage.setItem('username', exports.authState.username);
                }
                catch (_) {
                    // Ignore localStorage errors
                }
            }
            return true;
        }
        catch (error) {
            console.warn('Token validation failed:', error);
            exports.authState.clearCredentials();
            return false;
        }
    }
    /**
     * Authenticate user with username and password
     * @param username - Username
     * @param password - Password
     * @returns Promise<AuthResult> Authentication result
     */
    async function authenticateUser(username, password) {
        try {
            const form = new URLSearchParams();
            form.set('username', username);
            form.set('password', password);
            const response = await fetch('/auth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Authentication failed');
            }
            const data = await response.json();
            exports.authState.setCredentials(data.access_token, username);
            // Update UI to reflect authenticated state
            updateUIForAuthStatus();
            return { success: true };
        }
        catch (error) {
            console.error('Authentication error:', error);
            return { success: false, error: error.message };
        }
    }
    /**
     * Logout current user
     */
    function logout() {
        exports.authState.clearCredentials();
        // Update UI to reflect logged out state
        updateUIForAuthStatus();
    }
    // ============================================================================
    // UI INTEGRATION FUNCTIONS
    // ============================================================================
    /**
     * Update authentication header display and API client token
     * Shows current login status and provides login link when needed
     * Also updates the API client with the current authentication token
     */
    function updateAuthHeader() {
        const authStateElement = document.getElementById('authState');
        const loginLinkElement = document.getElementById('loginLink');
        if (!authStateElement)
            return;
        if (exports.authState.isAuthenticated) {
            authStateElement.textContent = exports.authState.username ?
                `Logged in as ${exports.authState.username}` : 'Logged in';
            if (loginLinkElement)
                loginLinkElement.style.display = 'none';
            // Update API client with current token
            if (window.APIUtils && window.APIUtils.apiClient) {
                window.APIUtils.apiClient.setAuthToken(exports.authState.token);
            }
        }
        else {
            authStateElement.textContent = 'Logged out';
            if (loginLinkElement)
                loginLinkElement.style.display = 'inline';
            // Clear API client token
            if (window.APIUtils && window.APIUtils.apiClient) {
                window.APIUtils.apiClient.setAuthToken(null);
            }
        }
    }
    /**
     * Show/hide login and session cards based on authentication status
     */
    function updateUIForAuthStatus() {
        console.log('updateUIForAuthStatus: authState.isAuthenticated =', exports.authState.isAuthenticated);
        const loginCard = document.getElementById('login-card');
        const sessionCard = document.getElementById('session-card');
        console.log('updateUIForAuthStatus: loginCard =', loginCard);
        console.log('updateUIForAuthStatus: sessionCard =', sessionCard);
        // Update user info display (for modules using userInfo pattern)
        const userInfo = document.getElementById('userInfo');
        const logoutBtn = document.getElementById('logoutBtn');
        // Update auth state display (for modules using authState pattern)
        const authStateEl = document.getElementById('authState');
        const loginLink = document.getElementById('loginLink');
        // Get all module cards
        const moduleCards = document.querySelectorAll('.module-card');
        if (exports.authState.isAuthenticated) {
            // Hide login form, show session interface
            if (loginCard)
                loginCard.classList.add('hidden');
            if (sessionCard)
                sessionCard.classList.remove('hidden');
            // Update user info display
            if (userInfo) {
                userInfo.textContent = `Logged in as: ${exports.authState.username || 'user'}`;
            }
            if (logoutBtn) {
                logoutBtn.classList.remove('hidden');
            }
            // Update auth state display
            if (authStateEl) {
                authStateEl.textContent = `Logged in as: ${exports.authState.username || 'user'}`;
            }
            if (loginLink) {
                loginLink.style.display = 'none';
            }
            // Show all module cards
            moduleCards.forEach(card => {
                card.classList.remove('hidden');
            });
        }
        else {
            // Show login form, hide session interface
            if (loginCard)
                loginCard.classList.remove('hidden');
            if (sessionCard)
                sessionCard.classList.add('hidden');
            // Clear user info display
            if (userInfo) {
                userInfo.textContent = '';
            }
            if (logoutBtn) {
                logoutBtn.classList.add('hidden');
            }
            // Update auth state display
            if (authStateEl) {
                authStateEl.textContent = 'Logged out';
            }
            if (loginLink) {
                loginLink.style.display = 'inline';
            }
            // Hide all module cards
            moduleCards.forEach(card => {
                card.classList.add('hidden');
            });
        }
    }
    /**
     * Initialize authentication system
     * Sets up event listeners and validates existing token
     * @returns Promise<boolean> true if user is authenticated, false otherwise
     */
    async function initializeAuth() {
        // Initialize state from localStorage
        exports.authState.initialize();
        // Set API client token immediately
        api_js_1.apiClient.setAuthToken(exports.authState.token);
        // Validate existing token if present
        if (exports.authState.token) {
            const isValid = await validateToken();
            if (!isValid) {
                exports.authState.clearCredentials();
                api_js_1.apiClient.setAuthToken(null); // Clear token from API client if invalid
            }
        }
        // Update UI based on authentication status
        updateAuthHeader();
        updateUIForAuthStatus();
        return exports.authState.isAuthenticated;
    }
    // ============================================================================
    // EXPORTS
    // ============================================================================
    // Export for use in modules
    window.AuthUtils = {
        authState: exports.authState,
        validateToken,
        authenticateUser,
        logout,
        updateAuthHeader,
        updateUIForAuthStatus,
        initializeAuth
    };
});
// Note: Exports removed for browser compatibility
/**
 * Listening Module TypeScript Implementation
 *
 * This module handles the frontend logic for the ESL listening assessment system.
 * It provides functionality for:
 * - Text-to-speech audio playback
 * - Interactive multiple choice questions
 * - Adaptive difficulty based on user performance
 * - Real-time feedback and results display
 *
 * The system integrates with the backend API endpoints:
 *
 * @author ESL Assessment System
 * @version 1.0
 */
define("listen/listen", ["require", "exports", "shared/js/auth"], function (require, exports, auth_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    // ============================================================================
    // GLOBAL STATE MANAGEMENT
    // ============================================================================
    /**
     * Listening module specific state
     * Extends shared session state with listening-specific data
     */
    class ListeningModuleState {
        constructor() {
            // Session state
            this.sessionId = null;
            this.clips = [];
            this.nextClips = null;
            // Assessment progress
            this.remaining = 0;
            this.asked = 0;
            // Text-to-speech state
            this.synth = null;
            this.speakingClipId = null;
            this.currentUtterances = [];
            // Voice management
            this.englishVoices = [];
            this.clipVoiceMap = {};
            // TTS Configuration constants
            this.DEFAULT_RATE = 0.92;
            this.DEFAULT_PITCH = 1.03;
            this.DEFAULT_VOLUME = 1.0;
        }
    }
    // Initialize module state
    const moduleState = new ListeningModuleState();
    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================
    // Using shared utilities from global scope
    // $, APIUtils, AuthUtils are available from shared/js/api.js and shared/js/auth.js
    // ============================================================================
    // TEXT-TO-SPEECH FUNCTIONALITY
    // ============================================================================
    /**
     * Score and select the best available voice for TTS
     * Prioritizes English voices with natural/neural characteristics
     * @param voices - Array of available speech synthesis voices
     * @returns Best voice or null if none available
     */
    function pickBestVoice(voices) {
        if (!voices || !voices.length)
            return null;
        const scored = voices.map(voice => {
            const name = (voice.name || '').toLowerCase();
            const lang = (voice.lang || '').toLowerCase();
            let score = 0;
            // Prefer en-US, then en-GB
            if (lang.startsWith('en-us'))
                score += 8;
            if (lang.startsWith('en-gb'))
                score += 7;
            // Prefer neural/natural/online voices
            if (name.includes('natural') || name.includes('neural') || name.includes('online'))
                score += 6;
            // Vendor preferences
            if (name.includes('microsoft'))
                score += 5;
            if (name.includes('google'))
                score += 4;
            if (name.includes('siri'))
                score += 5;
            // Mild bias to female voices for clarity
            if (name.includes('female'))
                score += 1;
            return { voice, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored[0].voice;
    }
    /**
     * Populate English voices from available speech synthesis voices
     * Filters voices to only include English language variants
     */
    function populateVoices() {
        if (!moduleState.synth)
            return;
        const voices = moduleState.synth.getVoices();
        moduleState.englishVoices = voices.filter(voice => /^en[-_]/i.test(voice.lang || ''));
    }
    /**
     * Initialize text-to-speech system
     * Sets up speech synthesis and voice management
     */
    function initTTS() {
        moduleState.synth = window.speechSynthesis || null;
        if (!moduleState.synth) {
            const warningElement = document.getElementById('ttsWarning');
            if (warningElement) {
                warningElement.textContent = 'Browser TTS not available. Audio playback disabled.';
            }
            return;
        }
        // Populate voices now (if available) and when the list changes
        try {
            populateVoices();
        }
        catch (_) {
            // Ignore voice population errors
        }
        try {
            moduleState.synth.onvoiceschanged = populateVoices;
        }
        catch (_) {
            // Ignore voice change handler errors
        }
    }
    /**
     * Apply voice and speech options to a speech synthesis utterance
     * @param utterance - Speech synthesis utterance to configure
     * @param clipId - ID of the clip for voice assignment
     */
    function applyUtterOptions(utterance, clipId) {
        let voice = null;
        const allVoices = (moduleState.synth && moduleState.synth.getVoices && moduleState.synth.getVoices()) || [];
        const assignedName = moduleState.clipVoiceMap[clipId];
        // Try to use previously assigned voice for this clip
        if (assignedName) {
            voice = (moduleState.englishVoices.find(v => v.name === assignedName) ||
                allVoices.find(v => v.name === assignedName)) || null;
        }
        // If no assigned voice, pick a random English voice or best available
        if (!voice) {
            if (moduleState.englishVoices && moduleState.englishVoices.length) {
                const idx = Math.floor(Math.random() * moduleState.englishVoices.length);
                voice = moduleState.englishVoices[idx];
                moduleState.clipVoiceMap[clipId] = voice.name;
            }
            else {
                voice = pickBestVoice(allVoices) || allVoices[0] || null;
            }
        }
        // Apply voice settings
        if (voice) {
            utterance.voice = voice;
            if (voice.lang)
                utterance.lang = voice.lang;
        }
        else {
            utterance.lang = 'en-US';
        }
        utterance.rate = moduleState.DEFAULT_RATE;
        utterance.pitch = moduleState.DEFAULT_PITCH;
        utterance.volume = moduleState.DEFAULT_VOLUME;
    }
    /**
     * Split text into chunks suitable for speech synthesis
     * Breaks text at sentence boundaries while respecting maximum length limits
     * @param text - Text to split into chunks
     * @returns Array of text chunks
     */
    function splitIntoChunks(text) {
        const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
        if (!cleaned)
            return [];
        // Split by sentence enders, keep them attached
        const parts = cleaned.match(/[^.!?\n]+[.!?\u2026]+\s*|[^.!?\n]+$/g) || [cleaned];
        const chunks = [];
        let buffer = '';
        const MAX_LEN = 180;
        for (const part of parts) {
            if ((buffer + ' ' + part).trim().length > MAX_LEN && buffer) {
                chunks.push(buffer.trim());
                buffer = part;
            }
            else {
                buffer = (buffer ? buffer + ' ' : '') + part;
            }
        }
        if (buffer.trim())
            chunks.push(buffer.trim());
        return chunks;
    }
    /**
     * Speak text segments sequentially with proper voice management
     * @param clipId - ID of the clip being spoken
     * @param segments - Array of text segments to speak
     * @param onEnd - Callback when all segments are complete
     * @param onError - Callback when an error occurs
     */
    function speakSegments(clipId, segments, onEnd, onError) {
        let idx = 0;
        moduleState.currentUtterances = [];
        function speakNext() {
            if (!moduleState.synth) {
                if (onEnd)
                    onEnd();
                return;
            }
            if (idx >= segments.length) {
                if (onEnd)
                    onEnd();
                return;
            }
            const utterance = new SpeechSynthesisUtterance(segments[idx]);
            applyUtterOptions(utterance, clipId);
            utterance.onend = () => {
                idx += 1;
                speakNext();
            };
            utterance.onerror = () => {
                if (onError)
                    onError();
            };
            moduleState.currentUtterances.push(utterance);
            moduleState.synth.speak(utterance);
        }
        speakNext();
    }
    /**
     * Start speaking a listening clip
     * @param clipId - ID of the clip to speak
     */
    function speakClip(clipId) {
        if (!moduleState.synth)
            return;
        stopSpeaking();
        const clip = moduleState.clips.find(c => c.id === clipId);
        if (!clip)
            return;
        const segments = splitIntoChunks(clip.transcript);
        moduleState.speakingClipId = clipId;
        updatePlayButtons();
        speakSegments(clipId, segments, () => {
            moduleState.speakingClipId = null;
            updatePlayButtons();
        }, () => {
            moduleState.speakingClipId = null;
            updatePlayButtons();
        });
    }
    /**
     * Stop all current speech synthesis
     */
    function stopSpeaking() {
        if (!moduleState.synth)
            return;
        moduleState.synth.cancel();
        moduleState.currentUtterances = [];
        moduleState.speakingClipId = null;
        updatePlayButtons();
    }
    /**
     * Update play button states based on current speaking status
     */
    function updatePlayButtons() {
        for (const clip of moduleState.clips) {
            const button = document.getElementById('play-' + clip.id);
            if (!button)
                continue;
            button.textContent = moduleState.speakingClipId === clip.id ? 'Stop' : 'Play';
        }
    }
    // ============================================================================
    // AUTHENTICATION FUNCTIONS
    // ============================================================================
    /**
     * Initialize the application when DOM is loaded
     * Sets up event listeners and initial state using shared utilities
     */
    async function initializeApp() {
        console.log('Listening module: Initializing app...');
        // Initialize authentication using shared utilities
        await (0, auth_js_1.initializeAuth)();
        console.log('Listening module: Auth initialized');
        // Initialize text-to-speech
        initTTS();
        console.log('Listening module: TTS initialized');
        // Add event listeners
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.addEventListener('click', async () => {
                const usernameInput = document.getElementById('username');
                const passwordInput = document.getElementById('password');
                const loginMsgElement = document.getElementById('loginMsg');
                if (!usernameInput || !passwordInput || !loginMsgElement)
                    return;
                const username = usernameInput.value.trim();
                const password = passwordInput.value;
                if (!username || !password) {
                    loginMsgElement.className = 'message error';
                    loginMsgElement.textContent = 'Please enter both username and password';
                    return;
                }
                try {
                    const authResult = await (0, auth_js_1.authenticateUser)(username, password);
                    if (authResult.success) {
                        loginMsgElement.className = 'message success';
                        loginMsgElement.textContent = `Successfully logged in as ${auth_js_1.authState.username}!`;
                    }
                    else {
                        loginMsgElement.className = 'message error';
                        loginMsgElement.textContent = `Login failed: ${authResult.error || 'Unknown error'}`;
                    }
                }
                catch (error) {
                    loginMsgElement.className = 'message error';
                    loginMsgElement.textContent = `Login failed: ${error.message}`;
                }
            });
        }
        const startBtn = document.getElementById('startBtn');
        if (startBtn)
            startBtn.addEventListener('click', startSession);
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn)
            submitBtn.addEventListener('click', submitAnswers);
    }
    // Make loadNextClips available globally for HTML onclick handler
    window.loadNextClips = loadNextClips;
    // Initialize the application when DOM is ready
    document.addEventListener('DOMContentLoaded', initializeApp);
});
