# OpenCare Kiosk (iPhone test app)

A local-only iPhone app that runs the OpenCare kiosk and reads CareCards over NFC inside the app.

## Why it exists

The demo kiosk is an iPhone. iOS browsers (Safari, Chrome) have no Web NFC, so today the phone
only reads a CareCard in the background and shows a banner that jumps to Safari. This app wraps
the kiosk site in a `WKWebView` and reads the card with Core NFC, so a tap stays in the kiosk.

It is a test app: installed from Xcode over a cable, no App Store or TestFlight. The iPad has no
NFC, so it isn't a target.

## How it works

```
CareCard (NDEF URI https://abdulcare.vercel.app/t/<token>)
   │  Core NFC (NFCNDEFReaderSession)
   ▼
OpenCareKiosk app ──► token ──► WKWebView (kiosk site)
                                  │  tap(token) → POST /api/tap  (device + session cookies)
                                  ▼
                       /kiosk/charge/card (charge waiting) or /kiosk/check
```

- **WebView.** Loads `<server>/kiosk`. The server defaults to `https://abdulcare.vercel.app` and is
  changed in the app's settings (for example your Mac's `http://192.168.1.20:3000`). It uses the
  default persistent website data store, so the kiosk's pairing and session cookies survive
  relaunches. The user agent ends with `OpenCareKiosk/1`.
- **Looks exactly like the web kiosk.** The WebView is full-bleed with no native chrome: no
  bars, no buttons over the page. The pages' own `viewport-fit` and `env(safe-area-inset-*)`
  rules place content, and the background is the page color (`#f4f5fb`), so there's no flash.
  Link previews, the long-press callout and text selection outside form fields are off. Nothing
  is restyled natively. The only native UI is Apple's NFC "Ready to Scan" sheet and the hidden
  settings screen.
- **Settings** open with a **two-finger long press (about 1.5 s) anywhere** on the kiosk. They
  are never visible otherwise.
- **Reading a card.** Two ways start a scan, and both use the same reader:
  1. **Tap the kiosk's own "Tap here" disc** on `/kiosk` or `/kiosk/charge`. An injected
     listener (the page itself isn't changed) opens the NFC sheet. After a read, the app opens
     `<server>/t/<token>` in the WebView, the same page the card's own link opens: it calls
     `tap(token)` and routes (charge waiting → `/kiosk/charge/card`, otherwise `/kiosk/check`).
     Holding the disc still runs the web demo shortcut, as on the web.
  2. **The page asks** through the JS bridge below (`apps/web/lib/native-nfc.ts`), for a
     "Tap your CareCard" button on the kiosk's own screens.
- **Token parsing.** The app takes the token from the URI record's `/t/<token>` path (any host;
  the backend checks the token), or a bare token in a text record, and accepts it only if it
  matches `^[A-Za-z0-9_-]{10,64}$`. The card format is unchanged.
- **Simulator.** It has no NFC. In DEBUG builds a scan with no NFC reader asks for a token
  instead, and Settings → Debug → Simulate scan opens `/t/<token>` directly. Release builds
  report `nfc_unavailable`. Debug builds also take a `-startPath /some/page` launch argument
  (`xcrun simctl launch <device> com.opencare.kiosk.dev -startPath /kiosk/charge`).

Files: `OpenCareKiosk/KioskModel.swift` (WebView, bridge, settings), `CareCardScanner.swift`
(Core NFC and token parsing), `ContentView.swift`, `SettingsView.swift`.

## Bridge contract

Message handler name: `carecard`. Available only in the app, to the main frame, on the configured
server's origin.

Page → app:

```js
window.webkit.messageHandlers.carecard.postMessage({ action: "scan", id: "<random id>" });
```

The app opens the NFC sheet ("Hold the CareCard near the top of the iPhone") and answers with a
window event:

```js
window.addEventListener("carecard", (e) => {
  // e.detail = { id, token }  on success
  // e.detail = { id, error }  error: "cancelled" | "timeout" | "invalid_card"
  //                                  | "nfc_unavailable" | "busy" | "failed"
});
```

Web helper (`apps/web/lib/native-nfc.ts`):

