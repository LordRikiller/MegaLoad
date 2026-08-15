use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::Arc;

/// Custom resolver that forces IPv4 resolution.
/// gcdn.thunderstore.io's IPv6 endpoint resets TLS handshakes,
/// but IPv4 works fine. Force IPv4 for all connections.
struct Ipv4Resolver;

impl ureq::Resolver for Ipv4Resolver {
    fn resolve(&self, netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
        let addrs: Vec<SocketAddr> = netloc
            .to_socket_addrs()?
            .filter(|a| a.is_ipv4())
            .collect();
        if addrs.is_empty() {
            Err(std::io::Error::new(
                std::io::ErrorKind::AddrNotAvailable,
                format!("No IPv4 address found for {}", netloc),
            ))
        } else {
            Ok(addrs)
        }
    }
}

/// Build a ureq Agent using the OS native TLS stack (Windows Schannel)
/// with forced IPv4 resolution to avoid broken IPv6 on some CDNs.
///
/// Timeouts are mandatory: a request in flight when the laptop sleeps wakes
/// to a dead socket, and without a read timeout ureq blocks that thread
/// forever — which froze the whole app while commands ran on the main thread
/// (ticket 20260815-015213-7d805512). Read timeout is per-socket-read, so
/// large DLL downloads that keep receiving bytes are unaffected.
pub fn agent() -> ureq::Agent {
    let tls = native_tls::TlsConnector::new()
        .map_err(|e| format!("Failed to init native TLS: {}", e))
        .expect("TLS unavailable — cannot make HTTPS requests");
    ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .resolver(Ipv4Resolver)
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(60))
        .timeout_write(std::time::Duration::from_secs(30))
        .build()
}
