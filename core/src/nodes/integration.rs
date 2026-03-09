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

use std::{path::PathBuf, str::FromStr};

use async_trait::async_trait;
use reqwest::{header::HeaderMap, Method, Url};
use serde_json::{json, Map, Value};
use sqlx::{
    postgres::{PgPoolOptions, PgRow},
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
    Column, Row, Type, TypeInfo,
};

use super::{
    as_array, as_object, as_string, ensure_relative_path, lookup_required, Node, NodeError,
    RateLimiter,
};

#[derive(Clone, Default)]
pub struct HttpRequestNode {
    client: reqwest::Client,
    limiter: RateLimiter,
}

impl HttpRequestNode {
    pub fn new(limiter: RateLimiter) -> Self {
        Self { client: reqwest::Client::new(), limiter }
    }
}

#[async_trait]
impl Node for HttpRequestNode {
    fn type_name(&self) -> &'static str {
        "http_request"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let method = params
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("GET")
            .parse::<Method>()
            .map_err(|error| NodeError::InvalidParameter {
                parameter: "method".to_string(),
                message: error.to_string(),
            })?;
        let url_value = match params.get("url") {
            Some(url) => url.clone(),
            None => {
                let path = params
                    .get("url_path")
                    .and_then(Value::as_str)
                    .ok_or(NodeError::MissingParameter { parameter: "url" })?;
                lookup_required(inputs, path)?.clone()
            }
        };
        let url = Url::parse(as_string(&url_value, "url")?).map_err(|error| {
            NodeError::InvalidParameter { parameter: "url".to_string(), message: error.to_string() }
        })?;

        let allow_insecure = params.get("allow_insecure").and_then(Value::as_bool).unwrap_or(false);
        if url.scheme() != "https" && !allow_insecure {
            return Err(NodeError::SecurityViolation {
                message: "http_request only allows HTTPS unless allow_insecure is explicitly true"
                    .to_string(),
            });
        }

        let _rate_permit = self
            .limiter
            .acquire(params.get("rate_limit_per_second").and_then(Value::as_f64), None)
            .await?;

        let mut request = self.client.request(method, url);
        request = request.timeout(std::time::Duration::from_secs(
            params.get("timeout_secs").and_then(Value::as_u64).unwrap_or(30),
        ));

        if let Some(headers) = params.get("headers") {
            request = request.headers(build_headers(headers)?);
        }
        if let Some(query) = params.get("query") {
            request = request.query(&flatten_query(query)?);
        }
        if let Some(body) = params.get("body") {
            request = request.json(body);
        } else if let Some(path) = params.get("body_path").and_then(Value::as_str) {
            request = request.json(lookup_required(inputs, path)?);
        }

        let response = request.send().await.map_err(|error| NodeError::Message {
            message: format!("http request failed: {error}"),
        })?;
        let status = response.status();
        let headers = response.headers().clone();
        let text = response.text().await.map_err(|error| NodeError::Message {
            message: format!("failed to read response body: {error}"),
        })?;

        if !status.is_success() {
            return Err(NodeError::Message {
                message: format!("http request returned {status}: {text}"),
            });
        }

        let body = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
        Ok(json!({
            "status": status.as_u16(),
            "headers": stringify_headers(&headers),
            "body": body
        }))
    }
}

#[derive(Clone)]
pub struct DatabaseQueryNode {
    data_dir: PathBuf,
}

impl DatabaseQueryNode {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

#[async_trait]
impl Node for DatabaseQueryNode {
    fn type_name(&self) -> &'static str {
        "database_query"
    }

    async fn execute(&self, _inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let query = params
            .get("query")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "query" })?;
        let args = params.get("args").cloned().unwrap_or_else(|| json!([]));
        let args = as_array(&args, "args")?;
        let backend = params.get("backend").and_then(Value::as_str).unwrap_or("sqlite");

        match backend {
            "sqlite" => {
                let path = params
                    .get("sqlite_path")
                    .and_then(Value::as_str)
                    .ok_or(NodeError::MissingParameter { parameter: "sqlite_path" })?;
                let resolved = ensure_relative_path(&self.data_dir, path)?;
                if let Some(parent) = resolved.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|error| {
                        NodeError::Message {
                            message: format!("failed to prepare sqlite directory: {error}"),
                        }
                    })?;
                }
                let database_url = format!("sqlite://{}", resolved.display());
                let options = SqliteConnectOptions::from_str(&database_url)
                    .map_err(|error| NodeError::Message {
                        message: format!("failed to build sqlite connection options: {error}"),
                    })?
                    .create_if_missing(true);
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options)
                    .await
                    .map_err(|error| NodeError::Message {
                        message: format!("failed to connect to sqlite database: {error}"),
                    })?;
                let result = execute_sqlite_query(&pool, query, args).await?;
                pool.close().await;
                Ok(result)
            }
            "postgres" => {
                let connection = resolve_connection_string(params)?;
                let pool =
                    PgPoolOptions::new().max_connections(1).connect(&connection).await.map_err(
                        |error| NodeError::Message {
                            message: format!("failed to connect to postgres database: {error}"),
                        },
                    )?;
                let result = execute_postgres_query(&pool, query, args).await?;
                pool.close().await;
                Ok(result)
            }
            other => Err(NodeError::InvalidParameter {
                parameter: "backend".to_string(),
                message: format!("unsupported database backend {other}"),
            }),
        }
    }
}

