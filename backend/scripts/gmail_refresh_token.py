"""One-off: mint the refresh token that MAIL_PROVIDER=gmail needs. Standard library only.

Google Cloud Console, once:
  1. Create or pick a project, then enable the "Gmail API".
  2. OAuth consent screen -> External -> add your own Gmail address under Test users.
  3. Credentials -> Create credentials -> OAuth client ID -> Desktop app.

Then, locally (not on the Space):
  python scripts/gmail_refresh_token.py <client_id> <client_secret>

It opens a consent screen, catches the redirect on localhost, and prints the refresh
token. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN from the result,
plus SMTP_FROM to the Gmail address you just authorised.
"""
import http.server
import json
import sys
import urllib.parse
import urllib.request
import webbrowser

CLIENT_ID, CLIENT_SECRET = sys.argv[1], sys.argv[2]
PORT = 8765
REDIRECT = f"http://localhost:{PORT}"
# gmail.send only: this token can send mail and do nothing else.
SCOPE = "https://www.googleapis.com/auth/gmail.send"

consent = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT,
    "response_type": "code",
    "scope": SCOPE,
    "access_type": "offline",  # without this Google returns no refresh token
    "prompt": "consent",       # force one even if the app was authorised before
})
print("Approve access in the browser window:\n ", consent)
webbrowser.open(consent)

received: dict[str, list[str]] = {}


class _Catch(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        received.update(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Authorised. You can close this tab.")

    def log_message(self, *_args) -> None:
        pass


http.server.HTTPServer(("localhost", PORT), _Catch).handle_request()

if "code" not in received:
    sys.exit(f"No authorization code returned: {received}")

body = urllib.parse.urlencode({
    "code": received["code"][0],
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "redirect_uri": REDIRECT,
    "grant_type": "authorization_code",
}).encode()
with urllib.request.urlopen("https://oauth2.googleapis.com/token", body) as res:
    payload = json.load(res)

token = payload.get("refresh_token")
print("\nGMAIL_REFRESH_TOKEN =", token if token else f"(missing) full response: {payload}")
