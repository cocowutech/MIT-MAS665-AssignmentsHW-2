/**
 * Common TypeScript Interfaces for ESL Assessment System
 * 
 * This file contains shared TypeScript interfaces and types used across all modules.
 * It provides type safety and consistency for data structures and API responses.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// AUTHENTICATION TYPES
// ============================================================================

/**
 * User authentication response
 */
export interface AuthResponse {
    access_token: string;
    token_type: string;
}

/**
 * User information
 */
export interface User {
    username: string;
    id?: string;
}

// ============================================================================
// COMMON ASSESSMENT TYPES
// ============================================================================

/**
 * Represents a user's answer to a question
 */
export interface Answer {
    question_id?: string;
    clip_id?: string;
    choice_index: number;
    answer_index?: number; // Alternative field name
}

/**
 * Represents the evaluation result for a submitted answer
 */
export interface EvaluationResult {
    question_id?: string;
    clip_id?: string;
    chosen_index: number;
    correct_choice_index: number;
    correct: boolean;
    rationale: string;
    score?: number;
}

/**
 * Session start request
 */
export interface SessionStartRequest {
    start_level?: string;
    level?: string;
}

/**
 * Session start response
 */
export interface SessionStartResponse {
    session_id: string;
    target_cefr: string;
    cambridge_level: string;
    asked: number;
    remaining: number;
    finished: boolean;
    clips?: any[];
    questions?: any[];
    question?: any;
}

/**
 * Session submit request
 */
export interface SessionSubmitRequest {
    session_id: string;
    answers: Answer[];
    question_id?: string;
    answer_index?: number;
    text?: string;
    transcript?: string;
}

/**
 * Session submit response
 */
export interface SessionSubmitResponse {
    session_id: string;
    target_cefr: string;
    cambridge_level: string;
    asked: number;
    remaining: number;
    finished: boolean;
    evaluated: EvaluationResult[];
    clips?: any[];
    question?: any;
    next_question?: any;
    correct?: number;
    incorrect?: number;
    total?: number;
    final_level?: string;
    estimated_band?: string; // Legacy field - Might not be relevant anymore
    exam_mapping?: {
        exam: string;
        target_vocab: string[];
        target_structures: string[];
    };
    per_item?: Array<{
        question_id?: string;
        clip_id?: string;
        correct: boolean;
        correct_choice_index: number;
        rationale: string;
        level_cefr: string;
        cambridge_level: string;
    }>;
}

// ============================================================================
// LISTENING MODULE TYPES
// ============================================================================

/**
 * Represents a listening clip with associated question and choices
 */
export interface ListeningClip {
    id: string;
    title: string;
    transcript: string;
    question: string;
    choices: string[];
    level_cefr: string;
    cambridge_level: string;
    exam_task_type: string;
    targets: {
        target_vocab: string[];
        target_structures: string[];
    };
    // Internal state for tracking user selection
    _selected?: number;
}

// ============================================================================
// SPEAKING MODULE TYPES
// ============================================================================

/**
 * Speaking task data
 */
export interface SpeakingTask {
    id: string;
    prompt: string;
    preparation_time: number;
    recording_time: number;
    level_cefr: string;
    cambridge_level: string;
    targets: {
        target_vocab: string[];
        target_structures: string[];
    };
}

/**
 * Speaking evaluation result
 */
export interface SpeakingEvaluation {
    task_id: string;
    transcript: string;
    pronunciation_score: number;
    fluency_score: number;
    grammar_score: number;
    vocabulary_score: number;
    overall_score: number;
    feedback: string;
    level_cefr: string;
    cambridge_level: string;
}

// ============================================================================
// READING MODULE TYPES
// ============================================================================

/**
 * Reading passage and question data
 */
export interface ReadingQuestion {
    id: string;
    passage: string;
    question: string;
    choices: string[];
    correct_index: number;
    rationale: string;
    level_cefr: string;
    cambridge_level: string;
    exam_task_type: string;
    targets: {
        target_vocab: string[];
        target_structures: string[];
    };
    // Internal state for tracking user selection
    _selected?: number;
}

// ============================================================================
// VOCABULARY MODULE TYPES
// ============================================================================

/**
 * Vocabulary question data
 */
export interface VocabularyQuestion {
    id: string;
    word: string;
    context: string;
    choices: string[];
    correct_index: number;
    rationale: string;
    level_cefr: string;
    cambridge_level: string;
    targets: {
        target_vocab: string[];
        target_structures: string[];
    };
    // Internal state for tracking user selection
    _selected?: number;
}

// ============================================================================
// WRITING MODULE TYPES
// ============================================================================

/**
 * Writing prompt data
 */
export interface WritingPrompt {
    id: string;
    prompt: string;
    word_limit: number;
    level_cefr: string;
    cambridge_level: string;
    targets: {
        target_vocab: string[];
        target_structures: string[];
    };
}

/**
 * Writing evaluation result
 */
export interface WritingEvaluation {
    prompt_id: string;
    text: string;
    word_count: number;
    grammar_score: number;
    vocabulary_score: number;
    coherence_score: number;
    task_achievement_score: number;
    overall_score: number;
    feedback: string;
    level_cefr: string;
    cambridge_level: string;
    suggestions: string[];
}

// ============================================================================
// COMMON UI TYPES
// ============================================================================

/**
 * Status message types
 */
export type StatusType = 'success' | 'error' | 'info' | 'warning';

/**
 * Button variants
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success';

/**
 * Choice card states
 */
export type ChoiceState = 'default' | 'selected' | 'correct' | 'incorrect' | 'locked';

// ============================================================================
// API ERROR TYPES
// ============================================================================

/**
 * API error response
 */
export interface APIError {
    detail: string;
    status_code: number;
    type?: string;
}

/**
 * Generic API response wrapper
 */
export interface APIResponse<T = any> {
    data?: T;
    error?: APIError;
    success: boolean;
    message?: string;
}

// ============================================================================
// SESSION MANAGEMENT TYPES
// ============================================================================

/**
 * Session state interface
 */
export interface SessionState {
    sessionId: string | null;
    isActive: boolean;
    currentLevel: string;
    progress: {
        asked: number;
        remaining: number;
        total: number;
    };
    results: EvaluationResult[];
}

/**
 * Module-specific session state
 */
export interface ModuleSessionState extends SessionState {
    currentItem: any; // Current question, clip, task, etc.
    nextItem: any;    // Pre-fetched next item
}
