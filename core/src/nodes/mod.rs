// Copyright 2026 Achsah Systems
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#![deny(warnings)]

pub fn built_in_node_types() -> &'static [&'static str] {
    &[
        "approval",
        "condition",
        "database_query",
        "embedding",
        "extraction",
        "http_request",
        "llm_completion",
        "manual_trigger",
        "switch",
        "webhook_trigger",
    ]
}
