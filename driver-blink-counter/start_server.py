"""
start_server.py - Lightweight local web server for DriverBlink
Runs DriverBlink locally with offline PWA support and network access.
"""

import http.server
import socket
import socketserver
import webbrowser
import os
import sys

# Ensure UTF-8 output on Windows consoles
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

def main():
    local_ip = get_local_ip()
    local_url = f"http://localhost:{PORT}"
    network_url = f"http://{local_ip}:{PORT}"

    print("=" * 65)
    print(" [*] DriverBlink - Eye Blink & Fatigue Monitor")
    print("=" * 65)
    print(f"\n[+] Local PC Browser:   {local_url}")
    print(f"[+] Mobile Phone URL:    {network_url}")
    print("\n[+] HOW TO USE ON YOUR MOBILE PHONE (CAR MOUNT):")
    print(f" 1. Connect your phone to the same Wi-Fi network as this PC.")
    print(f" 2. Open Chrome (Android) or Safari (iPhone) and go to:")
    print(f"    {network_url}")
    print(" 3. Tap the browser menu (3 dots) and select 'Add to Home screen'")
    print("    or 'Install App'.")
    print(" 4. Once installed, it works 100% OFFLINE without any internet!")
    print("\n[+] TIP FOR ANDROID USB / DEVELOPER MODE:")
    print(f"    Run: adb reverse tcp:{PORT} tcp:{PORT}")
    print(f"    Then open 'http://localhost:{PORT}' directly on your phone!")
    print("=" * 65)

    try:
        webbrowser.open(local_url)
    except Exception:
        pass

    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"\nServing on port {PORT}... Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()

if __name__ == '__main__':
    main()
