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

declare const AuthUtils: any;
declare const APIUtils: any;

// ============================================================================
// VOCABULARY MODULE STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management for the vocabulary module
 */
class VocabularyModuleState {
    // Authentication state
    public token: string | null = null;
    public username: string | null = null;

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
    
    // Performance tracking
    public correctAnswers: number = 0;
    public totalAnswered: number = 0;
    public totalQuestions: number = 0;
    public answeredQuestionIds: Set<string> = new Set();

    constructor() {
        if (typeof AuthUtils !== 'undefined' && typeof AuthUtils.getAuthState === 'function') {
            this.applyAuthState(AuthUtils.getAuthState());
        }

        if (typeof AuthUtils !== 'undefined' && typeof AuthUtils.onAuthChange === 'function') {
            AuthUtils.onAuthChange((state: { token: string | null; username: string | null; isAuthenticated: boolean }) => {
                this.applyAuthState(state);
            });
        }
    }

    /**
     * Sync local state with global auth status
     */
    private applyAuthState(state: { token: string | null; username: string | null; isAuthenticated: boolean }): void {
        this.token = state.token;
        this.username = state.username;

        if (!state.isAuthenticated) {
            this.resetSessionState();
        }
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
        this.resetPerformanceTracking();
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

    /**
     * Reset counters used for score computation
     */
    public resetPerformanceTracking(): void {
        this.correctAnswers = 0;
        this.totalAnswered = 0;
        this.totalQuestions = 0;
        this.answeredQuestionIds.clear();
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
 * Authenticate user with backend and store token
 * Backend: POST /auth/token (auth.py:login)
 * @param username - User login name
 * @param password - User password
 * @returns JWT access token
 * @throws Error if authentication fails
 */
async function login(username: string, password: string): Promise<string> {
    try {
        const result = await AuthUtils.authenticateUser(username, password);
        if (result.success) {
            // AuthUtils already handles token storage and UI updates
            return AuthUtils.authState.token;
        } else {
            throw new Error(result.error || 'Login failed');
        }
    } catch (error) {
        throw new Error('Login failed');
    }
}

// ============================================================================
// VOCABULARY SESSION FUNCTIONS
// ============================================================================

/**
 * Initialize a new vocabulary assessment session
 * Backend: POST /vocabulary/start (vocabulary.py:start)
 * @returns Session data with first vocabulary task
 * @throws Error if session initialization fails
 */
async function startSession(startLevel: string = 'A2'): Promise<VocabularySessionResponse> {
    try {
        const response = await APIUtils.VocabularyAPI.startSession(startLevel);
        
        // Backend returns data at top level, not nested under 'session'
        moduleState.resetPerformanceTracking();
        moduleState.session = {
            session_id: response.session_id,
            current_question: response.question,
            asked: response.progress_current,
            remaining: response.progress_total - response.progress_current,
            target_cefr: response.level,
            current_level: response.level
        };
        moduleState.currentQuestion = response.question;
        moduleState.sessionStartTime = Date.now();
        moduleState.isSessionActive = true;
        moduleState.totalQuestions = response.progress_total;
        
        return {
            session: moduleState.session,
            finished: false
        };
    } catch (error) {
        throw new Error('Failed to start session');
    }
}

/**
 * Submit vocabulary answer for evaluation
 * Backend: POST /vocabulary/answer (vocabulary.py:answer)
 * @param answer - Vocabulary answer data
 * @returns Evaluation result
 * @throws Error if submission fails
 */
async function submitAnswer(answer: VocabularyAnswer): Promise<VocabularyEvaluation> {
    try {
        const response = await APIUtils.VocabularyAPI.submitAnswer(answer);
        // Backend returns evaluation data at top level, not nested under 'evaluation'
        return {
            correct: response.correct,
            level: response.level,
            progress_current: response.progress_current,
            progress_total: response.progress_total,
            finished: response.finished,
            explanation: response.explanation
        };
    } catch (error) {
        throw new Error('Failed to submit answer');
    }
}

/**
 * Get next question in current session
 * Backend: POST /vocabulary/next (vocabulary.py:next)
 * @returns Next question or session completion status
 * @throws Error if request fails
 */
async function getNextQuestion(): Promise<VocabularySessionResponse> {
    try {
        const sessionId = moduleState.session?.session_id;
        if (!sessionId) {
            throw new Error('No active session');
        }
        
        const response = await APIUtils.VocabularyAPI.getNextQuestion(sessionId);
        // Backend returns data at top level, not nested under 'session'
        if (response.question && moduleState.session) {
            moduleState.currentQuestion = response.question;
            moduleState.session.current_question = response.question;
            // Don't update progress counters here - they're updated by backend on submit
        }
        
        // Check if session is finished
        const isFinished = moduleState.session ? moduleState.session.asked >= (moduleState.session.asked + moduleState.session.remaining) : false;
        
        return {
            session: moduleState.session,
            finished: isFinished,
            final_score: isFinished ? calculateFinalScore() : 0
        };
    } catch (error) {
        throw new Error('Failed to get next question');
    }
}

// ============================================================================
// UI RENDERING FUNCTIONS
// ============================================================================

/**
 * Display vocabulary question
 * @param question - Vocabulary question data
 */
function displayQuestion(question: VocabularyQuestion): void {
    const questionDiv = APIUtils.$element('question');
    if (!questionDiv) return;
    
    const choicesHtml = question.options.map((option, index) => `
        <div class="vocabulary-choice" data-index="${index}" onclick="selectAnswer(${index})">
            <span class="choice-key">${String.fromCharCode(65 + index)}</span>
            <span class="choice-text">${option}</span>
        </div>
    `).join('');
    
    questionDiv.innerHTML = `
        <div class="vocabulary-question">
            <div class="question-header">
                <span class="question-number">Question ${moduleState.session?.asked || 1}</span>
                <span class="question-difficulty">${question.cefr}</span>
            </div>
            <div class="passage-text">
                ${question.passage}
            </div>
            <div class="question-text">
                ${question.question}
            </div>
            <div class="vocabulary-choices">
                ${choicesHtml}
            </div>
        </div>
    `;
    
    // Reset submit button for new question
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Submit Answer';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    show('question');
    moduleState.startQuestionTimer();
}

/**
 * Calculate final score based on session performance
 * @returns Final score percentage
 */
function calculateFinalScore(): number {
    const answered = moduleState.totalAnswered;
    if (!answered) return 0;
    
    const correct = moduleState.correctAnswers;
    const rawScore = Math.round((correct / answered) * 100);
    
    if (!Number.isFinite(rawScore)) return 0;
    if (rawScore < 0) return 0;
    if (rawScore > 100) return 100;
    
    return rawScore;
}

/**
 * Update starting level display
 */
function updateStartingLevel(): void {
    const startingLevelElement = APIUtils.$element('startingLevel');
    if (startingLevelElement) {
        const currentLevel = moduleState.finalLevel || 'A2';
        startingLevelElement.textContent = currentLevel;
    }
}

/**
 * Update progress display
 */
function updateProgress(): void {
    if (!moduleState.session) return;
    
    const progressDiv = APIUtils.$element('progress');
    if (!progressDiv) return;
    
    const progress = calculateProgress(moduleState.session.asked, moduleState.session.asked + moduleState.session.remaining);
    
    progressDiv.innerHTML = `
        <div class="vocabulary-progress">
            <div class="progress-info">
                <span class="progress-text">Progress: ${moduleState.session.asked}/${moduleState.session.asked + moduleState.session.remaining}</span>
                <span class="vocabulary-level">
                    Level: <span class="level-badge">${moduleState.session.current_level}</span>
                </span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
        </div>
    `;
    
    show('progress');
}

/**
 * Display evaluation results
 * @param evaluation - Evaluation result data
 */
function displayEvaluationResults(evaluation: VocabularyEvaluation): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    const isCorrect = evaluation.correct;
    const scoreColor = isCorrect ? '#22c55e' : '#ef4444';
    
    resultsDiv.innerHTML = `
        <div class="vocabulary-results">
            <div class="results-header">
                <h3 class="results-title">Question Result</h3>
                <div class="results-score" style="color: ${scoreColor}">
                    ${isCorrect ? 'Correct' : 'Incorrect'}
                </div>
            </div>
            <div class="results-breakdown">
                <div class="result-item">
                    <div class="result-label">Progress</div>
                    <div class="result-value">${evaluation.progress_current}/${evaluation.progress_total}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Time</div>
                    <div class="result-value">${formatTime(moduleState.getQuestionTime())}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Level</div>
                    <div class="result-value">${evaluation.level || 'N/A'}</div>
                </div>
            </div>
            <div class="results-feedback">
                <div class="feedback-title">Result</div>
                <div class="feedback-text">${isCorrect ? 'Well done! You got it right.' : 'Not quite right. Keep practicing!'}</div>
                ${evaluation.explanation ? `
                    <div class="feedback-title" style="margin-top: 12px;">Explanation</div>
                    <div class="feedback-text">${evaluation.explanation}</div>
                ` : ''}
            </div>
        </div>
    `;
    
    show('results');
    moduleState.showResults = true;
}

/**
 * Show session completion screen
 * @param finalScore - Final session score
 */
function showSessionComplete(finalScore: number): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    const sessionTime = Date.now() - moduleState.sessionStartTime;
    
    // Store final level for assess again functionality
    const finalLevel = moduleState.session?.current_level || 'A2';
    moduleState.finalLevel = finalLevel;
    
    // Update starting level display for next assessment
    updateStartingLevel();
    
    resultsDiv.innerHTML = `
        <div class="session-summary">
            <div class="summary-title">Vocabulary Assessment Complete!</div>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Score</div>
                    <div class="summary-stat-value">${finalScore}/100</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Questions</div>
                    <div class="summary-stat-value">${moduleState.session?.asked || 0}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Time Taken</div>
                    <div class="summary-stat-value">${formatTime(sessionTime)}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Level</div>
                    <div class="summary-stat-value">${moduleState.session?.current_level || 'N/A'}</div>
                </div>
            </div>
            <div class="results-feedback">
                <div class="feedback-title">Congratulations!</div>
                <div class="feedback-text">
                    You have completed the vocabulary assessment. Your performance has been evaluated
                    and your English vocabulary level has been determined. Thank you for using the
                    ESL Assessment System.
                </div>
            </div>
        </div>
    `;
    
    // Update submit button to assess again
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Assess again';
        (submitBtn as HTMLButtonElement).disabled = false;
    }
    
