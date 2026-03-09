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

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::{
    as_array, as_object, as_string, cosine_similarity, embed_text, lookup_required,
    take_string_list, EmbeddedDocument, Node, NodeError, RateLimiter, VectorStore,
};

#[derive(Clone, Default)]
pub struct LlmCompletionNode {
    client: reqwest::Client,
    limiter: RateLimiter,
}

impl LlmCompletionNode {
    pub fn new(limiter: RateLimiter) -> Self {
        Self { client: reqwest::Client::new(), limiter }
    }
}

#[async_trait]
impl Node for LlmCompletionNode {
    fn type_name(&self) -> &'static str {
        "llm_completion"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let provider = params.get("provider").and_then(Value::as_str).unwrap_or("mock");
        let prompt = resolve_prompt(inputs, params)?;
        let system_prompt = params.get("system_prompt").and_then(Value::as_str).unwrap_or("");
        let model = params.get("model").and_then(Value::as_str).unwrap_or("mock-model");

        self.limiter
            .acquire(params.get("rate_limit_per_second").and_then(Value::as_f64), None)
            .await?;

        match provider {
            "mock" => {
                let response = params
                    .get("response")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{system_prompt}\n{prompt}").trim().to_string());
                Ok(json!({
                    "model": model,
                    "provider": provider,
                    "content": response,
                    "usage": {
                        "input_tokens_estimate": prompt.split_whitespace().count()
                    }
                }))
            }
            "openai" | "openai_compatible" => {
                let endpoint = resolve_openai_endpoint(params)?;
                let api_key = resolve_api_key(params)?;
                let response = self
                    .client
                    .post(endpoint)
                    .bearer_auth(api_key)
                    .json(&json!({
                        "model": model,
                        "messages": [
                            { "role": "system", "content": system_prompt },
                            { "role": "user", "content": prompt }
                        ],
                        "max_tokens": params.get("max_tokens").and_then(Value::as_u64)
                    }))
                    .send()
                    .await
                    .map_err(|error| NodeError::Message {
                        message: format!("llm request failed: {error}"),
                    })?;
                let status = response.status();
                if !status.is_success() {
                    let error_text = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "<unable to read error body>".to_string());
                    return Err(NodeError::Message {
                        message: format!("openai request returned {status}: {error_text}"),
                    });
                }
                let body = response.json::<Value>().await.map_err(|error| NodeError::Message {
                    message: format!("failed to parse llm response: {error}"),
                })?;
                let content = body
                    .pointer("/choices/0/message/content")
                    .and_then(Value::as_str)
                    .ok_or(NodeError::Message {
                        message:
                            "openai-compatible response did not include choices[0].message.content"
                                .to_string(),
                    })?;
                Ok(json!({ "model": model, "provider": provider, "content": content, "raw": body }))
            }
            "anthropic" => {
                let endpoint = params
                    .get("endpoint")
                    .and_then(Value::as_str)
                    .unwrap_or("https://api.anthropic.com/v1/messages");
                let api_key = resolve_api_key(params)?;
                let response = self
                    .client
                    .post(endpoint)
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&json!({
                        "model": model,
                        "max_tokens": params.get("max_tokens").and_then(Value::as_u64).unwrap_or(256),
                        "system": system_prompt,
                        "messages": [{ "role": "user", "content": prompt }]
                    }))
                    .send()
                    .await
                    .map_err(|error| NodeError::Message {
                        message: format!("llm request failed: {error}"),
                    })?;
                let status = response.status();
                if !status.is_success() {
                    let error_text = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "<unable to read error body>".to_string());
                    return Err(NodeError::Message {
                        message: format!("anthropic request returned {status}: {error_text}"),
                    });
                }
                let body = response.json::<Value>().await.map_err(|error| NodeError::Message {
                    message: format!("failed to parse llm response: {error}"),
                })?;
                let content = body.pointer("/content/0/text").and_then(Value::as_str).ok_or(
                    NodeError::Message {
                        message: "anthropic response did not include content[0].text".to_string(),
                    },
                )?;
                Ok(json!({ "model": model, "provider": provider, "content": content, "raw": body }))
            }
            other => Err(NodeError::InvalidParameter {
                parameter: "provider".to_string(),
                message: format!("unsupported llm provider {other}"),
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ClassificationNode;

impl ClassificationNode {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Node for ClassificationNode {
    fn type_name(&self) -> &'static str {
        "classification"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let text = resolve_text(inputs, params, "text", "text_path")?;
        let classes = take_string_list(
            params.get("classes").ok_or(NodeError::MissingParameter { parameter: "classes" })?,
            "classes",
        )?;
        let text_lower = text.to_lowercase();
        let selected = classes
            .iter()
            .find(|class_name| text_lower.contains(&class_name.to_lowercase()))
            .cloned()
            .unwrap_or_else(|| {
                classes.first().cloned().unwrap_or_else(|| "unclassified".to_string())
            });

        Ok(json!({ "class": selected, "classes": classes, "text": text }))
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ExtractionNode;

impl ExtractionNode {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Node for ExtractionNode {
    fn type_name(&self) -> &'static str {
        "extraction"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let text = resolve_text(inputs, params, "text", "text_path")?;
        let schema = as_object(
            params.get("schema").ok_or(NodeError::MissingParameter { parameter: "schema" })?,
            "schema",
        )?;
        let mut extracted = serde_json::Map::new();

        for field in schema.keys() {
            let prefix = format!("{field}:");
            let value = text
                .lines()
                .find_map(|line| line.trim().strip_prefix(&prefix).map(str::trim))
                .map(str::to_string)
                .unwrap_or_default();
            extracted.insert(field.clone(), Value::String(value));
        }

        Ok(Value::Object(extracted))
    }
}

#[derive(Clone)]
pub struct EmbeddingNode {
    store: Arc<Mutex<VectorStore>>,
}

impl EmbeddingNode {
    pub fn new(store: Arc<Mutex<VectorStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Node for EmbeddingNode {
    fn type_name(&self) -> &'static str {
        "embedding"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let text = resolve_text(inputs, params, "text", "text_path")?;
        let vector = embed_text(&text);
        let collection = params.get("collection").and_then(Value::as_str);

        if let Some(collection) = collection {
            let document = EmbeddedDocument {
                id: params
                    .get("document_id")
                    .and_then(Value::as_str)
                    .unwrap_or("document")
                    .to_string(),
                metadata: params.get("metadata").cloned().unwrap_or_else(|| json!({})),
                text: text.clone(),
                vector: vector.clone(),
            };
            self.store.lock().await.insert(collection, document);
        }

        Ok(json!({
            "dimensions": vector.len(),
            "vector": vector,
            "collection": collection
        }))
    }
}

#[derive(Clone)]
pub struct RetrievalNode {
    store: Arc<Mutex<VectorStore>>,
}

impl RetrievalNode {
    pub fn new(store: Arc<Mutex<VectorStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Node for RetrievalNode {
    fn type_name(&self) -> &'static str {
        "retrieval"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let query = resolve_text(inputs, params, "query", "query_path")?;
        let query_vector = embed_text(&query);
        let top_k = params.get("top_k").and_then(Value::as_u64).unwrap_or(3) as usize;

        let documents = if let Some(collection) = params.get("collection").and_then(Value::as_str) {
            self.store.lock().await.query(collection).to_vec()
        } else {
            as_array(
                params
                    .get("documents")
                    .ok_or(NodeError::MissingParameter { parameter: "documents" })?,
                "documents",
            )?
            .iter()
            .enumerate()
            .map(|(index, document)| EmbeddedDocument {
                id: document
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("doc-{index}")),
                metadata: document.get("metadata").cloned().unwrap_or_else(|| json!({})),
                text: document.get("text").and_then(Value::as_str).unwrap_or_default().to_string(),
                vector: embed_text(
                    document.get("text").and_then(Value::as_str).unwrap_or_default(),
                ),
            })
            .collect()
        };

        let mut ranked = documents
            .into_iter()
            .map(|document| {
                let score = cosine_similarity(&query_vector, &document.vector);
                json!({
                    "id": document.id,
                    "metadata": document.metadata,
                    "score": score,
                    "text": document.text
                })
            })
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| {
            let left_score = left.get("score").and_then(Value::as_f64).unwrap_or(0.0);
            let right_score = right.get("score").and_then(Value::as_f64).unwrap_or(0.0);
            right_score.partial_cmp(&left_score).unwrap_or(std::cmp::Ordering::Equal)
        });
        ranked.truncate(top_k);

        Ok(json!({ "matches": ranked, "query": query }))
    }
}

fn resolve_api_key(params: &Value) -> Result<String, NodeError> {
    let env_name = params
        .get("api_key_env")
        .and_then(Value::as_str)
        .ok_or(NodeError::MissingParameter { parameter: "api_key_env" })?;
    std::env::var(env_name).map_err(|_| NodeError::InvalidParameter {
        parameter: "api_key_env".to_string(),
        message: format!("environment variable {env_name} is not set"),
    })
}

fn resolve_openai_endpoint(params: &Value) -> Result<String, NodeError> {
    if let Some(endpoint) = params.get("endpoint").and_then(Value::as_str) {
        return Ok(endpoint.to_string());
    }
    let api_base =
        params.get("api_base").and_then(Value::as_str).unwrap_or("https://api.openai.com/v1");
    Ok(format!("{}/chat/completions", api_base.trim_end_matches('/')))
}

fn resolve_prompt(inputs: &Value, params: &Value) -> Result<String, NodeError> {
    if let Some(prompt) = params.get("prompt").and_then(Value::as_str) {
        return Ok(prompt.to_string());
    }
    if let Some(path) = params.get("prompt_path").and_then(Value::as_str) {
        return Ok(as_string(lookup_required(inputs, path)?, "prompt_path")?.to_string());
    }
    Err(NodeError::MissingParameter { parameter: "prompt" })
}

fn resolve_text(
    inputs: &Value,
    params: &Value,
    direct_key: &'static str,
    path_key: &'static str,
) -> Result<String, NodeError> {
    if let Some(text) = params.get(direct_key).and_then(Value::as_str) {
        return Ok(text.to_string());
    }
    if let Some(path) = params.get(path_key).and_then(Value::as_str) {
        return Ok(as_string(lookup_required(inputs, path)?, path_key)?.to_string());
    }
    Err(NodeError::MissingParameter { parameter: direct_key })
}

#[cfg(test)]
mod tests {
    use super::{
        ClassificationNode, EmbeddingNode, ExtractionNode, LlmCompletionNode, RetrievalNode,
    };
    use crate::nodes::Node;
    use serde_json::json;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn llm_completion_mock_provider_returns_a_response() {
        let node = LlmCompletionNode::new(crate::nodes::RateLimiter::default());
        let output = node
            .execute(
                &json!({}),
                &json!({
                    "provider": "mock",
                    "prompt": "Summarize this",
                    "response": "done"
                }),
            )
            .await
            .expect("mock completion should succeed");

        assert_eq!(output["content"], json!("done"));
    }

    #[tokio::test]
    async fn classification_and_extraction_nodes_use_local_fallbacks() {
        let classifier = ClassificationNode::new();
        let extractor = ExtractionNode::new();

        let class_output = classifier
            .execute(
                &json!({}),
                &json!({
                    "text": "Priority: urgent",
                    "classes": ["urgent", "normal"]
                }),
            )
            .await
            .expect("classification should succeed");
        let extract_output = extractor
            .execute(
                &json!({}),
                &json!({
                    "text": "name: Acsa\nowner: Achsah Systems",
                    "schema": {
                        "name": "string",
                        "owner": "string"
                    }
                }),
            )
            .await
            .expect("extraction should succeed");

        assert_eq!(class_output["class"], json!("urgent"));
        assert_eq!(extract_output["owner"], json!("Achsah Systems"));
    }

    #[tokio::test]
    async fn embedding_and_retrieval_nodes_share_a_vector_store() {
        let store = Arc::new(Mutex::new(crate::nodes::VectorStore::default()));
        let embed = EmbeddingNode::new(store.clone());
        let retrieve = RetrievalNode::new(store);

        embed
            .execute(
                &json!({}),
                &json!({
                    "text": "acsa workflows automation",
                    "collection": "docs",
                    "document_id": "doc-1"
                }),
            )
            .await
            .expect("embedding should succeed");

        let output = retrieve
            .execute(
                &json!({}),
                &json!({
                    "query": "automation workflows",
                    "collection": "docs",
                    "top_k": 1
                }),
            )
            .await
            .expect("retrieval should succeed");

        assert_eq!(output["matches"][0]["id"], json!("doc-1"));
    }
}
