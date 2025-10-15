/**
 * Reading Module TypeScript Implementation
 * 
 * This file contains the TypeScript implementation for the reading assessment module.
 * It provides a complete reading evaluation system with adaptive difficulty,
 * multiple choice questions, and real-time feedback integration with the backend API.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Reading passage interface
 */
interface ReadingPassage {
    text: string;
    index: number;
}

/**
 * Reading question interface
 */
interface ReadingQuestion {
    id: string;
    number: number;
    text: string;
    choices: string[];
    level_cefr: string;
    cambridge_level: string;
    correct_choice_index: number;
    rationale: string;
}

/**
 * Reading session interface
 */
interface ReadingSession {
    session_id: string;
    target_cefr: string;
    cambridge_level: string;
    passage_index: number;
    max_passages: number;
    questions_per_passage: number;
    total_questions: number;
}

/**
 * Reading answer interface
 */
interface ReadingAnswer {
    session_id: string;
    question_id: string;
    choice_index: number;
}

/**
 * Reading evaluation result interface
 */
interface ReadingEvaluation {
    correct: boolean;
    correct_choice_index: number;
    rationale: string;
    updated_target_cefr: string;
    cambridge_level: string;
    streak_correct: number;
    streak_incorrect: number;
    asked: number;
    remaining: number;
    finished: boolean;
    summary?: {
        total: number;
        correct: number;
        incorrect: number;
        start_cefr: string;
        end_cefr: string;
    };
    passage_index: number;
    max_passages: number;
    questions_per_passage: number;
    new_passage?: string;
    next_question?: ReadingQuestion;
}

/**
 * Reading session response interface
 */
interface ReadingSessionResponse {
    session_id: string;
    passage: string;
    target_cefr: string;
    cambridge_level: string;
    passage_index: number;
    max_passages: number;
    questions_per_passage: number;
    question: ReadingQuestion;
    total_questions: number;
}

// ============================================================================
// GLOBAL DECLARATIONS
// ============================================================================

import { authState, authenticateUser, logout, updateAuthHeader, updateUIForAuthStatus, initializeAuth } from '../shared/js/auth.js';
declare const APIUtils: any;

// ============================================================================
// READING MODULE STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management for the reading module
 */
class ReadingModuleState {
    // Session state
    public session: ReadingSession | null = null;
    public currentPassage: ReadingPassage | null = null;
    public currentQuestion: ReadingQuestion | null = null;
    public selectedAnswer: number | null = null;
    public questionStartTime: number = 0;
    public sessionStartTime: number = 0;
    
    // UI state
    public isQuestionAnswered: boolean = false;
    public showResults: boolean = false;
    public isSessionActive: boolean = false;
    public lastEvaluation: any = null;
    public finalLevel: string | null = null;
    
    constructor() {
    }
    
