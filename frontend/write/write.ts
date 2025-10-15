/**
 * Writing Module TypeScript Implementation
 * 
 * This file contains the TypeScript implementation for the writing assessment module.
 * It provides a complete writing evaluation system with text input, adaptive difficulty,
 * and real-time feedback integration with the backend API.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Writing prompt interface
 */
interface WritingPrompt {
    id: string;
    title: string;
    description: string;
    instructions: string[];
    word_limit: number;
    time_limit: number;
    level: string;
    type: string;
    structure_hints?: string[];
}

/**
 * Writing session interface
 */
interface WritingSession {
    session_id: string;
    current_prompt: WritingPrompt;
    asked: number;
    remaining: number;
    target_cefr: string;
    current_level: string;
}

/**
 * Writing submission interface
 */
interface WritingSubmission {
    prompt_id: string;
    text: string;
    word_count: number;
    time_taken: number;
}

/**
 * Writing evaluation result interface
 */
interface WritingEvaluation {
    score: number;
    content_score: number;
    organization_score: number;
    language_score: number;
    feedback: string;
    suggestions?: string[];
    level_adjustment: number;
}

/**
 * Writing session response interface
 */
interface WritingSessionResponse {
    session: WritingSession;
    evaluation?: WritingEvaluation;
    finished: boolean;
    final_score?: number;
}

// ============================================================================
// GLOBAL DECLARATIONS
// ============================================================================

import { authState, authenticateUser, logout, updateAuthHeader, updateUIForAuthStatus, initializeAuth } from '../shared/js/auth.js';
declare const APIUtils: any;

// ============================================================================
// WRITING MODULE STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management for the writing module
 */
class WritingModuleState {
    // Session state
    public session: WritingSession | null = null;
    public currentPrompt: WritingPrompt | null = null;
    public currentText: string = '';
    public sessionStartTime: number = 0;
    public promptStartTime: number = 0;
    
    // UI state
    public isSubmissionInProgress: boolean = false;
    public showResults: boolean = false;
    public isSessionActive: boolean = false;
    
    constructor() {
    }
    
    /**
     * Reset session state
     */
    public resetSessionState(): void {
        this.session = null;
        this.currentPrompt = null;
        this.currentText = '';
        this.sessionStartTime = 0;
        this.promptStartTime = 0;
        this.isSubmissionInProgress = false;
        this.showResults = false;
        this.isSessionActive = false;
    }
    
    /**
     * Start prompt timer
     */
    public startPromptTimer(): void {
        this.promptStartTime = Date.now();
    }
    
    /**
     * Get time taken for current prompt
     */
    public getPromptTime(): number {
        if (this.promptStartTime === 0) return 0;
        return Date.now() - this.promptStartTime;
    }
    
    /**
     * Get word count of current text
     */
    public getWordCount(): number {
        if (!this.currentText.trim()) return 0;
        return this.currentText.trim().split(/\s+/).length;
    }
}

// ============================================================================
// GLOBAL STATE INSTANCE
// ============================================================================

const moduleState = new WritingModuleState();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// $ function removed - use APIUtils.$element instead

/**
 * Show an element by removing the 'hidden' class
 * @param el - Element ID or DOM element
 */
function show(el: string | HTMLElement): void {
    const node = typeof el === 'string' ? APIUtils.$element(el) : el;
    if (!node) return;
    node.classList.remove('hidden');
}

/**
 * Hide an element by adding the 'hidden' class
 * @param el - Element ID or DOM element
 */
function hide(el: string | HTMLElement): void {
    const node = typeof el === 'string' ? APIUtils.$element(el) : el;
    if (!node) return;
    node.classList.add('hidden');
}

/**
 * Format time in milliseconds to readable format
 * @param ms - Time in milliseconds
 * @returns Formatted time string
 */
function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${remainingSeconds}s`;
}

/**
 * Calculate progress percentage
 * @param current - Current progress
 * @param total - Total progress
 * @returns Progress percentage
 */
function calculateProgress(current: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((current / total) * 100);
}

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

/**
 * Initialize the writing module
 */
async function initializeWritingModule(): Promise<void> {
    // Initialize authentication first
    await initializeAuth();
    
    // Set up event listeners
    const loginBtn = APIUtils.$element('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const usernameInput = APIUtils.$element('username') as HTMLInputElement;
            const passwordInput = APIUtils.$element('password') as HTMLInputElement;
            const loginMsgElement = APIUtils.$element('loginMsg') as HTMLElement;

            if (!usernameInput || !passwordInput || !loginMsgElement) return;

            const username = usernameInput.value.trim();
            const password = passwordInput.value;

            if (!username || !password) {
                loginMsgElement.className = 'message error';
                loginMsgElement.textContent = 'Please enter both username and password';
                return;
            }

            try {
                const authResult = await authenticateUser(username, password);
                if (authResult.success) {
                    loginMsgElement.className = 'message success';
                    loginMsgElement.textContent = `Successfully logged in as ${authState.username}!`;
                } else {
                    loginMsgElement.className = 'message error';
                    loginMsgElement.textContent = `Login failed: ${authResult.error || 'Unknown error'}`;
                }
            } catch (error) {
                loginMsgElement.className = 'message error';
                loginMsgElement.textContent = `Login failed: ${(error as Error).message}`;
            }
        });
    }
    
    const startBtn = APIUtils.$element('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', handleStartSession);
    }
    
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', handleSubmitWriting);
    }
    
    const continueBtn = APIUtils.$element('continueBtn');
    if (continueBtn) {
        continueBtn.addEventListener('click', continueToNext);
    }
    
    // Authentication state is managed by updateUIForAuthStatus()
    
    // Initialize UI state
    hide('assessment-interface');
    hide('results');
    hide('continueBtn');
}
