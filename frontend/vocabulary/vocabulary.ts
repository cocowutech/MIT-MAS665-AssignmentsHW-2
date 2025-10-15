/**
 * Vocabulary Module TypeScript Implementation
 * 
 * This file contains the TypeScript implementation for the vocabulary assessment module.
 * It provides a complete vocabulary evaluation system with multiple choice questions,
 * adaptive difficulty, and real-time feedback integration with the backend API.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Vocabulary question interface
 */
interface VocabularyQuestion {
    id: string;
    cefr: string;
    exam_target: string;
    passage: string;
    question: string;
    options: string[];
    answer_index: number;
    rationale?: string;
}

/**
 * Vocabulary session interface
 */
interface VocabularySession {
    session_id: string;
    current_question: VocabularyQuestion;
    asked: number;
    remaining: number;
    target_cefr: string;
    current_level: string;
}

/**
 * Vocabulary answer interface
 */
interface VocabularyAnswer {
    session_id: string;
    question_id: string;
    choice_index: number;
}

/**
 * Vocabulary evaluation result interface
 */
interface VocabularyEvaluation {
    correct: boolean;
    level: string;
    progress_current: number;
    progress_total: number;
    finished: boolean;
    explanation?: string;
}

/**
 * Vocabulary session response interface
 */
interface VocabularySessionResponse {
    session: VocabularySession;
    evaluation?: VocabularyEvaluation;
    finished: boolean;
    final_score?: number;
}

// ============================================================================
// GLOBAL DECLARATIONS
// ============================================================================

import { authState, authenticateUser, logout, updateAuthHeader, updateUIForAuthStatus, initializeAuth } from '../shared/js/auth.js';
declare const APIUtils: any;

// ============================================================================
// VOCABULARY MODULE STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management for the vocabulary module
 */
class VocabularyModuleState {
    // Session state
    public session: VocabularySession | null = null;
    public currentQuestion: VocabularyQuestion | null = null;
    public selectedAnswer: number | null = null;
    public questionStartTime: number = 0;
    public sessionStartTime: number = 0;
    
    // UI state
    public isQuestionAnswered: boolean = false;
    public showResults: boolean = false;
    public isSessionActive: boolean = false;
    public finalLevel: string | null = null;
    
    constructor() {
    }
    
    /**
     * Reset session state
     */
    public resetSessionState(): void {
        this.session = null;
        this.currentQuestion = null;
        this.selectedAnswer = null;
        this.questionStartTime = 0;
        this.sessionStartTime = 0;
        this.isQuestionAnswered = false;
        this.showResults = false;
        this.isSessionActive = false;
    }
    
    /**
     * Start question timer
     */
    public startQuestionTimer(): void {
        this.questionStartTime = Date.now();
    }
    
    /**
     * Get time taken for current question
     */
    public getQuestionTime(): number {
        if (this.questionStartTime === 0) return 0;
        return Date.now() - this.questionStartTime;
    }
}

// ============================================================================
// GLOBAL STATE INSTANCE
// ============================================================================

const moduleState = new VocabularyModuleState();

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
 * Initialize the vocabulary module
 */
async function initializeVocabularyModule(): Promise<void> {
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
        submitBtn.addEventListener('click', handleSubmitAnswer);
    }
    
    // Continue button functionality is now handled by submitBtn
    
    // Authentication state is managed by updateUIForAuthStatus()
    
    // Initialize UI state
    hide('assessment-interface');
    hide('results');
    
    // Initialize starting level display
    updateStartingLevel();
}