| Export | What it does |
| --- | --- |
| `isKioskApp()` | True inside this app (the `carecard` handler exists). |
| `scanCareCard(): Promise<string>` | Scan, resolve with the token, reject with `NativeScanError` (`code` as above). |
| `tapWithNativeScan(navigate)` | Scan → `tap(token)` → `navigate(path)`: the waiting charge or `/kiosk/check` for a session, `/t/<token>` otherwise (it explains unpaired or unknown cards). |
| `pathAfterSessionTap()` | The routing rule shared with `/t/<token>`. |

A kiosk screen uses it like this:

```tsx
const router = useRouter();
{isKioskApp() && (
  <button onClick={() => tapWithNativeScan(router.push).catch(() => {})}>Tap your CareCard</button>
)}
```

## Security notes

- The app holds no secrets, API keys or tokens. The card token goes through the page's own
  `tap(token)` call, so the device and session cookies stay httpOnly in the WebView's store and
  every check stays on the server.
- Only the configured server's own pages (main frame, same scheme, host and port) can ask for a
  scan, and replies go only to a page still on that origin. Other sites opened in the WebView get
  nothing.
- The token is validated before it is used, and passed to the page as a JS argument
  (`callAsyncJavaScript`), never pasted into script text.
- App Transport Security stays on. Only local-network HTTP is allowed (`NSAllowsLocalNetworking`),
  for a dev server on your Mac.
- The staff PIN is typed on `/pair` in the app. Never put it in the code, the repo or the board.

## Build and install on your iPhone

You need: a Mac with Xcode, your paid Apple Developer account, an iPhone with NFC (iPhone 7 or
newer), and a USB cable.

1. **Open the project.** In Finder, open `apps/kiosk-ios/OpenCareKiosk.xcodeproj` (double-click).
2. **Pick your team.** In Xcode's left sidebar click the blue **OpenCareKiosk** project, then the
   **OpenCareKiosk** target, then the **Signing & Capabilities** tab. Leave **Automatically manage
   signing** on and choose your team in **Team** (sign in under Xcode → Settings → Accounts first
   if it's empty). If Xcode says the bundle identifier is taken, change it to something unique,
   like `com.<yourname>.opencare.kiosk`. The **Near Field Communication Tag Reading** capability is
   already there.
3. **Plug in the iPhone** with the cable, unlock it, and tap **Trust** if it asks about this
   computer.
4. **Turn on Developer Mode** on the iPhone: Settings → Privacy & Security → Developer Mode → on.
   The phone restarts; after it's back, confirm **Turn On**. (The option appears only after the
   phone has been connected to Xcode once.)
5. **Run.** In Xcode's toolbar, click the device menu at the top and choose your iPhone, then
   press **Run** (▶). The first build takes a minute.
6. **Trust the developer** if the app won't open ("Untrusted Developer"): on the iPhone go to
   Settings → General → VPN & Device Management → your developer account → **Trust**. Then
   open **OpenCare Kiosk** again.
7. **Pair the kiosk once.** Long-press the screen with **two fingers** for about 1.5 seconds to
   open Settings, then tap **Pair this kiosk (staff PIN)**. Enter the staff PIN (ask Omar; never commit
   it). The pairing cookie stays after relaunch.
8. **Test a card.** Open the kiosk start (or start a charge at `/kiosk/charge`), tap the
   **Tap here** disc at the top of the kiosk screen, and hold the card near the top of the iPhone. The kiosk should open that
   patient's bill (or the waiting charge) without leaving the app.

Apps installed this way with a paid account keep working for a year; just press Run again to
reinstall after changes.

### Local server instead of production

Run the web app on your Mac (with a local database, never the production `DATABASE_URL`) and
start it on all interfaces, for example
`npm run dev -w @abdulcare/web -- -H 0.0.0.0`. In the app's Settings set the server to
`http://<your Mac's IP>:3000` (System Settings → Wi-Fi → Details shows the IP), allow local
network access when iOS asks, and pair again (pairing is per server). Cards written for
production still work: the app only takes the token, so a local server accepts them only if
that token exists in your local database.

### Command-line builds

```bash
# Simulator (no signing needed)
xcodebuild -project apps/kiosk-ios/OpenCareKiosk.xcodeproj -scheme OpenCareKiosk -sdk iphonesimulator build
# Device, compile check only (installing needs a team)
xcodebuild -project apps/kiosk-ios/OpenCareKiosk.xcodeproj -scheme OpenCareKiosk -sdk iphoneos CODE_SIGNING_ALLOWED=NO build
```
