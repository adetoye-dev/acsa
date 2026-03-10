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

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const GIT_SHA: &str = env!("ACSA_BUILD_GIT_SHA");
pub const GIT_SHA_SHORT: &str = env!("ACSA_BUILD_GIT_SHA_SHORT");
pub const TARGET: &str = env!("ACSA_BUILD_TARGET");
pub const PROFILE: &str = env!("ACSA_BUILD_PROFILE");

pub fn release_string() -> String {
    format!("acsa-core {VERSION} ({GIT_SHA_SHORT}, {TARGET}, {PROFILE})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_string_contains_version() {
        let value = release_string();
        assert!(value.contains(VERSION));
        assert!(value.contains(GIT_SHA_SHORT));
        assert!(value.contains(TARGET));
    }
}
