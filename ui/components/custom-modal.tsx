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

import React, { useState, useEffect, useRef } from "react";
import { 
  AlertTriangle, 
  HelpCircle, 
  Edit3, 
  Copy, 
  Play, 
  Download, 
  X 
} from "lucide-react";

interface CustomModalProps {
  type: "confirm" | "prompt";
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  isWarning?: boolean;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

export function CustomModal({
  type,
  title,
  message,
  defaultValue = "",
  placeholder = "Enter value...",
  confirmText,
  cancelText = "Cancel",
  isWarning = false,
  onConfirm,
  onCancel
}: CustomModalProps) {
  const [inputValue, setInputValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the input on mount
  useEffect(() => {
    if (type === "prompt") {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [type]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (type === "prompt") {
      onConfirm(inputValue);
    } else {
      onConfirm();
    }
  };

  const getIcon = () => {
    if (isWarning) return <AlertTriangle className="text-rose-500" size={20} />;
    if (type === "prompt") {
      if (title.toLowerCase().includes("duplicate")) return <Copy className="text-[#6f63ff]" size={20} />;
      return <Edit3 className="text-[#6f63ff]" size={20} />;
    }
    if (title.toLowerCase().includes("run") || title.toLowerCase().includes("trigger")) {
      return <Play className="text-[#6f63ff]" size={20} fill="currentColor" />;
    }
    if (title.toLowerCase().includes("export") || title.toLowerCase().includes("download")) {
      return <Download className="text-[#6f63ff]" size={20} />;
    }
    return <HelpCircle className="text-[#6f63ff]" size={20} />;
  };

  const defaultConfirmText = confirmText || (type === "prompt" ? "Save" : "Confirm");

  return (
    <div className="custom-modal-overlay">
      <style jsx>{`
        .custom-modal-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 19, 25, 0.4);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 999999;
          animation: fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .custom-modal-card {
          width: 100%;
          max-width: 400px;
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-radius: 18px;
          padding: 24px;
          box-shadow: 0 20px 48px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.01);
          position: relative;
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scaleUp {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .custom-modal-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }

        .custom-modal-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: ${isWarning ? "rgba(239, 68, 68, 0.08)" : "rgba(111, 99, 255, 0.08)"};
          border: 1px solid ${isWarning ? "rgba(239, 68, 68, 0.15)" : "rgba(111, 99, 255, 0.15)"};
          shrink-0;
        }

        .custom-modal-title-wrap {
          flex: 1;
          min-w: 0;
        }

        .custom-modal-title {
          font-size: 16px;
          font-weight: 700;
          color: #1c242c;
          letter-spacing: -0.3px;
          margin: 0;
          line-height: 1.3;
        }

        .custom-modal-close-btn {
          background: transparent;
          border: none;
          color: #8c96a3;
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .custom-modal-close-btn:hover {
          background: rgba(0, 0, 0, 0.04);
          color: #4a545e;
        }

        .custom-modal-message {
          font-size: 13.5px;
          line-height: 1.5;
          color: #5e6772;
          margin: 0 0 20px 0;
        }

        .custom-modal-input-wrapper {
          margin-bottom: 20px;
        }

        .custom-modal-input {
          width: 100%;
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.15);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13.5px;
          color: #1c242c;
          outline: none;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .custom-modal-input:focus {
          border-color: #6f63ff;
          box-shadow: 0 0 0 4px rgba(111, 99, 255, 0.08);
        }

        .custom-modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .custom-btn {
          font-size: 13px;
          font-weight: 600;
          padding: 9px 16px;
          border-radius: 9px;
          cursor: pointer;
          transition: all 0.15s ease;
          outline: none;
        }

        .custom-btn-cancel {
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.1);
          color: #4a545e;
        }

        .custom-btn-cancel:hover {
          background: #fafafc;
          border-color: rgba(0, 0, 0, 0.16);
        }

        .custom-btn-confirm {
          border: none;
          color: #ffffff;
          background: ${isWarning 
            ? "linear-gradient(135deg, #ef4444, #dc2626)" 
            : "linear-gradient(135deg, #776cff, #5d52d8)"};
          box-shadow: 0 2px 8px ${isWarning ? "rgba(239, 68, 68, 0.15)" : "rgba(111, 99, 255, 0.15)"};
        }

        .custom-btn-confirm:hover {
          transform: translateY(-0.5px);
          background: ${isWarning 
            ? "linear-gradient(135deg, #f87171, #e11d48)" 
            : "linear-gradient(135deg, #8176ff, #655ae0)"};
          box-shadow: 0 4px 12px ${isWarning ? "rgba(239, 68, 68, 0.25)" : "rgba(111, 99, 255, 0.25)"};
        }

        .custom-btn-confirm:active {
          transform: translateY(0);
        }
      `}</style>

      <div className="custom-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <div className="custom-modal-icon">
            {getIcon()}
          </div>
          <div className="custom-modal-title-wrap">
            <h3 className="custom-modal-title">{title}</h3>
          </div>
          <button className="custom-modal-close-btn" onClick={onCancel} type="button" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <p className="custom-modal-message">{message}</p>

        <form onSubmit={handleSubmit}>
          {type === "prompt" && (
            <div className="custom-modal-input-wrapper">
              <input
                ref={inputRef}
                type="text"
                className="custom-modal-input"
                placeholder={placeholder}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                required
              />
            </div>
          )}

          <div className="custom-modal-actions">
            <button className="custom-btn custom-btn-cancel" onClick={onCancel} type="button">
              {cancelText}
            </button>
            <button className="custom-btn custom-btn-confirm" type="submit">
              {defaultConfirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
