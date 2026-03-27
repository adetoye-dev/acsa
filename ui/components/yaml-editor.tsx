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
    backgroundColor: "#f2f4f8",
    color: "#17212b"
  },
  ".cm-content": {
    caretColor: "#17212b"
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(111, 99, 255, 0.05)"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(111, 99, 255, 0.05)"
  },
  ".cm-gutters": {
    backgroundColor: "#eef1f6",
    color: "rgba(91, 101, 115, 0.58)"
  }
});

const yamlHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.attributeName, tags.labelName],
    color: "#7a52cc"
  },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "#2e6f57"
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: "#0f6e8c"
  },
  {
    tag: [tags.keyword],
    color: "#b24e86"
  },
  {
    tag: [tags.comment],
    color: "rgba(101, 112, 126, 0.6)",
    fontStyle: "italic"
  },
  {
    tag: [tags.punctuation, tags.brace, tags.squareBracket],
    color: "rgba(76, 86, 98, 0.86)"
  }
]);

type YamlEditorProps = {
  fill?: boolean;
  id: string;
  minHeight: number;
  onChange: (value: string) => void;
  value: string;
};

export function YamlEditor({
  fill = false,
  id,
  minHeight,
  onChange,
  value
}: YamlEditorProps) {
  const extensions = useMemo(
    () => [yaml(), EditorView.lineWrapping, yamlEditorTheme, syntaxHighlighting(yamlHighlightStyle)],
    []
  );

  return (
    <div
      className={`yaml-editor overflow-hidden ${fill ? "h-full min-h-0" : ""}`}
      style={fill ? undefined : { minHeight }}
    >
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
        height={fill ? "100%" : `${minHeight}px`}
        id={id}
        indentWithTab={false}
        onChange={onChange}
        value={value}
      />
    </div>
  );
}
