/**
 * Adaptive Placement Agent - Main Application Logic (TypeScript)
 * 
 * This file contains all the TypeScript functionality for the placement agent application.
 * It handles authentication, UI state management, and communication with the backend API.
 * 
 * Key Features:
 * - Token-based authentication with localStorage persistence
 * - Dynamic UI updates based on authentication state
 * - ElevenLabs ConvAI widget integration with Gemini fallback
 * - Health check monitoring
 * - Login/logout functionality
 * - Full TypeScript type safety
 */

// Note: Using shared types would require module system, so defining locally for browser compatibility


interface HealthResponse {
    ok: boolean;
    [key: string]: any;
}

interface GeminiResponse {
    text: string;
    [key: string]: any;
}

interface GeminiRequest {
    prompt: string;
}

// Global function type declaration
declare function toggleFallback(): void;

// DOM element selector helper with proper typing
const $ = (id: string): HTMLElement | null => document.getElementById(id);

import { authState, authenticateUser, logout, updateUIForAuthStatus, initializeAuth } from '../shared/js/auth.js';

/**
 * Checks the health status of the backend API
 * Updates the status indicator in the header
 */
async function checkHealth(): Promise<void> {
    try {
        const response: Response = await fetch('/health');
        
        if (!response.ok) throw new Error('health failed');
        
        const healthData: HealthResponse = await response.json();
        const statusElement = $('status') as HTMLElement;
        statusElement.textContent = healthData.ok ? 'API: OK' : 'API: error';
    } catch (e) {
        const statusElement = $('status') as HTMLElement;
        statusElement.textContent = 'API: unreachable';
    }
}

/**
 * Handles user login process
 * Sends credentials to backend and stores token if successful
 */
async function handleLogin(): Promise<void> {
    const loginBtnElement = $('loginBtn') as HTMLButtonElement;
    const loginMsgElement = $('loginMsg') as HTMLElement;
    const usernameElement = $('username') as HTMLInputElement;
    const passwordElement = $('password') as HTMLInputElement;
    const loginCardElement = $('login-card') as HTMLElement;
    
    // Add loading state
    loginBtnElement.disabled = true;
    loginCardElement.classList.add('loading');
    loginMsgElement.className = 'message';
    loginMsgElement.textContent = 'Logging in...';
    
    try {
        const authResult = await authenticateUser(usernameElement.value, passwordElement.value);
        
        if (!authResult.success) {
            throw new Error(authResult.error || 'Login failed');
        }
        
        // Show success message
        loginMsgElement.className = 'message success';
        loginMsgElement.textContent = `Successfully logged in as ${authState.username}!`;
        
        // Update UI immediately
        updateUIForAuthStatus();
        
    } catch (e) {
        loginMsgElement.className = 'message error';
        loginMsgElement.textContent = `Login failed: ${(e as Error).message}`;
    } finally {
        loginBtnElement.disabled = false;
        loginCardElement.classList.remove('loading');
    }
}

/**
 * Handles user logout process
 * Clears stored credentials and updates UI
 */
function handleLogout(): void {
    const loginMsgElement = $('loginMsg') as HTMLElement;
    
    // Show logout message
    loginMsgElement.className = 'message';
    loginMsgElement.textContent = 'Logging out...';
    
    // Clear credentials and update UI
    logout();
    
    // Show logout success message
    setTimeout(() => {
        loginMsgElement.className = 'message success';
        loginMsgElement.textContent = 'Successfully logged out';
        
        // Clear message after 2 seconds
        setTimeout(() => {
            loginMsgElement.textContent = '';
            loginMsgElement.className = '';
        }, 2000);
    }, 500);
}

/**
 * Toggles between ElevenLabs ConvAI widget and Gemini chat fallback
 * This function is called when the fallback button is clicked
 * Made globally accessible for HTML onclick handler
 */
(window as any).toggleFallback = function toggleFallback(): void {
    const elevenlabsWidget: HTMLElement | null = document.getElementById('elevenlabs-widget');
    const geminiChat: HTMLElement | null = document.getElementById('gemini-chat');
    const fallbackBtn: HTMLElement | null = document.getElementById('fallbackBtn');
    
    if (!elevenlabsWidget || !geminiChat || !fallbackBtn) return;
    
    if (elevenlabsWidget.style.display === 'none') {
        // Show ElevenLabs widget, hide Gemini chat
        elevenlabsWidget.style.display = 'block';
        geminiChat.style.display = 'none';
        fallbackBtn.textContent = 'Use Gemini Chat Instead';
    } else {
        // Show Gemini chat, hide ElevenLabs widget
        elevenlabsWidget.style.display = 'none';
        geminiChat.style.display = 'block';
        fallbackBtn.textContent = 'Use ElevenLabs Chat Instead';
    }
};

/**
 * Checks if the ElevenLabs ConvAI widget loaded successfully
 * Shows fallback button if widget fails to load after timeout
 */
function checkElevenLabsWidget(): void {
    setTimeout(() => {
        const convaiElement: Element | null = document.querySelector('elevenlabs-convai');
        
        if (!convaiElement || !(convaiElement as any).shadowRoot) {
            // Widget failed to load, show fallback button
            const fallbackBtn: HTMLElement | null = document.getElementById('fallbackBtn');
            if (fallbackBtn) {
                fallbackBtn.style.display = 'inline-block';
            }
        }
    }, 3000); // Wait 3 seconds for widget to load
}

/**
 * Handles Gemini chat generation request
 * Sends prompt to backend and displays response
 */
async function handleGeminiGeneration(): Promise<void> {
    const genBtnElement = $('genBtn') as HTMLButtonElement;
    const outElement = $('out') as HTMLElement;
    const promptElement = $('prompt') as HTMLTextAreaElement;
    
    genBtnElement.disabled = true; 
    outElement.textContent = '…';
    
    try {
        const requestBody: GeminiRequest = { prompt: promptElement.value };
        
        const response: Response = await fetch('/gemini/generate', { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${authState.token}` 
            }, 
            body: JSON.stringify(requestBody) 
        });
        
        if (response.status === 401) { 
            logout(); 
            throw new Error('Unauthorized'); 
        }
        
        if (!response.ok) throw new Error('request failed');
        
        const responseData: GeminiResponse = await response.json();
        outElement.textContent = responseData && typeof responseData.text === 'string' ? responseData.text : '';
    } catch (e) {
        outElement.textContent = String(e);
    } finally {
        genBtnElement.disabled = false;
    }
}

/**
 * Initialize the application when DOM is loaded
 * Sets up event listeners and performs initial checks
 */
function initializeApp(): void {
    // Set up event listeners with proper type checking
    const loginBtnElement = $('loginBtn') as HTMLButtonElement;
    const logoutBtnElement = $('logoutBtn') as HTMLButtonElement;
    const genBtnElement = $('genBtn') as HTMLButtonElement;
    
    if (loginBtnElement) {
        loginBtnElement.addEventListener('click', handleLogin);
    }
    
    if (logoutBtnElement) {
        logoutBtnElement.addEventListener('click', handleLogout);
    }
    
    if (genBtnElement) {
        genBtnElement.addEventListener('click', handleGeminiGeneration);
    }
    
    // Initialize application state
    (async (): Promise<void> => { 
        await initializeAuth();
        await checkHealth(); 
        checkElevenLabsWidget(); 
    })();
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