    show('results');
    moduleState.showResults = true;
    moduleState.isSessionActive = false;
}

/**
 * Handle assess again functionality
 */
async function handleAssessAgain(): Promise<void> {
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Starting...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        // Reset module state
        moduleState.session = null;
        moduleState.currentQuestion = null;
        moduleState.selectedAnswer = null;
        moduleState.isQuestionAnswered = false;
        moduleState.showResults = false;
        moduleState.isSessionActive = false;
        moduleState.resetPerformanceTracking();
        
        // Hide results and assessment interface
        hide('results');
        hide('assessment-interface');
        
        // Start new session with final level
        const startLevel = moduleState.finalLevel || 'A2';
        await startSession(startLevel);
        
        // Show assessment interface
        show('assessment-interface');
        
        // Display first question
        if (moduleState.currentQuestion) {
            displayQuestion(moduleState.currentQuestion);
        }
        
        // Update progress
        updateProgress();
        
    } catch (error) {
        console.error('Failed to start new assessment:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to start new assessment. Please try again.';
        
        if (submitBtn) {
            submitBtn.textContent = 'Assess again';
            (submitBtn as HTMLButtonElement).disabled = false;
        }
    }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle answer selection
 * @param index - Selected answer index
 */
function selectAnswer(index: number): void {
    if (moduleState.isQuestionAnswered) return;
    
    moduleState.selectedAnswer = index;
    
    // Update UI to show selection
    const choices = document.querySelectorAll('.vocabulary-choice');
    choices.forEach((choice, i) => {
        choice.classList.remove('selected');
        if (i === index) {
            choice.classList.add('selected');
        }
    });
    
    // Enable submit button
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        (submitBtn as HTMLButtonElement).disabled = false;
    }
}

