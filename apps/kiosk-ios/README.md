# OpenCare Kiosk (iPhone test app)

A local-only iPhone app that runs the OpenCare kiosk and reads CareCards over NFC inside the app.

## Why it exists

The demo kiosk is an iPhone. iOS browsers (Safari, Chrome) have no Web NFC, so today the phone
only reads a CareCard in the background and shows a banner that jumps to Safari. This app wraps
the kiosk site in a `WKWebView` and reads the card with Core NFC, so a tap stays in the kiosk.

It is a test app: installed from Xcode over a cable, no App Store or TestFlight. The iPad has no
NFC, so it isn't a target.

## How it works

The app runs the full kiosk charge flow from the web, with the same screens:

```
/kiosk/charge  staff type the itemized bill (or press "Car accident demo": 17 lines, $456,832.16)
   │  Charge patient
   ▼
tap screen     the NFC sheet opens by itself ("Tap your card")
   │  Core NFC reads the card's token
   │  POST /api/tap from the page (sheet still open): server checks the token's HMAC,
   │  starts that patient's session (httpOnly cookie in the WebView)
   ▼
/kiosk/charge/card   discount countdown ($456,832.16 → $310,645.00), billing the tapped patient
   │  Send to the community fund
   ▼
POST /api/kiosk/charges   a real claim on that patient's account (/admin, the patient's /user)
```

- **Card format.** A CareCard holds **one NDEF Text record whose payload is the raw card token**
  (`^[A-Za-z0-9_-]{10,64}$`, the part that used to come after `/t/`). Older cards with a URI
  record `https://<host>/t/<token>` still work: the app takes the token from the path.
- **Only a real card moves the flow on.** The server checks the token before the sheet closes.
  An unknown or revoked card (or an unpaired kiosk) shows its error in Apple's NFC sheet, and
  the kiosk stays on the tap screen. The disc's hold-to-tap demo shortcut is blocked in the app.
  `POST /api/kiosk/charges` refuses any request from the app (user agent `OpenCareKiosk/`)
  without a tapped card with a 401, so the demo-patient fallback can't happen here. The web
  hold demo is unchanged.
- **WebView.** Opens `<server>/kiosk/charge`. The server defaults to `https://abdulcare.vercel.app`
  and is changed in Settings (for example your Mac's `http://192.168.1.20:3000`). It uses the
  default persistent website data store, so the kiosk's pairing cookie survives relaunches. The
  user agent ends with `OpenCareKiosk/1`.
- **Looks exactly like the web kiosk.** The WebView is full-bleed with no native chrome: no
  bars, no buttons over the page. The pages' own `viewport-fit` and `env(safe-area-inset-*)`
  rules place content, and the background is the page color (`#f4f5fb`), so there's no flash.
  Link previews, the long-press callout and text selection outside form fields are off. Nothing
  is restyled natively. The only native UI is Apple's NFC sheet and the hidden settings.
- **Settings** (server, pairing, **Write CareCard**) open with a **two-finger long press (about
  1.5 s) anywhere**. They are never visible otherwise.
- **How the reader is opened.** An injected script (the web pages aren't changed) opens it when
  the tap screen appears on `/kiosk/charge` and when the patient taps the screen's "Tap here"
  disc, for example after cancelling. After a verified tap the app opens `/t/<token>`, which
  routes on to the waiting charge exactly as on the web.
- **Simulator.** It has no NFC. In DEBUG builds the reader asks for a typed token instead, and
  goes through the same server check. A refused card shows a "Card not accepted" alert there,
  in place of the NFC sheet's error. Debug builds also take a `-startPath /some/page` launch
  argument (`xcrun simctl launch <device> com.opencare.kiosk.dev -startPath /kiosk`).

Files: `OpenCareKiosk/KioskModel.swift` (WebView, bridge, settings), `CareCardScanner.swift`
(Core NFC and token parsing), `ContentView.swift`, `SettingsView.swift`.

## Bridge contract

Message handler name: `carecard`. Available only in the app, to the main frame, on the configured
server's origin.

Page → app:

```js
window.webkit.messageHandlers.carecard.postMessage({ action: "scan", id: "<random id>" });
```

The app opens the NFC sheet ("Tap your card") and answers with a window event. This path
returns the token without checking it; the page then calls `tap(token)` itself:

```js
window.addEventListener("carecard", (e) => {
  // e.detail = { id, token }  on success
  // e.detail = { id, error }  error: "cancelled" | "timeout" | "invalid_card"
  //                                  | "rejected" | "nfc_unavailable" | "busy" | "failed"
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

- The app holds no secrets, API keys or tokens. The card token goes to `POST /api/tap` from inside
  the page, so the device and session cookies stay httpOnly in the WebView's store and every
  check (the token's HMAC, the paired device) stays on the server.
- A card token signs that patient in at a paired kiosk. Treat it like a password: never commit
  it or post it on the board. The Write CareCard screen doesn't save what you paste.
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
8. **Test a card.** The app opens on the itemized bill. Press **Car accident demo**, then
   **Charge patient**. The NFC sheet opens by itself; tap the CareCard on the iPhone. The kiosk
   should show "Billing <patient>", run the discounts down to $310,645.00, and **Send to the
   community fund** files the claim on that patient's account. If you cancel the sheet, tap the
   **Tap here** disc to open it again.

### Write John's card

John's CareCard token is the part after `/t/` in the CareCard URL Omar sends you privately. Don't
commit it or post it anywhere.

1. Get a blank, **unlocked** NFC tag (NTAG213/215/216 sticker or card). A tag that was locked
   after writing can't be rewritten; use a new one.
2. In the app, long-press with two fingers to open Settings.
3. Under **Write CareCard (staff)**, paste the token (pasting the whole URL also works; the app
   keeps only the token) and tap **Write to card**.
4. Hold the tag to the iPhone until the sheet says "CareCard written".
5. Test it: close Settings, start a charge and tap the card. It should say "Billing John Doe".

Note: a card holding a text record no longer opens a web page when tapped on an ordinary iPhone
(the iOS banner only appears for links). Patients can still open their account at `/user` by
signing in with their account ID and birth date.

Apps installed this way with a paid account keep working for a year; just press Run again to
reinstall after changes.

### Local server instead of production

Run the web app on your Mac (with a local database, never the production `DATABASE_URL`) and
start it on all interfaces, for example
`npm run dev -w @abdulcare/web -- -H 0.0.0.0`. In the app's Settings set the server to
`http://<your Mac's IP>:3000` (System Settings → Wi-Fi → Details shows the IP), allow local
network access when iOS asks, and pair again (pairing is per server). A local server
accepts a card only if its token exists in your local database (the local seed prints its own
card URLs; the token is the part after `/t/`).

### Command-line builds

```bash
# Simulator (no signing needed)
xcodebuild -project apps/kiosk-ios/OpenCareKiosk.xcodeproj -scheme OpenCareKiosk -sdk iphonesimulator build
# Device, compile check only (installing needs a team)
xcodebuild -project apps/kiosk-ios/OpenCareKiosk.xcodeproj -scheme OpenCareKiosk -sdk iphoneos CODE_SIGNING_ALLOWED=NO build
```
