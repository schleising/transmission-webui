#!/usr/bin/env python3
"""Print every torrent-get field every 2 seconds.

Reads the Transmission 4.1 JSON-RPC at TRANSMISSION_RPC, defaulting to the
test daemon. Set TRANSMISSION_USER and TRANSMISSION_PASS when the daemon
requires authentication. The password is sent as HTTP Basic and is not printed.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import cast

FIELDS = [
    "activity_date",
    "added_date",
    "availability",
    "bandwidth_priority",
    "bytes_completed",
    "comment",
    "corrupt_ever",
    "creator",
    "date_created",
    "desired_available",
    "done_date",
    "download_dir",
    "downloaded_ever",
    "download_limit",
    "download_limited",
    "edit_date",
    "error",
    "error_string",
    "eta",
    "eta_idle",
    "file_count",
    "files",
    "file_stats",
    "group",
    "hash_string",
    "have_unchecked",
    "have_valid",
    "honors_session_limits",
    "id",
    "is_finished",
    "is_private",
    "is_stalled",
    "labels",
    "left_until_done",
    "magnet_link",
    "manual_announce_time",
    "max_connected_peers",
    "metadata_percent_complete",
    "name",
    "peer_limit",
    "peers",
    "peers_connected",
    "peers_from",
    "peers_getting_from_us",
    "peers_sending_to_us",
    "percent_complete",
    "percent_done",
    "pieces",
    "piece_count",
    "piece_size",
    "priorities",
    "primary_mime_type",
    "queue_position",
    "rate_download",
    "rate_upload",
    "recheck_progress",
    "seconds_downloading",
    "seconds_seeding",
    "seed_idle_limit",
    "seed_idle_mode",
    "seed_ratio_limit",
    "seed_ratio_mode",
    "sequential_download",
    "sequential_download_from_piece",
    "size_when_done",
    "start_date",
    "status",
    "torrent_file",
    "total_size",
    "trackers",
    "tracker_list",
    "tracker_stats",
    "uploaded_ever",
    "upload_limit",
    "upload_limited",
    "upload_ratio",
    "wanted",
    "webseeds",
    "webseeds_sending_to_us",
]
STATUSES = {
    0: "Stopped",
    1: "Queued to verify",
    2: "Verifying",
    3: "Queued to download",
    4: "Downloading",
    5: "Queued to seed",
    6: "Seeding",
}


class RpcError(Exception):
    """The daemon rejected a call or did not answer."""


def as_object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, object] = {}
    for key in cast(list[object], list(value)):  # pyright: ignore[reportUnknownArgumentType]
        result[str(key)] = cast(object, value[key])
    return result


def as_list(value: object) -> list[object]:
    if not isinstance(value, list):
        return []
    return cast(list[object], value)


def as_text(value: object) -> str:
    if isinstance(value, str):
        return value
    return ""


def as_int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    return 0


def as_float(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def parse_json(text: str) -> object:
    return cast(object, json.loads(text))


def read_http(request: urllib.request.Request) -> str:
    with urllib.request.urlopen(request, timeout=15) as response:  # pyright: ignore[reportAny]
        chunk = response.read()  # pyright: ignore[reportAny]
    if isinstance(chunk, bytes):
        return chunk.decode()
    return ""


class Client:
    url: str
    user: str
    password: str
    session_id: str

    def __init__(self, url: str, user: str, password: str) -> None:
        self.url = url
        self.user = user
        self.password = password
        self.session_id = ""

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        body = json.dumps(
            {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
        ).encode()
        result = as_object(self._post(body, retry=True))
        if not result:
            raise RpcError("Transmission did not return a result object.")
        return result

    def _post(self, body: bytes, retry: bool) -> object:
        headers = {"Content-Type": "application/json"}
        if self.session_id:
            headers["X-Transmission-Session-Id"] = self.session_id
        if self.user:
            token = base64.b64encode(f"{self.user}:{self.password}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"
        request = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
        try:
            payload = parse_json(read_http(request))
        except urllib.error.HTTPError as error:
            if error.code == 409 and retry:
                session_id = error.headers.get("X-Transmission-Session-Id")
                if not session_id:
                    raise RpcError("Transmission did not return a session id.") from error
                self.session_id = session_id
                return self._post(body, retry=False)
            if error.code == 401:
                raise RpcError("Transmission did not accept the password.") from error
            raise RpcError(f"Transmission returned HTTP {error.code}.") from error
        except urllib.error.URLError as error:
            raise RpcError("Transmission did not respond.") from error
        message = as_object(payload).get("error")
        if message is not None:
            detail = as_object(message).get("message")
            text = detail if isinstance(detail, str) and detail else "Transmission rejected the request."
            raise RpcError(text)
        return as_object(payload).get("result")


def pieces_have(encoded: object, count: int) -> int:
    if count <= 0 or not isinstance(encoded, str) or not encoded:
        return 0
    raw = base64.b64decode(encoded)
    have = 0
    for index in range(count):
        byte = index >> 3
        if byte < len(raw) and raw[byte] & (128 >> (index & 7)):
            have += 1
    return have


def format_value(value: object) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def print_tick(torrents: list[object]) -> None:
    stamp = time.strftime("%H:%M:%S")
    if not torrents:
        print(f"{stamp}  no torrents", flush=True)
        return
    for item in torrents:
        torrent = as_object(item)
        count = as_int(torrent.get("piece_count"))
        have = pieces_have(torrent.get("pieces"), count)
        status = STATUSES.get(as_int(torrent.get("status")), "Unknown")
        name = as_text(torrent.get("name"))
        complete = as_float(torrent.get("percent_complete")) * 100
        done = as_float(torrent.get("percent_done")) * 100
        valid = as_int(torrent.get("have_valid"))
        unchecked = as_int(torrent.get("have_unchecked"))
        left = as_int(torrent.get("left_until_done"))
        ever = as_int(torrent.get("downloaded_ever"))
        summary = f"{stamp}  percent_complete {complete:.2f}%  percent_done {done:.2f}%  have_valid {valid:,}  have_unchecked {unchecked:,}  left_until_done {left:,}  downloaded_ever {ever:,}  {have:,} of {count:,} pieces  {status}  {name}"
        print(summary, flush=True)
        shown: set[str] = set()
        for field in FIELDS:
            shown.add(field)
            if field not in torrent:
                print(f"  {field}: (not returned)", flush=True)
                continue
            print(f"  {field}: {format_value(torrent[field])}", flush=True)
        for field in sorted(torrent):
            if field not in shown:
                print(f"  {field}: {format_value(torrent[field])}", flush=True)
        print(flush=True)


def main() -> int:
    url = os.environ.get("TRANSMISSION_RPC", "http://127.0.0.1:9091/transmission/rpc")
    user = os.environ.get("TRANSMISSION_USER", "test-user")
    password = os.environ.get("TRANSMISSION_PASS", "test-password")
    client = Client(url, user, password)
    while True:
        try:
            result = client.call("torrent_get", {"fields": FIELDS})
            print_tick(as_list(result.get("torrents")))
        except RpcError as error:
            print(f"{time.strftime('%H:%M:%S')}  {error}", file=sys.stderr, flush=True)
        except KeyboardInterrupt:
            return 0
        try:
            time.sleep(2)
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    sys.exit(main())
