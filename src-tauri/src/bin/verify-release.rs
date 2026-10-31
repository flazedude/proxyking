//! Public-key-only verifier for LAN mirror setup. Never reads the private signing key.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{fs, path::Path};

fn verify(
    config: &Path,
    signature: &Path,
    installer: &Path,
    version: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let config: serde_json::Value = serde_json::from_slice(&fs::read(config)?)?;
    let key = STANDARD.decode(
        config["plugins"]["updater"]["pubkey"]
            .as_str()
            .ok_or("Missing updater public key")?,
    )?;
    let key = PublicKey::decode(std::str::from_utf8(&key)?)?;
    let signature = STANDARD.decode(fs::read_to_string(signature)?.trim())?;
    let signature = Signature::decode(std::str::from_utf8(&signature)?)?;
    let bytes = fs::read(installer)?;
    key.verify(&bytes, &signature, false)?;
    let signed = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"));
    if signed != Some(version) {
        return Err("Signed version does not match the requested release".into());
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!("Usage: verify-release CONFIG SIGNATURE INSTALLER VERSION");
        std::process::exit(2);
    }
    if verify(
        Path::new(&args[1]),
        Path::new(&args[2]),
        Path::new(&args[3]),
        &args[4],
    )
    .is_err()
    {
        eprintln!("Installer signature or signed version verification failed.");
        std::process::exit(1);
    }
    println!("Installer signature and signed version verified.");
}
