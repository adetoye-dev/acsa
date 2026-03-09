use extism_pdk::*;
use serde_json::{json, Value};

#[plugin_fn]
pub fn execute(input: String) -> FnResult<String> {
    let payload: Value = serde_json::from_str(&input)?;
    let echoed = payload
        .get("inputs")
        .and_then(|inputs| inputs.get("message"))
        .cloned()
        .unwrap_or(Value::String("missing".to_string()));

    Ok(json!({ "echoed": echoed }).to_string())
}