/**
 * Handle answer submission
 */
async function handleSubmitAnswer(): Promise<void> {
    const submitBtn = APIUtils.$element('submitBtn');
    
    // Check if this is a continue action
    if (submitBtn && submitBtn.textContent === 'Continue to Next Question') {
        await continueToNext();
        return;
    }
    
    // Check if this is an assess again action
    if (submitBtn && submitBtn.textContent === 'Assess again') {
        await handleAssessAgain();
        return;
    }
    
    if (!moduleState.currentQuestion || moduleState.selectedAnswer === null) {
        return;
    }
    
    if (submitBtn) {
        submitBtn.textContent = 'Submitting...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        const answer: VocabularyAnswer = {
            session_id: moduleState.session?.session_id || '',
            question_id: moduleState.currentQuestion.id,
            choice_index: moduleState.selectedAnswer
        };
        
        const evaluation = await submitAnswer(answer);
        moduleState.isQuestionAnswered = true;
        
        // Update session progress and level from backend response
        if (moduleState.session) {
            moduleState.session.asked = evaluation.progress_current;
            moduleState.session.remaining = evaluation.progress_total - evaluation.progress_current;
            moduleState.session.current_level = evaluation.level; // Update level based on performance
            moduleState.totalQuestions = evaluation.progress_total;
        }

        const currentQuestionId = moduleState.currentQuestion?.id;
        if (currentQuestionId && !moduleState.answeredQuestionIds.has(currentQuestionId)) {
            moduleState.answeredQuestionIds.add(currentQuestionId);
            moduleState.totalAnswered += 1;
            if (evaluation.correct) {
                moduleState.correctAnswers += 1;
            }
        }
        
        // Display results
        displayEvaluationResults(evaluation);
        
        // Update progress display to show new level
        updateProgress();
        
        // Check if session is finished based on evaluation or progress
        const isFinished = evaluation.finished || (evaluation.progress_current >= evaluation.progress_total);
        
        if (isFinished) {
            showSessionComplete(calculateFinalScore());
        } else {
            // Get next question
            const nextResponse = await getNextQuestion();
            
            if (nextResponse.finished) {
                showSessionComplete(nextResponse.final_score || 0);
            } else {
                // Update submit button to continue button
                const submitBtn = APIUtils.$element('submitBtn');
                if (submitBtn) {
                    submitBtn.textContent = 'Continue to Next Question';
                    (submitBtn as HTMLButtonElement).disabled = false;
                }
            }
        }
        
    } catch (error) {
        console.error('Submission failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Submission failed. Please try again.';
        
        if (submitBtn) {
            submitBtn.textContent = 'Submit Answer';
            (submitBtn as HTMLButtonElement).disabled = false;
        }
    }
}