#[derive(Clone)]
pub struct FileReadNode {
    data_dir: PathBuf,
}

impl FileReadNode {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

#[async_trait]
impl Node for FileReadNode {
    fn type_name(&self) -> &'static str {
        "file_read"
    }

    async fn execute(&self, _inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "path" })?;
        let resolved = ensure_relative_path(&self.data_dir, path)?;
        
        // Check file size before reading
        const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB limit
        let metadata = tokio::fs::metadata(&resolved).await.map_err(|error| {
            NodeError::Message { message: format!("failed to read file metadata: {error}") }
        })?;
        if metadata.len() > MAX_FILE_SIZE {
            return Err(NodeError::Message {
                message: format!(
                    "file size {} exceeds maximum allowed size {}",
                    metadata.len(),
                    MAX_FILE_SIZE
                ),
            });
        }
        
        let contents = tokio::fs::read_to_string(&resolved).await.map_err(|error| {
            NodeError::Message { message: format!("failed to read file: {error}") }
        })?;
        let parsed = if params.get("as_json").and_then(Value::as_bool).unwrap_or(false) {
            serde_json::from_str(&contents).unwrap_or(Value::String(contents.clone()))
        } else {
            Value::String(contents.clone())
        };

        Ok(json!({ "path": path, "contents": parsed, "length": contents.len() }))
    }
}

#[derive(Clone)]
pub struct FileWriteNode {
    data_dir: PathBuf,
}

impl FileWriteNode {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

#[async_trait]
impl Node for FileWriteNode {
    fn type_name(&self) -> &'static str {
        "file_write"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "path" })?;
        let resolved = ensure_relative_path(&self.data_dir, path)?;
        if let Some(parent) = resolved.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| NodeError::Message {
                message: format!("failed to prepare file directory: {error}"),
            })?;
        }

        let contents = match params.get("contents") {
            Some(Value::String(text)) => text.clone(),
            Some(other) => {
                serde_json::to_string_pretty(other).map_err(|error| NodeError::Message {
                    message: format!("failed to serialize file contents: {error}"),
                })?
            }
            None => {
                let path = params
                    .get("contents_path")
                    .and_then(Value::as_str)
                    .ok_or(NodeError::MissingParameter { parameter: "contents" })?;
                let value = lookup_required(inputs, path)?;
                match value {
                    Value::String(text) => text.clone(),
                    other => {
                        serde_json::to_string_pretty(other).map_err(|error| NodeError::Message {
                            message: format!("failed to serialize input contents: {error}"),
                        })?
                    }
                }
            }
        };

        if params.get("append").and_then(Value::as_bool).unwrap_or(false) {
            use tokio::io::AsyncWriteExt;
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&resolved)
                .await
                .map_err(|error| NodeError::Message {
                    message: format!("failed to open file for appending: {error}"),
                })?;
            file.write_all(contents.as_bytes()).await.map_err(|error| NodeError::Message {
                message: format!("failed to append to file: {error}"),
            })?;
        } else {
            tokio::fs::write(&resolved, contents.as_bytes()).await.map_err(|error| {
                NodeError::Message { message: format!("failed to write file: {error}") }
            })?;
        }

        Ok(json!({ "path": path, "bytes_written": contents.len() }))
    }
}

fn build_headers(value: &Value) -> Result<HeaderMap, NodeError> {
    let object = as_object(value, "headers")?;
    let mut headers = HeaderMap::new();
    for (key, value) in object {
        let header_name =
            reqwest::header::HeaderName::from_bytes(key.as_bytes()).map_err(|error| {
                NodeError::InvalidParameter {
                    parameter: "headers".to_string(),
                    message: error.to_string(),
                }
            })?;
        let header_value = reqwest::header::HeaderValue::from_str(as_string(value, "headers")?)
            .map_err(|error| NodeError::InvalidParameter {
                parameter: "headers".to_string(),
                message: error.to_string(),
            })?;
        headers.insert(header_name, header_value);
    }
    Ok(headers)
}

