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

import React, { useState, useEffect } from "react";
import { SignIn, SignUp } from "@clerk/nextjs";

interface AuthPageProps {
  onAuthSuccess?: () => void;
}

export function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      const cards = document.querySelectorAll(".cl-card");
      cards.forEach((card) => {
        if (card && !card.querySelector(".cl-custom-footer")) {
          const footer = document.createElement("div");
          footer.className = "cl-custom-footer";
          footer.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="cl-custom-footer-icon" style="flex-shrink: 0;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <span>Powered by Clerk</span>
          `;
          card.appendChild(footer);
        }
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isLogin]);

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

        .auth-card-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
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

        .auth-clerk-toggle {
          margin-top: 20px;
          font-size: 13.5px;
          color: #68707a;
          background: rgba(255, 255, 255, 0.8);
          border: 1px solid rgba(0, 0, 0, 0.06);
          padding: 8px 16px;
          border-radius: 20px;
          cursor: pointer;
          font-weight: 500;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
          transition: all 0.2s ease;
        }

        .auth-clerk-toggle:hover {
          background: #ffffff;
          border-color: #6f63ff;
          color: #1c242c;
          transform: translateY(-1px);
        }

        .cl-card {
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.01) !important;
          border: 1px solid rgba(0, 0, 0, 0.06) !important;
          border-radius: 20px !important;
          overflow: hidden !important;
          position: relative !important;
          padding-bottom: 0 !important;
        }

        .cl-custom-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 14px 20px;
          border-top: 1px solid rgba(18, 22, 27, 0.06);
          width: 100%;
          font-size: 10.5px;
          font-weight: 700;
          color: rgba(94, 103, 114, 0.55);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          box-sizing: border-box;
          user-select: none;
          margin-top: auto;
        }

        .cl-custom-footer-icon {
          color: #6f63ff;
          opacity: 0.8;
          animation: floatCreditIcon 3s infinite ease-in-out;
        }

        @keyframes floatCreditIcon {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-1px); }
        }
      `}</style>

      <div className="auth-bg-blob auth-bg-blob-1"></div>
      <div className="auth-bg-blob auth-bg-blob-2"></div>
      <div className="auth-bg-blob auth-bg-blob-3"></div>

      <div className="auth-card-wrapper">
        {isLogin ? (
          <SignIn 
            routing="hash"
            forceRedirectUrl="/workflows"
            appearance={{
              elements: {
                card: "cl-card",
                footer: "hidden",
                footerAction: "hidden"
              }
            }}
          />
        ) : (
          <SignUp 
            routing="hash"
            forceRedirectUrl="/workflows"
            appearance={{
              elements: {
                card: "cl-card",
                footer: "hidden",
                footerAction: "hidden"
              }
            }}
          />
        )}
        <button 
          onClick={() => setIsLogin(!isLogin)} 
          className="auth-clerk-toggle"
        >
          {isLogin ? "Need an account? Sign Up" : "Already have an account? Sign In"}
        </button>
      </div>
    </div>
  );
}
