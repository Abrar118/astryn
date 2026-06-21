use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Returns true only for globally-routable unicast addresses. Everything else
/// — loopback, private, link-local, multicast, unspecified, CGNAT, broadcast,
/// documentation, v4-mapped/translated v6 — is treated as non-public so the
/// preview fetcher refuses to connect to it (SSRF defense).
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            // Unwrap v4-mapped (::ffff:a.b.c.d) so an attacker can't smuggle a
            // private v4 through a v6 literal. Note: to_ipv4_mapped() only handles
            // ::ffff:a.b.c.d; the v4-translated 64:ff9b:: range is outside global-unicast
            // 2000::/3 and is therefore rejected by the allowlist in is_public_v6.
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_v4(mapped);
            }
            is_public_v6(v6)
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()      // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
        || o[0] == 0                  // 0.0.0.0/8
        || (o[0] == 100 && (o[1] & 0xc0) == 64)  // 100.64.0.0/10 CGNAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24 IETF
        || (o[0] == 198 && (o[1] & 0xfe) == 18)  // 198.18.0.0/15 benchmarking
        || (o[0] & 0xf0) == 240) // 240.0.0.0/4 reserved
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let seg = ip.segments();
    // SSRF allowlist: only assigned global-unicast space (2000::/3) can be
    // public. Everything else — loopback, unspecified, multicast, link-local,
    // ULA (fc00::/7), deprecated site-local (fec0::/10), the discard prefix,
    // SRv6 (5f00::/16), NAT64 (64:ff9b::), and all currently unallocated
    // ranges (e.g. 4000::/3) — falls outside 2000::/3 and is rejected here.
    if (seg[0] & 0xe000) != 0x2000 {
        return false;
    }
    // Exclude special-use sub-ranges that live inside 2000::/3.
    !(
        // 2001::/23 IETF protocol assignments (Teredo etc.) and 2001:db8::/32 documentation
        (seg[0] == 0x2001 && ((seg[1] & 0xfe00) == 0 || seg[1] == 0x0db8))
            || seg[0] == 0x2002 // 2002::/16 6to4
            || (seg[0] == 0x3fff && (seg[1] & 0xf000) == 0)
        // 3fff::/20 documentation
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v4(s: &str) -> IpAddr {
        IpAddr::V4(s.parse::<Ipv4Addr>().unwrap())
    }
    fn v6(s: &str) -> IpAddr {
        IpAddr::V6(s.parse::<Ipv6Addr>().unwrap())
    }

    #[test]
    fn public_v4_is_allowed() {
        assert!(is_public_ip(v4("93.184.216.34"))); // example.com
        assert!(is_public_ip(v4("8.8.8.8")));
    }

    #[test]
    fn private_and_special_v4_blocked() {
        for s in [
            "127.0.0.1",       // loopback
            "10.0.0.1",        // private
            "172.16.0.1",      // private
            "192.168.1.1",     // private
            "169.254.0.1",     // link-local
            "0.0.0.0",         // unspecified
            "100.64.0.1",      // CGNAT (shared)
            "224.0.0.1",       // multicast
            "255.255.255.255", // broadcast
            "198.18.0.1",      // 198.18.0.0/15 benchmarking (RFC 2544)
            "198.19.255.1",    // 198.18.0.0/15 benchmarking (RFC 2544)
        ] {
            assert!(!is_public_ip(v4(s)), "{s} should be blocked");
        }
    }

    #[test]
    fn public_v6_is_allowed() {
        assert!(is_public_ip(v6("2606:2800:220:1:248:1893:25c8:1946")));
    }

    #[test]
    fn private_and_special_v6_blocked() {
        for s in [
            "::1",              // loopback
            "::",               // unspecified
            "fe80::1",          // link-local
            "fc00::1",          // unique-local
            "fd00::1",          // unique-local
            "ff02::1",          // multicast
            "::ffff:127.0.0.1", // v4-mapped loopback
            "::ffff:10.0.0.1",  // v4-mapped private
            "100::1",           // 0100::/64 discard-only (RFC 6666)
            "2001::1",          // 2001::/23 IETF protocol assignments (Teredo)
            "2002::1",          // 2002::/16 6to4 (RFC 3056)
            "3fff::1",          // 3fff::/20 documentation (RFC 9637)
            "5f00::1",          // 5f00::/16 SRv6 SIDs (RFC 9602)
            "fec0::1",          // deprecated site-local (fec0::/10, outside 2000::/3)
            "4000::1",          // unallocated (outside 2000::/3)
        ] {
            assert!(!is_public_ip(v6(s)), "{s} should be blocked");
        }
    }

    #[test]
    fn public_v6_protocol_assignment_neighbors_allowed() {
        // Regression: 2001::/23 mask (seg[1] & 0xfe00) == 0 must NOT over-block
        // real global unicast addresses like Google's 2001:4860:: (seg[1] == 0x4860,
        // which does not satisfy (0x4860 & 0xfe00) == 0).
        assert!(
            is_public_ip(v6("2001:4860:4860::8888")),
            "2001:4860:4860::8888 (Google DNS) should be allowed"
        );
    }
}
