"""On-demand reachability checks for project links, protected against SSRF.

A check only proves that a URL answers; it never proves that an application works (the user records
that separately in the profile). Safety rules:
- only http/https on ports 80/443, no credentials in the URL;
- every address the host resolves to must be public (no loopback, private, link-local, multicast,
  reserved, or carrier-grade NAT ranges), and the connection is pinned to that validated address so a
  second DNS answer cannot redirect it (DNS rebinding);
- redirects are followed manually, at most MAX_REDIRECTS hops, and every hop is validated again;
- response bodies are never read; each request has a short timeout;
- the same URL is not requested again within RECENT_SECONDS, and callers cap URLs per request.
"""
from __future__ import annotations

import datetime as dt
import http.client
import ipaddress
import socket
import ssl
import threading
import time
import urllib.parse

STATUSES = {
    "reachable": "Reachable", "redirected": "Redirected", "auth_required": "Authentication required",
    "unreachable": "Unreachable", "could_not_verify": "Could not verify", "not_checked": "Not yet checked",
}
MAX_REDIRECTS = 4
TIMEOUT = 8
RECENT_SECONDS = 60
MAX_URLS_PER_REQUEST = 30
USER_AGENT = "ApplyDock-LinkCheck/1.0 (personal job-application helper; on-demand check)"
_RECENT: dict = {}
_LOCK = threading.Lock()


class LinkError(Exception):
    """The URL must not or cannot be requested; .status is the result status to report."""

    def __init__(self, status, detail):
        super().__init__(detail)
        self.status, self.detail = status, detail


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def parse_url(url: str):
    """(scheme, host, port, request_target) for an allowed URL, else LinkError."""
    try:
        parts = urllib.parse.urlsplit(str(url or "").strip())
        port = parts.port
    except ValueError:
        raise LinkError("could_not_verify", "This is not a valid link.") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise LinkError("could_not_verify", "Only http and https links can be checked.")
    if parts.username or parts.password:
        raise LinkError("could_not_verify", "Links containing a username or password are not checked.")
    default = 443 if parts.scheme == "https" else 80
    if port not in (None, default):
        raise LinkError("could_not_verify", "Links on non-standard ports are not checked.")
    target = (parts.path or "/") + (("?" + parts.query) if parts.query else "")
    return parts.scheme, parts.hostname.rstrip(".").lower(), default, target


def is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast and ip not in ipaddress.ip_network("100.64.0.0/10")


def resolve_public(host: str, port: int) -> str:
    """One validated public address for host; refuses hosts with any non-public address."""
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home.arpa")):
        raise LinkError("could_not_verify", "Local network addresses are never checked.")
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise LinkError("unreachable", "The domain does not resolve.") from None
    addresses = list(dict.fromkeys(info[4][0] for info in infos))
    if not addresses or not all(is_public_address(address) for address in addresses):
        raise LinkError("could_not_verify", "The link points to a private or local network address, so it was not checked.")
    return addresses[0]


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host, address, **kwargs):
        super().__init__(host, **kwargs)
        self._address = address

    def connect(self):
        self.sock = socket.create_connection((self._address, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, address, **kwargs):
        super().__init__(host, context=ssl.create_default_context(), **kwargs)
        self._address = address

    def connect(self):
        sock = socket.create_connection((self._address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _request(scheme, host, address, port, target, method):
    """Send one request to the pinned address and return (status, location); the body is never read."""
    connection_class = _PinnedHTTPSConnection if scheme == "https" else _PinnedHTTPConnection
    connection = connection_class(host, address, port=port, timeout=TIMEOUT)
    try:
        connection.request(method, target, headers={"User-Agent": USER_AGENT, "Accept": "*/*", "Connection": "close"})
        response = connection.getresponse()
        return response.status, response.getheader("Location", "")
    finally:
        connection.close()


def _classify(status: int):
    if 200 <= status < 300:
        return "reachable", "The link answered normally."
    if status in (401, 403):
        return "auth_required", "The link needs a sign-in or blocks automated checks; open it yourself to confirm."
    if status in (404, 410):
        return "unreachable", "The page was not found."
    if status == 429:
        return "could_not_verify", "The site rate-limited the check. Try again later."
    if status >= 500:
        return "unreachable", f"The server returned an error ({status})."
    return "could_not_verify", f"Unexpected response ({status})."


def check_url(url: str, resolver=resolve_public, requester=_request) -> dict:
    """Check one URL and return {url, status, http_status, final_url, detail, checked_at}."""
    url = str(url or "").strip()
    with _LOCK:
        recent = _RECENT.get(url)
        if recent and time.monotonic() - recent[0] < RECENT_SECONDS:
            return dict(recent[1])
    result = {"url": url, "status": "could_not_verify", "http_status": 0, "final_url": "", "detail": "", "checked_at": now_iso()}
    current, hops = url, 0
    try:
        while True:
            scheme, host, port, target = parse_url(current)
            address = resolver(host, port)
            try:
                status, location = requester(scheme, host, address, port, target, "HEAD")
                if status in (405, 501):
                    status, location = requester(scheme, host, address, port, target, "GET")
            except ssl.SSLError:
                raise LinkError("unreachable", "The site's security certificate is invalid.") from None
            except (socket.timeout, TimeoutError):
                raise LinkError("could_not_verify", "The site did not answer in time.") from None
            except (ConnectionError, OSError, http.client.HTTPException):
                raise LinkError("unreachable", "The connection to the site failed.") from None
            result["http_status"] = status
            if status in (301, 302, 303, 307, 308) and location:
                hops += 1
                if hops > MAX_REDIRECTS:
                    raise LinkError("could_not_verify", "The link redirects too many times.")
                current = urllib.parse.urljoin(current, location)
                continue
            result["status"], result["detail"] = _classify(status)
            if hops and result["status"] == "reachable":
                result["status"], result["detail"] = "redirected", "The link redirects to another address, which answered normally."
            result["final_url"] = current if hops else ""
            break
    except LinkError as error:
        result["status"], result["detail"] = error.status, error.detail
        result["final_url"] = current if hops else ""
    with _LOCK:
        _RECENT[url] = (time.monotonic(), dict(result))
    return result
