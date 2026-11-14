"""Peluncur lokal BagiNota: hanya menyajikan aset aplikasi pada loopback."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from urllib.parse import urlsplit
import webbrowser

WEB = Path(__file__).resolve().parent / "web"
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
    "/model.mjs": ("model.mjs", "text/javascript; charset=utf-8"),
    "/storage.mjs": ("storage.mjs", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve_asset(True)

    def do_HEAD(self):
        self.serve_asset(False)

    def serve_asset(self, body: bool):
        try:
            path = urlsplit(self.path).path
        except ValueError:
            self.send_error(400, "Alamat tidak valid")
            return
        asset = ASSETS.get(path)
        if asset is None:
            self.send_error(404, "Berkas tidak tersedia")
            return
        try:
            data = (WEB / asset[0]).read_bytes()
        except OSError:
            self.send_error(500, "Aset aplikasi tidak lengkap")
            return
        self.send_response(200)
        self.send_header("Content-Type", asset[1])
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers()
        if body:
            self.wfile.write(data)

    def log_message(self, format, *args):
        # Tidak merekam judul, anggota, atau isi pengeluaran.
        return


def main() -> int:
    parser = argparse.ArgumentParser(description="Buka aplikasi BagiNota di browser.")
    parser.add_argument("--port", type=int, default=8731)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Port harus antara 1024 dan 65535.")
    missing = sorted({name for name, _ in ASSETS.values() if not (WEB / name).is_file()})
    if missing:
        print("Aset aplikasi tidak lengkap: " + ", ".join(missing), file=sys.stderr)
        return 1
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError:
        print(f"Port {args.port} tidak tersedia. Tutup BagiNota yang masih berjalan atau pilih --port lain (penyimpanan browser terpisah per port).", file=sys.stderr)
        return 1
    address = f"http://127.0.0.1:{args.port}"
    print(f"BagiNota siap: {address}\nBiarkan jendela ini terbuka. Tekan Ctrl+C untuk berhenti.", flush=True)
    if not args.no_browser:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