    /**
     * Reset session state
     */
    public resetSessionState(): void {
        this.session = null;
        this.currentPassage = null;
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

const moduleState = new ReadingModuleState();

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


// ============================================================================
// READING SESSION FUNCTIONS
// ============================================================================



/**
 * Submit reading answer for evaluation
 * Backend: POST /read/answer (read.py:answer)
 * @param answer - Reading answer data
 * @returns Evaluation result
 * @throws Error if submission fails
 */
async function submitAnswer(answer: ReadingAnswer): Promise<ReadingEvaluation> {
    try {
        const response = await APIUtils.ReadingAPI.submitAnswer(answer);
        // Backend returns evaluation data at top level, not nested under 'evaluation'
        return response;
    } catch (error) {
        throw new Error('Failed to submit answer');
    }
}

/**
 * Get next question in current session
 * Backend: POST /read/next (read.py:next)
 * @returns Next question or session completion status
 * @throws Error if request fails
 */
async function getNextQuestion(): Promise<ReadingSessionResponse> {
    try {
        const response = await APIUtils.ReadingAPI.getNextQuestion();
        // This function is deprecated - next question comes from submit response
        throw new Error('getNextQuestion is deprecated - use submit response instead');
    } catch (error) {
        throw new Error('Failed to get next question');
    }
}

// ============================================================================
// UI RENDERING FUNCTIONS
// ============================================================================

/**
 * Display reading passage
 * @param passage - Reading passage data
 */
function displayPassage(passage: ReadingPassage): void {
    const passageDiv = APIUtils.$element('passage');
    if (!passageDiv) return;
    
    passageDiv.innerHTML = `
        <div class="reading-passage">
            <div class="passage-title">Reading Passage ${passage.index}</div>
            <div class="passage-text">${passage.text}</div>
            <div class="passage-meta">
                Level: ${moduleState.session?.target_cefr || 'A2'} | Cambridge: ${moduleState.session?.cambridge_level || 'KET'}
            </div>
        </div>
    `;
    
    show('passage');
}

/**
 * Display reading question
 * @param question - Reading question data
 */
function displayQuestion(question: ReadingQuestion): void {
    const questionDiv = APIUtils.$element('question');
    if (!questionDiv) return;
    
    const choicesHtml = question.choices.map((choice, index) => `
        <div class="reading-choice" data-index="${index}" onclick="selectAnswer(${index})">
            <span class="choice-key">${String.fromCharCode(65 + index)}</span>
            <span class="choice-text">${choice}</span>
        </div>
    `).join('');
    
    questionDiv.innerHTML = `
        <div class="reading-question">
            <div class="question-header">
                <span class="question-number">Question ${question.number}</span>
                <span class="question-difficulty">${question.level_cefr}</span>
            </div>
            <div class="question-text">${question.text}</div>
            <div class="reading-choices">
                ${choicesHtml}
            </div>
        </div>
    `;
    
    show('question');
    moduleState.startQuestionTimer();
    
    // Reset submit button for new question
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Submit Answer';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
}

/**
 * Update progress display
 */
function updateProgress(): void {
    if (!moduleState.session) return;
    
    const progressDiv = APIUtils.$element('progress');
    if (!progressDiv) return;
    
    const totalQuestions = moduleState.session?.total_questions || 15;
    const currentQuestion = moduleState.currentQuestion?.number || 1;
    const progress = calculateProgress(currentQuestion, totalQuestions);
    
    progressDiv.innerHTML = `
        <div class="reading-progress">
            <div class="progress-info">
                <span class="progress-text">Progress: ${currentQuestion}/${totalQuestions}</span>
                <span class="reading-level">
                    Level: <span class="level-badge">${moduleState.session?.target_cefr || 'A2'}</span>
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
function displayEvaluationResults(evaluation: ReadingEvaluation): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    const isCorrect = evaluation.correct;
    const scoreColor = isCorrect ? '#22c55e' : '#ef4444';
    
    resultsDiv.innerHTML = `
        <div class="reading-results">
            <div class="results-header">
                <h3 class="results-title">Question Result</h3>
                <div class="results-score" style="color: ${scoreColor}">
                    ${isCorrect ? 'Correct' : 'Incorrect'}
                </div>
            </div>
            <div class="results-breakdown">
                <div class="result-item">
                    <div class="result-label">Progress</div>
                    <div class="result-value">${evaluation.asked}/${evaluation.asked + evaluation.remaining}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Time</div>
                    <div class="result-value">${formatTime(moduleState.getQuestionTime())}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Level</div>
                    <div class="result-value">${evaluation.updated_target_cefr}</div>
                </div>
            </div>
            <div class="results-feedback">
                <div class="feedback-title">Explanation</div>
                <div class="feedback-text">${evaluation.rationale}</div>
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
    const finalLevel = moduleState.lastEvaluation?.updated_target_cefr || moduleState.session?.target_cefr || 'A2';
    
    // Store final level for assess again functionality
    moduleState.finalLevel = finalLevel;
    
    resultsDiv.innerHTML = `
        <div class="session-summary">
            <div class="summary-title">Reading Assessment Complete!</div>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Score</div>
                    <div class="summary-stat-value">${finalScore}/100</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Questions</div>
                    <div class="summary-stat-value">${moduleState.session?.total_questions || 0}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Time Taken</div>
                    <div class="summary-stat-value">${formatTime(sessionTime)}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Level</div>
                    <div class="summary-stat-value">${finalLevel}</div>
                </div>
            </div>
            <div class="results-feedback">
                <div class="feedback-title">Congratulations!</div>
                <div class="feedback-text">
                    You have completed the reading assessment. Your performance has been evaluated
                    and your English reading level has been determined. Thank you for using the
                    ESL Assessment System.
                </div>
            </div>
        </div>
    `;
    
    // Update submit button to "Assess again"
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Assess again';
        (submitBtn as HTMLButtonElement).disabled = false;
    }
    
    show('results');
    moduleState.showResults = true;
    moduleState.isSessionActive = false;
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
    const choices = document.querySelectorAll('.reading-choice');
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
        const answer: ReadingAnswer = {
            session_id: moduleState.session?.session_id || '',
            question_id: moduleState.currentQuestion.id,
            choice_index: moduleState.selectedAnswer
        };
        
        const evaluation = await submitAnswer(answer);
        moduleState.isQuestionAnswered = true;
        moduleState.lastEvaluation = evaluation; // Store for continueToNext
        
        // Trigger preloading after question 3
        if (moduleState.currentQuestion?.number === 3) {
            try {
                await APIUtils.ReadingAPI.preloadNextPassage(answer);
                console.log('Next passage preloaded successfully');
            } catch (error) {
                console.log('Preloading failed (non-critical):', error);
            }
        }
        
        // Display results
        displayEvaluationResults(evaluation);
        
        // Check if session is finished or get next question from submit response
        if (evaluation.finished) {
            showSessionComplete(evaluation.summary?.correct || 0);
        } else if (evaluation.next_question) {
            // Update submit button to continue button
            if (submitBtn) {
                submitBtn.textContent = 'Continue to Next Question';
                (submitBtn as HTMLButtonElement).disabled = false;
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
        // Get next question from the stored response
        const evaluation = moduleState.lastEvaluation;
        if (!evaluation || !evaluation.next_question) {
            throw new Error('No next question available');
        }
        
        if (evaluation.finished) {
            showSessionComplete(evaluation.summary?.correct || 0);
        } else {
            // Reset state for next question
            moduleState.selectedAnswer = null;
            moduleState.isQuestionAnswered = false;
            moduleState.showResults = false;
            
            // Hide results
            hide('results');
            
            // Display next question
            if (evaluation.next_question) {
                moduleState.currentQuestion = evaluation.next_question;
                displayQuestion(evaluation.next_question);
            }
            
            // Update progress
            updateProgress();
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
        moduleState.currentPassage = null;
        moduleState.currentQuestion = null;
        moduleState.selectedAnswer = null;
        moduleState.isQuestionAnswered = false;
        moduleState.showResults = false;
        moduleState.isSessionActive = false;
        moduleState.lastEvaluation = null;
        
        // Hide results and assessment interface
        hide('results');
        hide('assessment-interface');
        
        // Start new session with final level
        const startLevel = moduleState.finalLevel || 'A2';
        const response = await APIUtils.ReadingAPI.startSession(startLevel);
        
        // Backend returns data at top level, not nested under 'session'
        moduleState.session = {
            session_id: response.session_id,
            target_cefr: response.target_cefr,
            cambridge_level: response.cambridge_level,
            passage_index: response.passage_index,
            max_passages: response.max_passages,
            questions_per_passage: response.questions_per_passage,
            total_questions: response.total_questions
        };
        moduleState.currentPassage = {
            text: response.passage,
            index: response.passage_index
        };
        moduleState.currentQuestion = response.question;
        moduleState.sessionStartTime = Date.now();
        moduleState.isSessionActive = true;
        
        // Show assessment interface
        show('assessment-interface');
        
        // Display first passage and question
        if (moduleState.currentPassage) {
            displayPassage(moduleState.currentPassage);
        }
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

/**
 * Initialize the reading module
 */
async function initializeReadingModule(): Promise<void> {
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
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

// Export functions for global access
(window as any).ReadingModule = {
    initializeReadingModule,
    handleLogin,
    handleStartSession,
    selectAnswer,
    handleSubmitAnswer,
    continueToNext,
    handleAssessAgain,
    displayPassage,
    displayQuestion,
    displayEvaluationResults,
    showSessionComplete,
    moduleState
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeReadingModule);
} else {
    initializeReadingModule();
}
