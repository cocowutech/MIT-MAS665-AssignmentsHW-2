
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
// DOM element selector helper with proper typing
const $ = (id) => document.getElementById(id);
// Global state variables with explicit types
let token = localStorage.getItem('token');
let username = localStorage.getItem('username');
/**
 * Validates the current authentication token with the backend
 * @returns Promise<boolean> True if token is valid, false otherwise
 */
async function validateToken() {
    if (!token)
        return false;
    try {
        const response = await fetch('/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok)
            throw new Error('invalid');
        const userData = await response.json().catch(() => null);
        // Update username if available from server response
        if (userData && userData.username) {
            username = userData.username;
            try {
                localStorage.setItem('username', username);
            }
            catch (_) { }
        }
        return true;
    }
    catch (_) {
        handleAuthFailure();
        return false;
    }
}
/**
 * Updates the UI based on current authentication state
 * Shows/hides login form and main application interface
 */
function updateAuthUI() {
    const authStateElement = $('authState');
    const logoutBtnElement = $('logoutBtn');
    const loginCardElement = $('login-card');
    const genCardElement = $('gen-card');
    // Get all module cards
    const moduleCards = document.querySelectorAll('.module-card');
    if (token) {
        // User is authenticated - show main interface
        authStateElement.className = 'auth-status logged-in';
        authStateElement.innerHTML = `
            <span class="status-icon"></span>
            <span>Logged in as ${username || 'user'}</span>
        `;
        logoutBtnElement.style.display = 'inline-block';
        loginCardElement.style.display = 'none';
        genCardElement.style.display = 'block';
        // Show all module cards
        moduleCards.forEach(card => {
            card.classList.remove('hidden');
        });
    }
    else {
        // User is not authenticated - show login form
        authStateElement.className = 'auth-status logged-out';
        authStateElement.innerHTML = `
            <span class="status-icon"></span>
            <span>Not logged in</span>
        `;
        logoutBtnElement.style.display = 'none';
        loginCardElement.style.display = 'block';
        genCardElement.style.display = 'none';
        // Hide all module cards
        moduleCards.forEach(card => {
            card.classList.add('hidden');
        });
    }
}
/**
 * Handles authentication failure by clearing stored credentials
 * and updating the UI to show login form
 */
function handleAuthFailure() {
    token = null;
    username = null;
    try {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
    }
    catch (_) { }
    updateAuthUI();
}
/**
 * Checks the health status of the backend API
 * Updates the status indicator in the header
 */
async function checkHealth() {
    try {
        const response = await fetch('/health');
        if (!response.ok)
            throw new Error('health failed');
        const healthData = await response.json();
        const statusElement = $('status');
        statusElement.textContent = healthData.ok ? 'API: OK' : 'API: error';
    }
    catch (e) {
        const statusElement = $('status');
        statusElement.textContent = 'API: unreachable';
    }
}
/**
 * Handles user login process
 * Sends credentials to backend and stores token if successful
 */
async function handleLogin() {
    const loginBtnElement = $('loginBtn');
    const loginMsgElement = $('loginMsg');
    const usernameElement = $('username');
    const passwordElement = $('password');
    const loginCardElement = $('login-card');
    // Add loading state
    loginBtnElement.disabled = true;
    loginCardElement.classList.add('loading');
    loginMsgElement.className = 'message';
    loginMsgElement.textContent = 'Logging in...';
    try {
        // Prepare form data
        const form = new URLSearchParams();
        form.set('username', usernameElement.value);
        form.set('password', passwordElement.value);
        // Send login request
        const response = await fetch('/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Login failed');
        }
        const authData = await response.json();
        // Store authentication data
        token = authData.access_token;
        username = usernameElement.value || null;
        try {
            localStorage.setItem('token', token);
            if (username)
                localStorage.setItem('username', username);
        }
        catch (_) { }
        // Show success message
        loginMsgElement.className = 'message success';
        loginMsgElement.textContent = `Successfully logged in as ${username}!`;
        // Update UI after a short delay to show success message
        setTimeout(() => {
            updateAuthUI();
        }, 1000);
    }
    catch (e) {
        loginMsgElement.className = 'message error';
        loginMsgElement.textContent = `Login failed: ${e.message}`;
    }
    finally {
        loginBtnElement.disabled = false;
        loginCardElement.classList.remove('loading');
    }
}
/**
 * Handles user logout process
 * Clears stored credentials and updates UI
 */
function handleLogout() {
    const loginMsgElement = $('loginMsg');
    // Show logout message
    loginMsgElement.className = 'message';
    loginMsgElement.textContent = 'Logging out...';
    // Clear credentials and update UI
    handleAuthFailure();
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
window.toggleFallback = function toggleFallback() {
    const elevenlabsWidget = document.getElementById('elevenlabs-widget');
    const geminiChat = document.getElementById('gemini-chat');
    const fallbackBtn = document.getElementById('fallbackBtn');
    if (!elevenlabsWidget || !geminiChat || !fallbackBtn)
        return;
    if (elevenlabsWidget.style.display === 'none') {
        // Show ElevenLabs widget, hide Gemini chat
        elevenlabsWidget.style.display = 'block';
        geminiChat.style.display = 'none';
        fallbackBtn.textContent = 'Use Gemini Chat Instead';
    }
    else {
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
function checkElevenLabsWidget() {
    setTimeout(() => {
        const convaiElement = document.querySelector('elevenlabs-convai');
        if (!convaiElement || !convaiElement.shadowRoot) {
            // Widget failed to load, show fallback button
            const fallbackBtn = document.getElementById('fallbackBtn');
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
async function handleGeminiGeneration() {
    const genBtnElement = $('genBtn');
    const outElement = $('out');
    const promptElement = $('prompt');
    genBtnElement.disabled = true;
    outElement.textContent = '…';
    try {
        const requestBody = { prompt: promptElement.value };
        const response = await fetch('/gemini/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestBody)
        });
        if (response.status === 401) {
            handleAuthFailure();
            throw new Error('Unauthorized');
        }
        if (!response.ok)
            throw new Error('request failed');
        const responseData = await response.json();
        outElement.textContent = responseData && typeof responseData.text === 'string' ? responseData.text : '';
    }
    catch (e) {
        outElement.textContent = String(e);
    }
    finally {
        genBtnElement.disabled = false;
    }
}
/**
 * Initialize the application when DOM is loaded
 * Sets up event listeners and performs initial checks
 */
function initializeApp() {
    // Set up event listeners with proper type checking
    const loginBtnElement = $('loginBtn');
    const logoutBtnElement = $('logoutBtn');
    const genBtnElement = $('genBtn');
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
    (async () => {
        await validateToken();
        updateAuthUI();
        await checkHealth();
        checkElevenLabsWidget();
    })();
}
// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
}
else {
    initializeApp();
}
//# sourceMappingURL=main.js.map