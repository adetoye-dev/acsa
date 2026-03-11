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

import { yaml } from "@codemirror/lang-yaml";
import dynamic from "next/dynamic";

const CodeMirror = dynamic(async () => (await import("@uiw/react-codemirror")).default, {
  ssr: false
});

type YamlEditorProps = {
  id: string;
  minHeight: number;
  onChange: (value: string) => void;
  value: string;
};

export function YamlEditor({ id, minHeight, onChange, value }: YamlEditorProps) {
  const extensions = useMemo(() => [yaml()], []);

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
