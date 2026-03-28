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

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use thiserror::Error;

pub const APP_DATA_DIR_ENV: &str = "ACSA_APP_DATA_DIR";

#[derive(Debug, Clone)]
pub struct AssetStore {
    root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredConnectorBundle {
    pub connector_dir: PathBuf,
    pub manifest_path: PathBuf,
}

#[derive(Debug, Error)]
pub enum AssetStoreError {
    #[error("asset store path could not be determined: {message}")]
    PathResolution { message: String },
    #[error("asset store io error: {0}")]
    Io(#[from] std::io::Error),
}

impl AssetStore {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, AssetStoreError> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(root.join("connectors"))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn connectors_dir(&self) -> PathBuf {
        self.root.join("connectors")
    }

    pub fn store_connector_bundle(
        &self,
        dir_name: &str,
        source_dir: &Path,
    ) -> Result<StoredConnectorBundle, AssetStoreError> {
        let connector_dir = self.connectors_dir().join(dir_name);
        if connector_dir.exists() {
            fs::remove_dir_all(&connector_dir)?;
        }
        copy_dir_all(source_dir, &connector_dir)?;
        Ok(StoredConnectorBundle {
            manifest_path: connector_dir.join("manifest.json"),
            connector_dir,
        })
    }
}

pub fn default_root_for_database(_database_path: &Path) -> Result<PathBuf, AssetStoreError> {
    if let Ok(root) = env::var(APP_DATA_DIR_ENV) {
        return Ok(PathBuf::from(root).join("acsa"));
    }

    #[cfg(test)]
    {
        let parent = _database_path.parent().ok_or_else(|| AssetStoreError::PathResolution {
            message: format!("database path {} has no parent", _database_path.display()),
        })?;
        Ok(parent.join(".acsa-app"))
    }

    #[cfg(not(test))]
    {
        if let Ok(xdg_data_home) = env::var("XDG_DATA_HOME") {
            return Ok(PathBuf::from(xdg_data_home).join("acsa"));
        }

        if let Ok(home) = env::var("HOME") {
            return Ok(PathBuf::from(home).join(".acsa"));
        }

        #[cfg(windows)]
        {
            if let Ok(app_data) = env::var("APPDATA") {
                return Ok(PathBuf::from(app_data).join("acsa"));
            }
        }

        Err(AssetStoreError::PathResolution {
            message: format!(
                "set {APP_DATA_DIR_ENV} or provide HOME/XDG_DATA_HOME so Acsa can create an asset store"
            ),
        })
    }
}

fn copy_dir_all(source_dir: &Path, target_dir: &Path) -> Result<(), AssetStoreError> {
    fs::create_dir_all(target_dir)?;
    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let entry_path = entry.path();
        let target_path = target_dir.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry_path, &target_path)?;
        } else {
            fs::copy(&entry_path, &target_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AssetStore, StoredConnectorBundle};

    #[test]
    fn asset_store_writes_connector_bundle_contents() {
        let temp_dir =
            std::env::temp_dir().join(format!("acsa-asset-store-{}", uuid::Uuid::new_v4()));
        let source_dir = temp_dir.join("source");
        std::fs::create_dir_all(&source_dir).expect("source dir should exist");
        std::fs::write(source_dir.join("manifest.json"), "{\"type\":\"demo\"}")
            .expect("manifest should write");
        std::fs::write(source_dir.join("main.py"), "print('ok')").expect("main should write");

        let store = AssetStore::new(temp_dir.join("app")).expect("asset store should create");
        let StoredConnectorBundle { connector_dir, manifest_path } =
            store.store_connector_bundle("demo-pack", &source_dir).expect("bundle should store");

        assert!(connector_dir.ends_with("demo-pack"));
        assert!(manifest_path.exists());
        assert!(connector_dir.join("main.py").exists());

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }
}
