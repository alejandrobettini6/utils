#!/usr/bin/env python3
"""Sirve el sitio y resuelve el video de una historia pública de Instagram."""

import base64
import json
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765
MAX_BYTES = 80 * 1024 * 1024
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
SAVEINSTA = "https://saveinsta.to"
MEDIA = {}
MEDIA_LOCK = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/historia":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 4000:
            self.respond(400, {"error": "empty"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.respond(400, {"error": "empty"})
            return
        try:
            result = resolve_story(str(body.get("url") or ""))
        except Exception:
            result = {"error": "network"}
        self.respond(200 if result.get("url") else 404, result)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        prefix = "/api/medio/"
        if path.startswith(prefix):
            self.stream_media(path[len(prefix):])
            return
        super().do_GET()

    def stream_media(self, token):
        now = time.time()
        with MEDIA_LOCK:
            item = MEDIA.get(token)
            if item and item["expires"] < now:
                MEDIA.pop(token, None)
                item = None
        if not item:
            self.respond(404, {"error": "empty"})
            return
        request = urllib.request.Request(item["url"], headers={"User-Agent": UA})
        try:
            upstream = urllib.request.urlopen(request, timeout=60)
        except Exception:
            self.respond(404, {"error": "read"})
            return
        try:
            length = int(upstream.headers.get("Content-Length") or 0)
            kind = (upstream.headers.get("Content-Type") or "").lower()
            if "text/html" in kind or "json" in kind:
                self.respond(404, {"error": "read"})
                return
            if length > MAX_BYTES:
                self.respond(404, {"error": "heavy"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            if length:
                self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            sent = 0
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                sent += len(chunk)
                if sent > MAX_BYTES:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            upstream.close()

    def respond(self, code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def resolve_story(raw):
    story = story_target(raw)
    if not story:
        return {"error": "empty"}
    html = search_story(story["query"])
    picked = pick_video(html, story["media_id"])
    if picked == "photo":
        return {"error": "photo"}
    if not picked:
        return {"error": "empty"}
    name = file_name(story["username"], story["media_id"] or picked.get("asset_id"))
    result = {"url": remember_media(picked["url"], name), "filename": name}
    if picked.get("extra", 1) > 1:
        result["extra"] = picked["extra"]
    return result


def story_target(raw):
    text = raw.strip()
    if not re.match(r"https?://", text, re.I):
        text = "https://" + text
    try:
        url = urllib.parse.urlparse(text)
    except ValueError:
        return None
    host = (url.hostname or "").lower().removeprefix("www.")
    if host not in {"instagram.com", "m.instagram.com"}:
        return None
    parts = [part for part in url.path.split("/") if part]
    if len(parts) >= 2 and parts[0] == "stories":
        username = parts[1]
        if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", username):
            return None
        media_id = parts[2] if len(parts) >= 3 else ""
        if media_id and not re.fullmatch(r"\d{5,25}", media_id):
            return None
        return {
            "query": f"https://www.instagram.com/stories/{username}/",
            "username": username,
            "media_id": media_id,
        }
    if parts[:1] == ["s"] and re.fullmatch(r"[A-Za-z0-9_-]{5,}", parts[1] if len(parts) > 1 else ""):
        media_id = urllib.parse.parse_qs(url.query).get("story_media_id", [""])[0]
        if media_id and not re.fullmatch(r"\d{5,25}", media_id):
            media_id = ""
        return {
            "query": f"https://www.instagram.com/s/{parts[1]}",
            "username": "historia",
            "media_id": media_id,
        }
    return None


def search_story(query):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    page = request(opener, f"{SAVEINSTA}/en1").decode("utf-8", "replace")
    token = json.loads(request(opener, f"{SAVEINSTA}/api/userverify", {"url": query}))["token"]
    payload = json.loads(request(opener, f"{SAVEINSTA}/api/ajaxSearch", {
        "k_exp": field(page, "k_exp"),
        "k_token": field(page, "k_token"),
        "q": query,
        "t": "media",
        "lang": "en",
        "v": "v2",
        "cftoken": token,
    }))
    data = payload.get("data")
    return data if isinstance(data, str) else ""


def request(opener, url, form=None):
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Origin": SAVEINSTA,
        "Referer": f"{SAVEINSTA}/en1",
        "X-Requested-With": "XMLHttpRequest",
    }
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    with opener.open(req, timeout=30) as response:
        return response.read()


def field(page, name):
    match = re.search(rf'{name}\s*=\s*"([^"]*)"', page)
    if not match:
        raise ValueError(name)
    return match.group(1)


def pick_video(html, media_id):
    videos = []
    photo_ids = set()
    for match in re.finditer(r"<a\b([^>]*)>", html, re.I):
        attrs = match.group(1)
        element_id = attr(attrs, "id")
        photo = re.fullmatch(r"photo_dl_(\d+)_\d+", element_id or "")
        if photo:
            photo_ids.add(photo.group(1))
            continue
        if attr(attrs, "title") != "Download Video":
            continue
        media = media_from_token(attr(attrs, "href"))
        if media:
            videos.append(media)
    if media_id and media_id in photo_ids and not any(media_id == item["asset_id"] for item in videos):
        return "photo"
    if media_id:
        for item in videos:
            if media_id == item["asset_id"]:
                item["extra"] = 1
                return item
    if not videos:
        return None
    chosen = videos[0]
    chosen["extra"] = len(videos)
    return chosen


def attr(source, name):
    match = re.search(rf'\b{name}="([^"]*)"', source)
    return html_unescape(match.group(1)) if match else ""


def html_unescape(value):
    return value.replace("&amp;", "&").replace("&quot;", '"')


def media_from_token(href):
    if not href:
        return None
    query = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
    token = (query.get("token") or [""])[0]
    if token.count(".") < 2:
        return None
    try:
        payload = json.loads(b64url(token.split(".")[1]))
    except (json.JSONDecodeError, ValueError):
        return None
    media_url = payload.get("url") or ""
    host = (urllib.parse.urlparse(media_url).hostname or "").lower()
    if not host.endswith(".fbcdn.net") and not host.endswith(".cdninstagram.com"):
        return None
    if "/o1/v/" not in urllib.parse.urlparse(media_url).path and not media_url.lower().split("?", 1)[0].endswith(".mp4"):
        return None
    return {"url": media_url, "asset_id": asset_id(media_url)}


def asset_id(media_url):
    efg = (urllib.parse.parse_qs(urllib.parse.urlparse(media_url).query).get("efg") or [""])[0]
    if not efg:
        return ""
    try:
        data = json.loads(base64.b64decode(efg + "=" * (-len(efg) % 4)))
    except (json.JSONDecodeError, ValueError):
        return ""
    value = data.get("xpv_asset_id")
    return str(value) if value else ""


def b64url(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def remember_media(remote_url, filename):
    now = time.time()
    token = secrets.token_urlsafe(18)
    with MEDIA_LOCK:
        stale = [key for key, item in MEDIA.items() if item["expires"] < now]
        for key in stale:
            del MEDIA[key]
        MEDIA[token] = {"url": remote_url, "filename": filename, "expires": now + 600}
    return f"/api/medio/{token}"


def file_name(username, media_id):
    safe_user = re.sub(r"[^A-Za-z0-9._]", "", username) or "historia"
    suffix = media_id or "video"
    return f"instagram_{safe_user}_{suffix}.mp4"


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"utiles en http://127.0.0.1:{PORT}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
