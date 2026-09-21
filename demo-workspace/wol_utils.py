"""Wake-on-LAN helpers (company PC → home GPU host)."""
from __future__ import annotations

import re
import socket

MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")


def normalize_mac(mac: str) -> str:
    raw = re.sub(r"[^0-9A-Fa-f]", "", mac or "")
    if len(raw) != 12:
        raise ValueError("MAC 位址格式錯誤（需 6 組十六進位，例如 AA:BB:CC:DD:EE:FF）")
    return ":".join(raw[i : i + 2] for i in range(0, 12, 2)).upper()


def build_magic_packet(mac: str) -> bytes:
    mac_norm = normalize_mac(mac)
    mac_bytes = bytes.fromhex(mac_norm.replace(":", ""))
    return b"\xff" * 6 + mac_bytes * 16


def send_magic_packet(
    mac: str,
    *,
    broadcast: str = "255.255.255.255",
    port: int = 9,
) -> None:
    """Send WoL UDP datagram. ``broadcast`` may be directed broadcast (e.g. 192.168.1.255) or a Tailscale peer IP."""
    if port < 1 or port > 65535:
        raise ValueError("WoL port 須為 1～65535")
    host = (broadcast or "255.255.255.255").strip()
    packet = build_magic_packet(mac)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, (host, port))
    finally:
        sock.close()