fn flatten_query(value: &Value) -> Result<Vec<(String, String)>, NodeError> {
    let object = as_object(value, "query")?;
    let pairs = object
        .iter()
        .map(|(key, value)| {
            let rendered = match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            (key.clone(), rendered)
        })
        .collect();
    Ok(pairs)
}

fn resolve_connection_string(params: &Value) -> Result<String, NodeError> {
    if let Some(connection) = params.get("connection").and_then(Value::as_str) {
        return Ok(connection.to_string());
    }
    if let Some(env_name) = params.get("connection_env").and_then(Value::as_str) {
        return std::env::var(env_name).map_err(|_| NodeError::InvalidParameter {
            parameter: "connection_env".to_string(),
            message: format!("environment variable {env_name} is not set"),
        });
    }
    Err(NodeError::MissingParameter { parameter: "connection" })
}

fn stringify_headers(headers: &HeaderMap) -> Value {
    let mut object = Map::new();
    for (key, value) in headers {
        if let Ok(text) = value.to_str() {
            object.insert(key.to_string(), Value::String(text.to_string()));
        }
    }
    Value::Object(object)
}

async fn execute_sqlite_query(
    pool: &sqlx::SqlitePool,
    query: &str,
    args: &[Value],
) -> Result<Value, NodeError> {
    if is_read_query(query) {
        let rows = bind_sqlite_query(sqlx::query(query), args)?.fetch_all(pool).await.map_err(
            |error| NodeError::Message { message: format!("sqlite query failed: {error}") },
        )?;
        let rows = rows.iter().map(row_to_json_sqlite).collect::<Result<Vec<_>, _>>()?;
        Ok(json!({ "rows": rows }))
    } else {
        let result =
            bind_sqlite_query(sqlx::query(query), args)?.execute(pool).await.map_err(|error| {
                NodeError::Message { message: format!("sqlite query failed: {error}") }
            })?;
        Ok(json!({ "rows_affected": result.rows_affected() }))
    }
}

async fn execute_postgres_query(
    pool: &sqlx::PgPool,
    query: &str,
    args: &[Value],
) -> Result<Value, NodeError> {
    if is_read_query(query) {
        let rows =
            bind_pg_query(sqlx::query(query), args)?.fetch_all(pool).await.map_err(|error| {
                NodeError::Message { message: format!("postgres query failed: {error}") }
            })?;
        let rows = rows.iter().map(row_to_json_pg).collect::<Result<Vec<_>, _>>()?;
        Ok(json!({ "rows": rows }))
    } else {
        let result =
            bind_pg_query(sqlx::query(query), args)?.execute(pool).await.map_err(|error| {
                NodeError::Message { message: format!("postgres query failed: {error}") }
            })?;
        Ok(json!({ "rows_affected": result.rows_affected() }))
    }
}

fn is_read_query(query: &str) -> bool {
    let trimmed = query.trim_start().to_ascii_lowercase();
    trimmed.starts_with("select")
        || trimmed.starts_with("with")
        || trimmed.starts_with("explain")
        || trimmed.starts_with("show")
        || trimmed.starts_with("describe")
        || (trimmed.contains("returning") && (trimmed.starts_with("insert") || trimmed.starts_with("update") || trimmed.starts_with("delete")))
}

fn bind_sqlite_query<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    args: &'q [Value],
) -> Result<sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, NodeError> {
    for value in args {
        query = bind_value(query, value)?;
    }
    Ok(query)
}

fn bind_pg_query<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    args: &'q [Value],
) -> Result<sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>, NodeError> {
    for value in args {
        query = bind_value(query, value)?;
    }
    Ok(query)
}

fn bind_value<'q, DB>(
    query: sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>,
    value: &'q Value,
) -> Result<sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>, NodeError>
where
    DB: sqlx::Database,
    bool: sqlx::Encode<'q, DB> + Type<DB>,
    i64: sqlx::Encode<'q, DB> + Type<DB>,
    f64: sqlx::Encode<'q, DB> + Type<DB>,
    String: sqlx::Encode<'q, DB> + Type<DB>,
{
    let query = match value {
        Value::Bool(value) => query.bind(*value),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                query.bind(integer)
            } else if let Some(float) = number.as_f64() {
                query.bind(float)
            } else if let Some(unsigned) = number.as_u64() {
                query.bind(i64::try_from(unsigned).map_err(|_| NodeError::InvalidParameter {
                    parameter: "args".to_string(),
                    message: format!("numeric argument {unsigned} does not fit into i64"),
                })?)
            } else {
                return Err(NodeError::InvalidParameter {
                    parameter: "args".to_string(),
                    message: "unsupported numeric argument".to_string(),
                });
            }
        }
        Value::String(text) => query.bind(text.clone()),
        Value::Null => {
            return Err(NodeError::InvalidParameter {
                parameter: "args".to_string(),
                message:
                    "null query arguments are not supported in the current node implementation"
                        .to_string(),
            });
        }
        other => {
            return Err(NodeError::InvalidParameter {
                parameter: "args".to_string(),
                message: format!("unsupported query argument value {other}"),
            });
        }
    };

    Ok(query)
}

