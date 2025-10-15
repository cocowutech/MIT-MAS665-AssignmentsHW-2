/**
 * Authentication Utilities for ESL Assessment System (TypeScript)
 * 
 * This module provides centralized authentication functionality shared across all modules.
 * It handles token management, user validation, and authentication state.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

import { AuthResponse, User } from '../types/common.js';
import { apiClient } from './api.js';

// ============================================================================
// AUTHENTICATION STATE MANAGEMENT
// ============================================================================

/**
 * Global authentication state
 * Tracks user session and authentication status
 */
export class AuthState {
    public token: string | null = null;
    public username: string | null = null;
    public isAuthenticated: boolean = false;

    /**
     * Initialize authentication state from localStorage
     * Restores user session if valid token exists
     */
    initialize(): void {
        this.token = localStorage.getItem('token');
        this.username = localStorage.getItem('username');
        this.isAuthenticated = !!this.token;
    }

    /**
     * Set authentication credentials
     * @param token - JWT access token
     * @param username - Username
     */
    setCredentials(token: string, username: string): void {
        this.token = token;
        this.username = username;
        this.isAuthenticated = true;
        
        try {
            localStorage.setItem('token', token);
            if (username) {
                localStorage.setItem('username', username);
            }
        } catch (error) {
            console.warn('Failed to save credentials to localStorage:', error);
        }
    }

    /**
     * Clear authentication credentials
     */
    clearCredentials(): void {
        this.token = null;
        this.username = null;
        this.isAuthenticated = false;
        
        try {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
        } catch (error) {
            console.warn('Failed to clear credentials from localStorage:', error);
        }
    }

    /**
     * Get authorization header for API requests
     * @returns Authorization header value or null
     */
    getAuthHeader(): string | null {
        return this.token ? `Bearer ${this.token}` : null;
    }
}

// Global authentication state instance
export const authState = new AuthState();

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

/**
 * Validate authentication token with backend
 * @returns Promise<boolean> true if token is valid, false otherwise
 */
export async function validateToken(): Promise<boolean> {
    if (!authState.token) return false;
    
    try {
        const response: Response = await fetch('/auth/me', {
            headers: { 'Authorization': authState.getAuthHeader()! }
        });
        
        if (!response.ok) throw new Error('Invalid token');
        
        const userData: User | null = await response.json().catch(() => null);
        if (userData && userData.username) {
            authState.username = userData.username;
            try {
                localStorage.setItem('username', authState.username);
            } catch (_) {
                // Ignore localStorage errors
            }
        }
        return true;
    } catch (error) {
        console.warn('Token validation failed:', error);
        authState.clearCredentials();
        return false;
    }
}

/**
 * Authentication result interface
 */
export interface AuthResult {
    success: boolean;
    error?: string;
}

/**
 * Authenticate user with username and password
 * @param username - Username
 * @param password - Password
 * @returns Promise<AuthResult> Authentication result
 */
export async function authenticateUser(username: string, password: string): Promise<AuthResult> {
    try {
        const form = new URLSearchParams();
        form.set('username', username);
        form.set('password', password);
        
        const response: Response = await fetch('/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Authentication failed');
        }
        
        const data: AuthResponse = await response.json();
        authState.setCredentials(data.access_token, username);
        
        // Update UI to reflect authenticated state
        updateUIForAuthStatus();
        
        return { success: true };
    } catch (error) {
        console.error('Authentication error:', error);
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Logout current user
 */
export function logout(): void {
    authState.clearCredentials();
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
export function updateAuthHeader(): void {
    const authStateElement = document.getElementById('authState');
    const loginLinkElement = document.getElementById('loginLink');
    
    if (!authStateElement) return;
    
    if (authState.isAuthenticated) {
        authStateElement.textContent = authState.username ? 
            `Logged in as ${authState.username}` : 'Logged in';
        if (loginLinkElement) (loginLinkElement as HTMLElement).style.display = 'none';
        
        // Update API client with current token
        if ((window as any).APIUtils && (window as any).APIUtils.apiClient) {
            (window as any).APIUtils.apiClient.setAuthToken(authState.token);
        }
    } else {
        authStateElement.textContent = 'Logged out';
        if (loginLinkElement) (loginLinkElement as HTMLElement).style.display = 'inline';
        
        // Clear API client token
        if ((window as any).APIUtils && (window as any).APIUtils.apiClient) {
            (window as any).APIUtils.apiClient.setAuthToken(null);
        }
    }
}

/**
 * Show/hide login and session cards based on authentication status
 */
export function updateUIForAuthStatus(): void {
    console.log('updateUIForAuthStatus: authState.isAuthenticated =', authState.isAuthenticated);
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
    
    if (authState.isAuthenticated) {
        // Hide login form, show session interface
        if (loginCard) loginCard.classList.add('hidden');
        if (sessionCard) sessionCard.classList.remove('hidden');
        
        // Update user info display
        if (userInfo) {
            userInfo.textContent = `Logged in as: ${authState.username || 'user'}`;
        }
        if (logoutBtn) {
            logoutBtn.classList.remove('hidden');
        }
        
        // Update auth state display
        if (authStateEl) {
            authStateEl.textContent = `Logged in as: ${authState.username || 'user'}`;
        }
        if (loginLink) {
            (loginLink as HTMLElement).style.display = 'none';
        }

        // Show all module cards
        moduleCards.forEach(card => {
            card.classList.remove('hidden');
        });
    } else {
        // Show login form, hide session interface
        if (loginCard) loginCard.classList.remove('hidden');
        if (sessionCard) sessionCard.classList.add('hidden');
        
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
            (loginLink as HTMLElement).style.display = 'inline';
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
export async function initializeAuth(): Promise<boolean> {
    // Initialize state from localStorage
    authState.initialize();
    
    // Set API client token immediately
    apiClient.setAuthToken(authState.token);

    // Validate existing token if present
    if (authState.token) {
        const isValid = await validateToken();
        if (!isValid) {
            authState.clearCredentials();
            apiClient.setAuthToken(null); // Clear token from API client if invalid
        }
    }
    
    // Update UI based on authentication status
    updateAuthHeader();
    updateUIForAuthStatus();
    
    return authState.isAuthenticated;
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export for use in modules
(window as any).AuthUtils = {
    authState,
    validateToken,
    authenticateUser,
    logout,
    updateAuthHeader,
    updateUIForAuthStatus,
    initializeAuth
};

// Note: Exports removed for browser compatibility
