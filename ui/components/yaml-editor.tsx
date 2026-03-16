"use client";

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

import { useMemo } from "react";

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { yaml } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
import dynamic from "next/dynamic";

const CodeMirror = dynamic(async () => (await import("@uiw/react-codemirror")).default, {
  ssr: false
});

const yamlEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "rgba(17, 23, 25, 0.98)",
    color: "#e7f0ef"
  },
  ".cm-content": {
    caretColor: "#f2f7f6"
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.03)"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255, 255, 255, 0.03)"
  },
  ".cm-gutters": {
    backgroundColor: "rgba(10, 14, 15, 0.94)",
    color: "rgba(213, 228, 227, 0.52)"
  }
});

const yamlHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.attributeName, tags.labelName],
    color: "#f5d88d"
  },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "#d6f3c8"
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: "#9fd8ff"
  },
  {
    tag: [tags.keyword],
    color: "#ffb07a"
  },
  {
    tag: [tags.comment],
    color: "rgba(176, 196, 194, 0.58)",
    fontStyle: "italic"
  },
  {
    tag: [tags.punctuation, tags.brace, tags.squareBracket],
    color: "rgba(216, 230, 229, 0.82)"
  }
]);

type YamlEditorProps = {
  id: string;
  minHeight: number;
  onChange: (value: string) => void;
  value: string;
};

export function YamlEditor({ id, minHeight, onChange, value }: YamlEditorProps) {
  const extensions = useMemo(
    () => [yaml(), yamlEditorTheme, syntaxHighlighting(yamlHighlightStyle)],
    []
  );

  return (
    <div className="yaml-editor overflow-hidden" style={{ minHeight }}>
      <CodeMirror
        basicSetup={{
          autocompletion: true,
          bracketMatching: true,
          foldGutter: false,
          highlightActiveLine: false,
          indentOnInput: true,
          lineNumbers: true
        }}
        extensions={extensions}
        height={`${minHeight}px`}
        id={id}
        indentWithTab={false}
        onChange={onChange}
        value={value}
      />
    </div>
  );
}
