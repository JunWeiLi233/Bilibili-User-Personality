"""
Extract Bilibili cookies (SESSDATA, bili_jct, DedeUserID) from Chrome's
cookie database on Windows. Outputs the BILIBILI_COOKIE env var line ready
for set-deepseek-env.ps1.

Usage:
    python extract_bilibili_cookie.py              # auto-detect Chrome profile
    python extract_bilibili_cookie.py --profile "Profile 1"  # specific profile
    python extract_bilibili_cookie.py --browser Edge    # Edge instead of Chrome
    python extract_bilibili_cookie.py --list-profiles    # list available profiles

Requirements:
    - Python 3.7+ with built-in sqlite3 and ctypes (no extra packages needed)
    - Chrome/Edge must have logged into bilibili.com at least once
    - Chrome must be CLOSED for cookie DB access (otherwise use export-cookie.html)
"""

import os
import sys
import json
import shutil
import sqlite3
import tempfile
import argparse
import ctypes
import ctypes.wintypes
from pathlib import Path

# ---- DPAPI helpers (no pywin32 needed) ----

class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _crypt_unprotect_data(encrypted: bytes) -> bytes:
    """Decrypt DPAPI-encrypted blob via Windows crypt32.dll."""
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    blob_in = DATA_BLOB()
    blob_in.cbData = len(encrypted)
    blob_in.pbData = ctypes.cast(
        ctypes.create_string_buffer(encrypted, len(encrypted)),
        ctypes.POINTER(ctypes.c_char),
    )

    blob_out = DATA_BLOB()

    if not crypt32.CryptUnprotectData(
        ctypes.byref(blob_in),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(blob_out),
    ):
        err = kernel32.GetLastError()
        raise OSError(f"CryptUnprotectData failed with error {err}")

    result = ctypes.string_at(blob_out.pbData, blob_out.cbData)
    kernel32.LocalFree(blob_out.pbData)
    return result


# ---- Chrome cookie database access ----

TARGET_COOKIES = {"SESSDATA", "bili_jct", "DedeUserID"}


def _chrome_cookie_paths(profile_dir: str = "Default", browser: str = "Chrome"):
    """Return the filesystem path to Chrome's cookie database."""
    localappdata = os.environ.get("LOCALAPPDATA", "")
    base = Path(localappdata) / "Google" / browser / "User Data" / profile_dir
    cookie_db = base / "Network" / "Cookies"
    return cookie_db


def _read_cookies(cookie_db: Path) -> dict[str, str]:
    """Read SESSDATA, bili_jct, DedeUserID from Chrome cookie database."""
    found: dict[str, str] = {}

    if not cookie_db.exists():
        print(f"Cookie database not found at: {cookie_db}", file=sys.stderr)
        return found

    # Copy the DB since Chrome locks it while running.
    # This works on NTFS as long as Chrome hasn't opened the file exclusively.
    tmp_path = None
    try:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
        os.close(tmp_fd)
        shutil.copy2(str(cookie_db), tmp_path)
    except PermissionError as exc:
        print(f"Cannot access Chrome cookie DB (Chrome may be running): {exc}", file=sys.stderr)
        print("", file=sys.stderr)
        print("Options:", file=sys.stderr)
        print("  1. Close Chrome and try again", file=sys.stderr)
        print("  2. Use the browser-based helper instead:", file=sys.stderr)
        print("     Open public/export-cookie.html in Chrome, follow instructions", file=sys.stderr)
        print("  3. Or manually from Chrome DevTools:", file=sys.stderr)
        print("     F12 > Application > Cookies > bilibili.com", file=sys.stderr)
        print("     Copy SESSDATA, bili_jct, DedeUserID values", file=sys.stderr)
        return found
    except Exception as exc:
        print(f"Error reading cookie DB: {exc}", file=sys.stderr)
        return found

    try:
        conn = sqlite3.connect(tmp_path)
        cursor = conn.execute(
            "SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE '%bilibili%'"
        )
        rows = cursor.fetchall()
        if not rows:
            print("No bilibili.com cookies found in this Chrome profile.", file=sys.stderr)
            print("Make sure you have logged into bilibili.com in Chrome.", file=sys.stderr)
            conn.close()
            return found

        for host, name, enc_val in rows:
            if name not in TARGET_COOKIES:
                continue
            try:
                # Try DPAPI decryption
                value = _crypt_unprotect_data(enc_val)
                if value:
                    decoded = value.decode("utf-8", errors="replace").strip("\x00")
                    if decoded:
                        found[name] = decoded
            except Exception:
                try:
                    # Some values may be stored in plaintext
                    decoded = enc_val.decode("utf-8", errors="replace").strip("\x00")
                    if decoded and all(32 <= ord(c) < 127 for c in decoded[:min(len(decoded), 20)]):
                        found[name] = decoded
                except Exception:
                    continue
        conn.close()
    except Exception as exc:
        print(f"Error querying cookie DB: {exc}", file=sys.stderr)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return found


def _format_env_line(cookies: dict[str, str]) -> str:
    """Format the BILIBILI_COOKIE env var assignment for PowerShell."""
    parts = []
    for name in ("SESSDATA", "bili_jct", "DedeUserID"):
        if name in cookies and cookies[name]:
            parts.append(f"{name}={cookies[name]}")
    if not parts:
        return ""
    return '$env:BILIBILI_COOKIE = "' + "; ".join(parts) + '"'


def main():
    parser = argparse.ArgumentParser(description="Extract Bilibili cookies from Chrome")
    parser.add_argument(
        "--profile", default="Default",
        help='Chrome profile directory name (default: "Default")',
    )
    parser.add_argument(
        "--browser", default="Chrome",
        help='Browser name under Google/ directory (default: "Chrome", try "Edge")',
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Output as JSON instead of PowerShell env line",
    )
    parser.add_argument(
        "--list-profiles", action="store_true",
        help="List available Chrome profile directories and exit",
    )
    args = parser.parse_args()

    if args.list_profiles:
        localappdata = os.environ.get("LOCALAPPDATA", "")
        base = Path(localappdata) / "Google" / args.browser / "User Data"
        if base.exists():
            for d in sorted(base.iterdir()):
                if d.is_dir() and (d / "Network" / "Cookies").exists():
                    print(f"  {d.name}")
        else:
            print(f"  No Chrome data found at {base}")
        return

    cookie_db = _chrome_cookie_paths(args.profile, args.browser)
    cookies = _read_cookies(cookie_db)

    if not cookies:
        if cookie_db.exists():
            print("", file=sys.stderr)
            print(f"Tried: {cookie_db}", file=sys.stderr)
        sys.exit(1)

    missing = TARGET_COOKIES - set(cookies.keys())
    if missing:
        print(f"Warning: Could not find: {', '.join(sorted(missing))}", file=sys.stderr)
        print("", file=sys.stderr)

    if args.json:
        print(json.dumps(cookies, ensure_ascii=False, indent=2))
    else:
        line = _format_env_line(cookies)
        print(line)
        print("")
        print("# Found cookies:", ", ".join(cookies.keys()))
        if missing:
            print("# Missing cookies:", ", ".join(sorted(missing)))
            print("# You may still be able to use the found cookies for basic API access.")


if __name__ == "__main__":
    main()
