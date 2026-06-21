use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Returns true only for globally-routable unicast addresses. Everything else
/// — loopback, private, link-local, multicast, unspecified, CGNAT, broadcast,
/// documentation, v4-mapped/translated v6 — is treated as non-public so the
/// preview fetcher refuses to connect to it (SSRF defense).
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            // Unwrap v4-mapped (::ffff:a.b.c.d) and v4-translated (64:ff9b::/96)
            // so an attacker can't smuggle a private v4 through a v6 literal.
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
        || (o[0] & 0xf0) == 240)      // 240.0.0.0/4 reserved
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let seg = ip.segments();
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (seg[0] & 0xfe00) == 0xfc00  // fc00::/7 unique-local
        || (seg[0] & 0xffc0) == 0xfe80  // fe80::/10 link-local
        || (seg[0] == 0x2001 && seg[1] == 0x0db8) // 2001:db8::/32 documentation
        || (seg[0] == 0x0064 && seg[1] == 0xff9b)) // 64:ff9b::/96 v4-translated
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
            "127.0.0.1",      // loopback
            "10.0.0.1",       // private
            "172.16.0.1",     // private
            "192.168.1.1",    // private
            "169.254.0.1",    // link-local
            "0.0.0.0",        // unspecified
            "100.64.0.1",     // CGNAT (shared)
            "224.0.0.1",      // multicast
            "255.255.255.255",// broadcast
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
            "::1",                 // loopback
            "::",                  // unspecified
            "fe80::1",             // link-local
            "fc00::1",             // unique-local
            "fd00::1",             // unique-local
            "ff02::1",             // multicast
            "::ffff:127.0.0.1",    // v4-mapped loopback
            "::ffff:10.0.0.1",     // v4-mapped private
        ] {
            assert!(!is_public_ip(v6(s)), "{s} should be blocked");
        }
    }
}