/**
 * Handle continue to next question
 */
async function continueToNext(): Promise<void> {
    if (!moduleState.session) return;
    
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Loading...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        const nextResponse = await getNextQuestion();
        
        if (nextResponse.finished) {
            showSessionComplete(nextResponse.final_score || 0);
        } else {
            // Reset state for next question
            moduleState.selectedAnswer = null;
            moduleState.isQuestionAnswered = false;
            moduleState.showResults = false;
            
            // Hide results
            hide('results');
            
            // Display next question
            if (nextResponse.session.current_question) {
                displayQuestion(nextResponse.session.current_question);
            }
            
            // Update progress
            updateProgress();
            
            // Reset submit button for new question
            const submitBtn = APIUtils.$element('submitBtn');
            if (submitBtn) {
                submitBtn.textContent = 'Submit Answer';
                (submitBtn as HTMLButtonElement).disabled = true;
            }
        }
        
    } catch (error) {
        console.error('Failed to get next question:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to load next question. Please try again.';
        
        if (submitBtn) {
            submitBtn.textContent = 'Continue to Next Question';
            (submitBtn as HTMLButtonElement).disabled = false;
        }
    }
}

/**
 * Handle login form submission
 */
async function handleLogin(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const usernameInput = APIUtils.$element('username') as HTMLInputElement | null;
    const passwordInput = APIUtils.$element('password') as HTMLInputElement | null;
    const loginMsg = APIUtils.$element('loginMsg');
    const status = APIUtils.$element('status');
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;

    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        if (status) status.textContent = 'Please enter both username and password.';
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (loginMsg) loginMsg.textContent = '…';

    try {
        await login(username, password);
        if (status) status.textContent = 'Login successful!';
    } catch (error) {
        if (status) status.textContent = 'Login failed. Please try again.';
        if (loginMsg) loginMsg.textContent = 'Login failed';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

/**
 * Handle start session button click
 */
async function handleStartSession(): Promise<void> {
    const startBtn = APIUtils.$element('startBtn');
    if (startBtn) {
        startBtn.textContent = 'Starting...';
        (startBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        // Use final level from previous assessment if available, otherwise default to A2
        const startLevel = moduleState.finalLevel || 'A2';
        const response = await startSession(startLevel);
        
        // Hide start button and show assessment interface
        hide('startBtn');
        show('assessment-interface');
        
        // Display first question
        if (response.session.current_question) {
            displayQuestion(response.session.current_question);
        }
        
        // Update progress
        updateProgress();
        
    } catch (error) {
        console.error('Start session failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to start session. Please try again.';
        
        if (startBtn) {
            startBtn.textContent = 'Start Vocabulary Assessment';
            (startBtn as HTMLButtonElement).disabled = false;
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the vocabulary module
 */
async function initializeVocabularyModule(): Promise<void> {
    // Initialize authentication first
    await AuthUtils.initializeAuth();
    
    // Set up event listeners
    const loginForm = APIUtils.$element('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
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
    
    // Authentication state is managed by AuthUtils.updateUIForAuthStatus()
    
    // Initialize UI state
    hide('assessment-interface');
    hide('results');
    
    // Initialize starting level display
    updateStartingLevel();
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

// Export functions for global access
(window as any).VocabularyModule = {
    initializeVocabularyModule,
    handleLogin,
    handleStartSession,
    selectAnswer,
    handleSubmitAnswer,
    continueToNext,
    handleAssessAgain,
    displayQuestion,
    displayEvaluationResults,
    showSessionComplete,
    updateStartingLevel,
    moduleState
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeVocabularyModule);
} else {
    initializeVocabularyModule();
}