fn row_to_json_sqlite(row: &SqliteRow) -> Result<Value, NodeError> {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let value = if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
            value.map(Value::Bool).unwrap_or(Value::Null)
        } else if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
            value.map(Value::from).unwrap_or(Value::Null)
        } else if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
            value.and_then(serde_json::Number::from_f64).map(Value::Number).unwrap_or(Value::Null)
        } else if let Ok(value) = row.try_get::<Option<String>, _>(index) {
            value.map(Value::String).unwrap_or(Value::Null)
        } else {
            Value::String(format!("<unsupported:{}>", column.type_info().name()))
        };
        object.insert(column.name().to_string(), value);
    }
    Ok(Value::Object(object))
}

fn row_to_json_pg(row: &PgRow) -> Result<Value, NodeError> {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let value = if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
            value.map(Value::Bool).unwrap_or(Value::Null)
        } else if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
            value.map(Value::from).unwrap_or(Value::Null)
        } else if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
            value.and_then(serde_json::Number::from_f64).map(Value::Number).unwrap_or(Value::Null)
        } else if let Ok(value) = row.try_get::<Option<String>, _>(index) {
            value.map(Value::String).unwrap_or(Value::Null)
        } else {
            Value::String(format!("<unsupported:{}>", column.type_info().name()))
        };
        object.insert(column.name().to_string(), value);
    }

    Ok(Value::Object(object))
}

#[cfg(test)]
mod tests {
    use super::{DatabaseQueryNode, FileReadNode, FileWriteNode, HttpRequestNode};
    use crate::nodes::Node;
    use axum::{routing::get, Router};
    use serde_json::json;
    use std::{net::SocketAddr, path::PathBuf};

    #[tokio::test]
    async fn http_request_node_fetches_json() {
        let app =
            Router::new().route("/health", get(|| async { axum::Json(json!({ "ok": true })) }));
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("test listener should bind");
        let address: SocketAddr = listener.local_addr().expect("local address should be available");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("test server should run");
        });

        let node = HttpRequestNode::new(crate::nodes::RateLimiter::default());
        let output = node
            .execute(
                &json!({}),
                &json!({
                    "method": "GET",
                    "url": format!("http://{address}/health"),
                    "allow_insecure": true
                }),
            )
            .await
            .expect("http request should succeed");

        assert_eq!(output["body"]["ok"], json!(true));
    }

    #[tokio::test]
    async fn file_nodes_round_trip_within_data_directory() {
        let data_dir = temp_data_dir();
        let writer = FileWriteNode::new(data_dir.clone());
        let reader = FileReadNode::new(data_dir.clone());

        writer
            .execute(
                &json!({}),
                &json!({ "path": "notes/result.json", "contents": { "ok": true } }),
            )
            .await
            .expect("write should succeed");
        let output = reader
            .execute(&json!({}), &json!({ "path": "notes/result.json", "as_json": true }))
            .await
            .expect("read should succeed");

        assert_eq!(output["contents"]["ok"], json!(true));

        tokio::fs::remove_dir_all(data_dir).await.expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn sqlite_database_query_node_executes_parameterized_queries() {
        let data_dir = temp_data_dir();
        let node = DatabaseQueryNode::new(data_dir.clone());

        node.execute(
            &json!({}),
            &json!({
                "backend": "sqlite",
                "sqlite_path": "phase4-test.db",
                "query": "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"
            }),
        )
        .await
        .expect("table should be created");

        node.execute(
            &json!({}),
            &json!({
                "backend": "sqlite",
                "sqlite_path": "phase4-test.db",
                "query": "INSERT INTO items (name) VALUES (?)",
                "args": ["alpha"]
            }),
        )
        .await
        .expect("insert should succeed");

        let output = node
            .execute(
                &json!({}),
                &json!({
                    "backend": "sqlite",
                    "sqlite_path": "phase4-test.db",
                    "query": "SELECT name FROM items"
                }),
            )
            .await
            .expect("select should succeed");

        assert_eq!(output["rows"][0]["name"], json!("alpha"));

        tokio::fs::remove_dir_all(data_dir).await.expect("temp directory cleanup should succeed");
    }

    fn temp_data_dir() -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("acsa-integration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("temp data directory should be created");
        path
    }
}
