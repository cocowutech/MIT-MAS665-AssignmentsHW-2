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

// Import shared types (these will be available globally from shared utilities)
// Using global types from shared/types/common.ts

// Global declarations for shared utilities
import { authState, authenticateUser, logout, updateAuthHeader, updateUIForAuthStatus, initializeAuth } from '../shared/js/auth.js';
declare const APIUtils: any;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Extended listening clip interface with internal state
 */
interface ListeningClipExtended {
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

/**
 * Represents a user's answer to a listening question
 */
interface Answer {
    clip_id: string;
    choice_index: number;
}

/**
 * Represents the evaluation result for a submitted answer
 */
interface EvaluationResult {
    clip_id: string;
    chosen_index: number;
    correct_choice_index: number;
    correct: boolean;
    rationale: string;
}

/**
 * Represents the complete session result
 */
interface SessionResult {
    correct: number;
    incorrect: number;
    total: number;
    final_level: string;
    estimated_band?: string; // Legacy field - Might not be relevant anymore
    exam_mapping: {
        exam: string;
        target_vocab: string[];
        target_structures: string[];
    };
    per_item: Array<{
        clip_id: string;
        correct: boolean;
        correct_choice_index: number;
        rationale: string;
        level_cefr: string;
        cambridge_level: string;
    }>;
    finished: boolean;
    evaluated: EvaluationResult[];
    // Additional fields for intermediate responses
    asked?: number;
    remaining?: number;
    target_cefr?: string;
    cambridge_level?: string;
    clips?: ListeningClipExtended[];
}

/**
 * Session submit response interface
 */
interface SessionSubmitResponse extends SessionResult {
    session_id: string;
}

// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================

/**
 * Listening module specific state
 * Extends shared session state with listening-specific data
 */
class ListeningModuleState {
    // Session state
    sessionId: string | null = null;
    clips: ListeningClipExtended[] = [];
    nextClips: ListeningClipExtended[] | null = null;
    
    // Assessment progress
    remaining: number = 0;
    asked: number = 0;
    
    // Text-to-speech state
    synth: SpeechSynthesis | null = null;
    speakingClipId: string | null = null;
    currentUtterances: SpeechSynthesisUtterance[] = [];
    
    // Voice management
    englishVoices: SpeechSynthesisVoice[] = [];
    clipVoiceMap: Record<string, string> = {};
    
    // TTS Configuration constants
    readonly DEFAULT_RATE = 0.92;
    readonly DEFAULT_PITCH = 1.03;
    readonly DEFAULT_VOLUME = 1.0;
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
function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (!voices || !voices.length) return null;
    
    const scored = voices.map(voice => {
        const name = (voice.name || '').toLowerCase();
        const lang = (voice.lang || '').toLowerCase();
        let score = 0;
        
        // Prefer en-US, then en-GB
        if (lang.startsWith('en-us')) score += 8;
        if (lang.startsWith('en-gb')) score += 7;
        
        // Prefer neural/natural/online voices
        if (name.includes('natural') || name.includes('neural') || name.includes('online')) score += 6;
        
        // Vendor preferences
        if (name.includes('microsoft')) score += 5;
        if (name.includes('google')) score += 4;
        if (name.includes('siri')) score += 5;
        
        // Mild bias to female voices for clarity
        if (name.includes('female')) score += 1;
        
        return { voice, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0].voice;
}

/**
 * Populate English voices from available speech synthesis voices
 * Filters voices to only include English language variants
 */
function populateVoices(): void {
    if (!moduleState.synth) return;
    
    const voices = moduleState.synth.getVoices();
    moduleState.englishVoices = voices.filter(voice => 
        /^en[-_]/i.test(voice.lang || '')
    );
}

/**
 * Initialize text-to-speech system
 * Sets up speech synthesis and voice management
 */
function initTTS(): void {
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
    } catch (_) {
        // Ignore voice population errors
    }
    
    try {
        moduleState.synth.onvoiceschanged = populateVoices;
    } catch (_) {
        // Ignore voice change handler errors
    }
}

/**
 * Apply voice and speech options to a speech synthesis utterance
 * @param utterance - Speech synthesis utterance to configure
 * @param clipId - ID of the clip for voice assignment
 */
function applyUtterOptions(utterance: SpeechSynthesisUtterance, clipId: string): void {
    let voice: SpeechSynthesisVoice | null = null;
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
        } else {
            voice = pickBestVoice(allVoices) || allVoices[0] || null;
        }
    }
    
