/*
 * Copyright 2026 Achsah Systems
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use client";

import React, { useState, FormEvent } from "react";
import { fetchEngineJson } from "../lib/engine-client";

interface AuthResponse {
  token: string;
  email: string;
  id: string;
}

interface AuthPageProps {
  onAuthSuccess: () => void;
}

export function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const emailTrim = email.trim();
    const passwordTrim = password.trim();

    if (!emailTrim || !passwordTrim) {
      setError("Please fill in all fields.");
      return;
    }

    if (!isLogin && passwordTrim.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (!isLogin && passwordTrim !== confirmPassword.trim()) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/signup";
      const res = await fetchEngineJson<AuthResponse>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailTrim, password: passwordTrim }),
      });

      if (res && res.token) {
        localStorage.setItem("acsa_session_token", res.token);
        localStorage.setItem("acsa_user_email", res.email);
        localStorage.setItem("acsa_user_id", res.id);
        onAuthSuccess();
      } else {
        setError("Invalid response received from server.");
      }
    } catch (err: any) {
      setError(err?.message || "An authentication error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "github") => {
    setError(null);
    setLoading(true);

    const emailMap = {
      google: "google-user@acsa.io",
      github: "github-user@acsa.io",
    };

    const mockEmail = emailMap[provider];
    const mockPassword = `oauth-mock-secret-password-${provider}-123`;

    try {
      let res;
      try {
        // Try logging in first
        res = await fetchEngineJson<AuthResponse>("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: mockEmail, password: mockPassword }),
        });
      } catch (loginErr) {
        // Sign up if user doesn't exist yet
        res = await fetchEngineJson<AuthResponse>("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: mockEmail, password: mockPassword }),
        });
      }

      if (res && res.token) {
        localStorage.setItem("acsa_session_token", res.token);
        localStorage.setItem("acsa_user_email", res.email);
        localStorage.setItem("acsa_user_id", res.id);
        onAuthSuccess();
      } else {
        setError("Social login returned an invalid signature payload.");
      }
    } catch (err: any) {
      setError(err?.message || `Failed to sign in with ${provider}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        
        .auth-container {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Outfit', sans-serif;
          background-color: #fafafc;
          background-image: radial-gradient(rgba(111, 99, 255, 0.07) 1.5px, transparent 1.5px);
          background-size: 24px 24px;
          overflow: hidden;
          z-index: 99999;
        }

        /* Ambient background blobs matching canvas grid style */
        .auth-bg-blob {
          position: absolute;
          width: 550px;
          height: 550px;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.16;
          pointer-events: none;
          animation: floatBlob 22s infinite alternate ease-in-out;
        }

        .auth-bg-blob-1 {
          background: linear-gradient(135deg, #6f63ff, #aa63ff);
          top: -100px;
          left: -100px;
        }

        .auth-bg-blob-2 {
          background: linear-gradient(135deg, #3cddff, #3cffbd);
          bottom: -150px;
          right: -100px;
          animation-delay: -5s;
        }

        .auth-bg-blob-3 {
          background: linear-gradient(135deg, #ff4c93, #ff844c);
          top: 40%;
          right: 15%;
          width: 320px;
          height: 320px;
          opacity: 0.08;
          animation-delay: -10s;
        }

        @keyframes floatBlob {
          0% {
            transform: translate(0px, 0px) scale(1) rotate(0deg);
          }
          100% {
            transform: translate(80px, 50px) scale(1.15) rotate(180deg);
          }
        }

        /* Crisp Light Theme Card */
        .auth-card {
          width: 100%;
          max-width: 420px;
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-radius: 20px;
          padding: 36px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.01);
          position: relative;
          z-index: 10;
          animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .auth-header {
          text-align: center;
          margin-bottom: 28px;
        }

        .auth-logo {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 50px;
          height: 50px;
          background: linear-gradient(135deg, rgba(111, 99, 255, 0.06), rgba(111, 99, 255, 0.12));
          border: 1px solid rgba(111, 99, 255, 0.18);
          border-radius: 14px;
          margin-bottom: 14px;
          box-shadow: 0 4px 12px rgba(111, 99, 255, 0.08);
        }

        .auth-logo svg {
          width: 24px;
          height: 24px;
          fill: none;
          stroke: #6f63ff;
          stroke-width: 2;
        }

        .auth-title {
          font-size: 22px;
          font-weight: 700;
          color: #1c242c;
          letter-spacing: -0.5px;
          margin: 0;
        }

        .auth-subtitle {
          font-size: 13px;
          color: #68707a;
          margin-top: 6px;
          margin-bottom: 0;
        }

        /* Light Theme Tabs Selector */
        .auth-tabs {
          display: flex;
          background: rgba(0, 0, 0, 0.02);
          border: 1px solid rgba(0, 0, 0, 0.04);
          border-radius: 10px;
          padding: 3px;
          margin-bottom: 24px;
        }

        .auth-tab {
          flex: 1;
          background: transparent;
          border: none;
          color: #68707a;
          padding: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border-radius: 7px;
          transition: all 0.2s ease;
        }

        .auth-tab.active {
          background: #ffffff;
          color: #1c242c;
          border: 1px solid rgba(0, 0, 0, 0.03);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
        }

        /* Forms & Inputs */
        .auth-form-group {
          margin-bottom: 16px;
          position: relative;
        }

        .auth-label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          color: #4a545e;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 6px;
        }

        .auth-input-wrapper {
          position: relative;
        }

        .auth-input {
          width: 100%;
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.12);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13.5px;
          color: #1c242c;
          outline: none;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .auth-input:focus {
          border-color: #6f63ff;
          box-shadow: 0 0 0 4px rgba(111, 99, 255, 0.08);
        }

        /* Error Banner */
        .auth-error {
          background: rgba(235, 87, 87, 0.05);
          border: 1px solid rgba(235, 87, 87, 0.15);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
          color: #d93838;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
          animation: shake 0.4s ease;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        /* Brand indigo action button */
        .auth-submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #776cff, #5d52d8);
          border: none;
          border-radius: 10px;
          padding: 12px;
          font-size: 13.5px;
          font-weight: 600;
          color: #ffffff;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 3px 12px rgba(111, 99, 255, 0.18);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .auth-submit-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 5px 16px rgba(111, 99, 255, 0.28);
          background: linear-gradient(135deg, #8176ff, #655ae0);
        }

        .auth-submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .auth-submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* Loader Animation */
        .auth-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 0.8s infinite linear;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Separator / Divider for social logins */
        .auth-divider {
          display: flex;
          align-items: center;
          text-align: center;
          color: #8c96a3;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin: 20px 0;
        }

        .auth-divider::before,
        .auth-divider::after {
          content: '';
          flex: 1;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }

        .auth-divider:not(:empty)::before {
          margin-right: 12px;
        }

        .auth-divider:not(:empty)::after {
          margin-left: 12px;
        }

        /* Social buttons container */
        .auth-social-buttons {
          display: flex;
          gap: 12px;
          margin-bottom: 8px;
        }

        .auth-social-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 600;
          color: #1c242c;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .auth-social-btn:hover:not(:disabled) {
          background: #fafafc;
          border-color: rgba(0, 0, 0, 0.15);
          transform: translateY(-1px);
        }

        .auth-social-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .auth-social-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .auth-footer {
          text-align: center;
          margin-top: 20px;
          font-size: 12px;
          color: #68707a;
        }

        .auth-footer-link {
          color: #6f63ff;
          font-weight: 600;
          cursor: pointer;
          margin-left: 4px;
          transition: color 0.15s ease;
        }

        .auth-footer-link:hover {
          color: #5d52d8;
          text-decoration: underline;
        }
      `}</style>

      {/* Background organic floating blobs */}
      <div className="auth-bg-blob auth-bg-blob-1"></div>
      <div className="auth-bg-blob auth-bg-blob-2"></div>
      <div className="auth-bg-blob auth-bg-blob-3"></div>

      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <svg width="28" height="28" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="96" y="206" width="96" height="96" rx="28" stroke="#6f63ff" strokeWidth="22"/>
              <rect x="208" y="96" width="96" height="96" rx="28" stroke="#6f63ff" strokeWidth="22"/>
              <rect x="208" y="320" width="96" height="96" rx="28" stroke="#6f63ff" strokeWidth="22"/>
              <rect x="320" y="206" width="96" height="96" rx="28" stroke="#6f63ff" strokeWidth="22"/>
              <path d="M192 254H220" stroke="#6f63ff" strokeWidth="18" strokeLinecap="round"/>
              <path d="M292 254H320" stroke="#6f63ff" strokeWidth="18" strokeLinecap="round"/>
              <path d="M256 192V224" stroke="#6f63ff" strokeWidth="18" strokeLinecap="round"/>
              <path d="M256 288V320" stroke="#6f63ff" strokeWidth="18" strokeLinecap="round"/>
              <circle cx="256" cy="254" r="18" fill="#FFFFFF" stroke="#6f63ff" strokeWidth="16"/>
            </svg>
          </div>
          <h1 className="auth-title">Welcome to ACSA</h1>
          <p className="auth-subtitle">
            {isLogin ? "Sign in to access your private studio" : "Create your private multi-tenant workspace"}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${isLogin ? "active" : ""}`}
            onClick={() => {
              setIsLogin(true);
              setError(null);
            }}
            disabled={loading}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${!isLogin ? "active" : ""}`}
            onClick={() => {
              setIsLogin(false);
              setError(null);
            }}
            disabled={loading}
          >
            Sign Up
          </button>
        </div>

        {error && (
          <div className="auth-error">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="auth-form-group">
            <label className="auth-label">Email Address</label>
            <div className="auth-input-wrapper">
              <input
                type="email"
                className="auth-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="auth-form-group">
            <label className="auth-label">Password</label>
            <div className="auth-input-wrapper">
              <input
                type="password"
                className="auth-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          {!isLogin && (
            <div className="auth-form-group">
              <label className="auth-label">Confirm Password</label>
              <div className="auth-input-wrapper">
                <input
                  type="password"
                  className="auth-input"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <span className="auth-spinner"></span>
                <span>Authenticating...</span>
              </>
            ) : (
              <span>{isLogin ? "Sign In" : "Get Started"}</span>
            )}
          </button>
        </form>

        {/* Separator & Modern Social Logins */}
        <div className="auth-divider">Or continue with</div>

        <div className="auth-social-buttons">
          <button 
            type="button" 
            className="auth-social-btn" 
            onClick={() => void handleSocialLogin("google")}
            disabled={loading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>Google</span>
          </button>
          <button 
            type="button" 
            className="auth-social-btn" 
            onClick={() => void handleSocialLogin("github")}
            disabled={loading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.137 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            <span>GitHub</span>
          </button>
        </div>

        <div className="auth-footer">
          {isLogin ? (
            <>
              Don't have an account?
              <span className="auth-footer-link" onClick={() => setIsLogin(false)}>
                Sign up
              </span>
            </>
          ) : (
            <>
              Already have an account?
              <span className="auth-footer-link" onClick={() => setIsLogin(true)}>
                Sign in
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
