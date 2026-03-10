use std::{env, process::Command};

fn main() {
    println!("cargo:rerun-if-env-changed=ACSA_BUILD_GIT_SHA");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");

    let git_sha = env::var("ACSA_BUILD_GIT_SHA")
        .ok()
        .or_else(|| env::var("GITHUB_SHA").ok())
        .or_else(read_git_sha)
        .unwrap_or_else(|| "unknown".to_string());

    let short_sha = git_sha.chars().take(7).collect::<String>();
    let target = env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());
    let profile = env::var("PROFILE").unwrap_or_else(|_| "unknown".to_string());

    println!("cargo:rustc-env=ACSA_BUILD_GIT_SHA={git_sha}");
    println!("cargo:rustc-env=ACSA_BUILD_GIT_SHA_SHORT={short_sha}");
    println!("cargo:rustc-env=ACSA_BUILD_TARGET={target}");
    println!("cargo:rustc-env=ACSA_BUILD_PROFILE={profile}");
}

fn read_git_sha() -> Option<String> {
    let output = Command::new("git").args(["rev-parse", "HEAD"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let sha = String::from_utf8(output.stdout).ok()?;
    let sha = sha.trim();
    if sha.is_empty() {
        None
    } else {
        Some(sha.to_string())
    }
}