    // Apply voice settings
    if (voice) {
        utterance.voice = voice;
        if (voice.lang) utterance.lang = voice.lang;
    } else {
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
function splitIntoChunks(text: string): string[] {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    
    // Split by sentence enders, keep them attached
    const parts = cleaned.match(/[^.!?\n]+[.!?\u2026]+\s*|[^.!?\n]+$/g) || [cleaned];
    const chunks: string[] = [];
    let buffer = '';
    const MAX_LEN = 180;
    
    for (const part of parts) {
        if ((buffer + ' ' + part).trim().length > MAX_LEN && buffer) {
            chunks.push(buffer.trim());
            buffer = part;
        } else {
            buffer = (buffer ? buffer + ' ' : '') + part;
        }
    }
    
    if (buffer.trim()) chunks.push(buffer.trim());
    return chunks;
}

/**
 * Speak text segments sequentially with proper voice management
 * @param clipId - ID of the clip being spoken
 * @param segments - Array of text segments to speak
 * @param onEnd - Callback when all segments are complete
 * @param onError - Callback when an error occurs
 */
function speakSegments(
    clipId: string, 
    segments: string[], 
    onEnd?: () => void, 
    onError?: () => void
): void {
    let idx = 0;
    moduleState.currentUtterances = [];
    
    function speakNext(): void {
        if (!moduleState.synth) {
            if (onEnd) onEnd();
            return;
        }
        
        if (idx >= segments.length) {
            if (onEnd) onEnd();
            return;
        }
        
        const utterance = new SpeechSynthesisUtterance(segments[idx]);
        applyUtterOptions(utterance, clipId);
        
        utterance.onend = () => {
            idx += 1;
            speakNext();
        };
        
        utterance.onerror = () => {
            if (onError) onError();
        };
        
        moduleState.currentUtterances.push(utterance);
        moduleState.synth!.speak(utterance);
    }
    
    speakNext();
}

/**
 * Start speaking a listening clip
 * @param clipId - ID of the clip to speak
 */
function speakClip(clipId: string): void {
    if (!moduleState.synth) return;
    
    stopSpeaking();
    
    const clip = moduleState.clips.find(c => c.id === clipId);
    if (!clip) return;
    
    const segments = splitIntoChunks(clip.transcript);
    moduleState.speakingClipId = clipId;
    updatePlayButtons();
    
    speakSegments(clipId, segments,
        () => {
            moduleState.speakingClipId = null;
            updatePlayButtons();
        },
        () => {
            moduleState.speakingClipId = null;
            updatePlayButtons();
        }
    );
}

/**
 * Stop all current speech synthesis
 */
function stopSpeaking(): void {
    if (!moduleState.synth) return;
    
    moduleState.synth.cancel();
    moduleState.currentUtterances = [];
    moduleState.speakingClipId = null;
    updatePlayButtons();
}

/**
 * Update play button states based on current speaking status
 */
function updatePlayButtons(): void {
    for (const clip of moduleState.clips) {
        const button = document.getElementById('play-' + clip.id);
        if (!button) continue;
        
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
async function initializeApp(): Promise<void> {
    console.log('Listening module: Initializing app...');
    
    // Initialize authentication using shared utilities
    await initializeAuth();
    console.log('Listening module: Auth initialized');
    
    // Initialize text-to-speech
    initTTS();
    console.log('Listening module: TTS initialized');
    
    // Add event listeners
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const usernameInput = document.getElementById('username') as HTMLInputElement;
            const passwordInput = document.getElementById('password') as HTMLInputElement;
            const loginMsgElement = document.getElementById('loginMsg') as HTMLElement;

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
    
    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.addEventListener('click', startSession);
    
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitAnswers);
}

// Make loadNextClips available globally for HTML onclick handler
(window as any).loadNextClips = loadNextClips;

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);
