import re
import ipaddress
from urllib.parse import urlparse

def is_allowed_domain(url: str, allowed_domains: list[str]) -> bool:
    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return False
        domain = parsed.netloc.lower()
        return any(domain == d.lower() or domain.endswith("." + d.lower()) for d in allowed_domains)
    except Exception:
        return False

def is_ssrf_safe(url: str) -> bool:
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        
        # Check against local / private IPs
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
                return False
        except ValueError:
            pass # Not an IP address
            
        # Basic DNS rebinding mitigation placeholder:
        # In a strict setup, we would resolve the DNS and check the IP again here.
        # But this basic check avoids direct SSRF with raw IPs.
        if hostname in ("localhost", "0.0.0.0", "::1"):
            return False
            
        return True
    except Exception:
        return False

def sanitize_string(s: str) -> str:
    if not isinstance(s, str):
        return ""
    # Strip HTML tags
    clean = re.sub(r'<[^>]*>', '', s)
    # Limit length
    clean = clean[:1000]
    # Simple escape (though Pydantic / framework handles JSON escaping)
    return clean.strip()

def validate_image_url(url: str) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        if parsed.scheme.lower() != "https":
            return None
        return url
    except Exception:
        return None
