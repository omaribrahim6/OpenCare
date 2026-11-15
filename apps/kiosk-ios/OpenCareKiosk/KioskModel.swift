import Foundation
import SwiftUI
import WebKit

/// Owns the kiosk WebView, the CareCard bridge and the server setting.
@MainActor
final class KioskModel: NSObject, ObservableObject {
    static let defaultServer = "https://abdulcare.vercel.app"
    static let startPath = "/kiosk"
    static let userAgentSuffix = "OpenCareKiosk/1"
    private static let serverKey = "serverURL"

    /// Origin the kiosk loads, e.g. https://abdulcare.vercel.app or http://192.168.1.20:3000.
    @Published private(set) var server: URL
    @Published var toast: String?
    @Published var loadError: String?
    @Published var showSettings = false
    @Published var simulatePrompt = false
    @Published var simulateText = ""
    /// Path of the open page, kept current through client-side navigation too.
    @Published private(set) var currentPath = ""

    let webView: WKWebView
    private let scanner = CareCardScanner()
    private var simulateCompletion: ((Result<String, ScanError>) -> Void)?
    private var toastTask: Task<Void, Never>?
    private var urlObservation: NSKeyValueObservation?

    /// Kiosk screens where a patient taps a card (the floating reader button shows only there).
    static let tapScreens: Set<String> = ["/kiosk", "/kiosk/charge"]

    override init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey)
        server = saved.flatMap(Self.normalize) ?? URL(string: Self.defaultServer)!

        let config = WKWebViewConfiguration()
        // Persistent store: the kiosk's pairing and session cookies survive relaunches.
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "Version/17.0 Mobile/15E148 Safari/604.1 \(Self.userAgentSuffix)"
        config.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        config.userContentController.add(WeakMessageHandler(self), name: "carecard")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] webView, _ in
            let path = webView.url?.path ?? ""
            Task { @MainActor in self?.currentPath = path }
        }
        #if DEBUG
        webView.isInspectable = true
        // Debug launch argument: `-startPath /some/page` opens that page first.
        if let path = UserDefaults.standard.string(forKey: "startPath"), path.hasPrefix("/") {
            open(path: path)
            return
        }
        #endif
        open(path: Self.startPath)
    }

    // MARK: Server

    /// Keeps only scheme, host and port of an http(s) URL; nil if it isn't one.
    static func normalize(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host, !host.isEmpty else { return nil }
        parts.scheme = scheme
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        parts.user = nil
        parts.password = nil
        return parts.url
    }

    /// Saves a new server and opens its kiosk start page. False if the URL is invalid.
    @discardableResult
    func setServer(_ text: String) -> Bool {
        guard let url = Self.normalize(text) else { return false }
        server = url
        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
        open(path: Self.startPath)
        return true
    }

    func open(path: String) {
        guard let url = URL(string: path, relativeTo: server) else { return }
        loadError = nil
        webView.load(URLRequest(url: url))
    }

    func reload() {
        loadError = nil
        if webView.url == nil { open(path: Self.startPath) } else { webView.reload() }
    }

    /// True for the kiosk server's own pages (the only ones allowed to ask for a scan).
    private func isServerOrigin(scheme: String?, host: String?, port: Int?) -> Bool {
        let defaultPort = server.scheme == "https" ? 443 : 80
        return scheme?.lowercased() == server.scheme
            && host?.lowercased() == server.host?.lowercased()
            && (port ?? defaultPort) == (server.port ?? defaultPort)
    }

    var showsCardButton: Bool {
        loadError == nil && pageIsOnServer && Self.tapScreens.contains(currentPath)
    }

    private var pageIsOnServer: Bool {
        guard let url = webView.url else { return false }
        return isServerOrigin(scheme: url.scheme, host: url.host, port: url.port)
    }

    // MARK: Scanning

    /// Reads a CareCard. Without NFC (the simulator), DEBUG builds ask for a token instead.
    func scan(_ completion: @escaping (Result<String, ScanError>) -> Void) {
        if CareCardScanner.isAvailable { return scanner.scan(completion) }
        #if DEBUG
        guard simulateCompletion == nil else { return completion(.failure(.busy)) }
        simulateCompletion = completion
        simulateText = ""
        simulatePrompt = true
        #else
        completion(.failure(.nfcUnavailable))
        #endif
    }

    /// Answers the DEBUG "simulate scan" prompt.
    func finishSimulate(submit: Bool) {
        let done = simulateCompletion
        simulateCompletion = nil
        guard submit else { done?(.failure(.cancelled)); return }
        if let token = CareCardToken.from(text: simulateText) { done?(.success(token)) } else { done?(.failure(.invalidCard)) }
    }

    /// The floating CareCard button: scan, then open /t/<token>, where the web app taps and routes.
    func nativeTap() {
        scan { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let token): self.openTap(token: token)
            case .failure(let error): if let message = error.message { self.show(message) }
            }
        }
    }

    /// Opens the card's tap page on this kiosk's server, as if the card's own link was opened.
    func openTap(token: String) {
        guard CareCardToken.isValid(token) else { return show(ScanError.invalidCard.message!) }
        open(path: "/t/\(token)")
    }

    func show(_ message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { self?.toast = nil }
        }
    }

    // MARK: Bridge

    fileprivate func handle(_ message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.name == "carecard", message.frameInfo.isMainFrame,
              isServerOrigin(scheme: origin.protocol, host: origin.host, port: origin.port == 0 ? nil : origin.port),
              let body = message.body as? [String: Any], body["action"] as? String == "scan",
              let id = body["id"] as? String, !id.isEmpty, id.count <= 64 else { return }
        scan { [weak self] result in self?.reply(id: id, result) }
    }

    /// Sends the scan result to the page as a `carecard` CustomEvent: `{id, token}` or `{id, error}`.
    private func reply(id: String, _ result: Result<String, ScanError>) {
        guard pageIsOnServer else { return }
        var detail: [String: Any] = ["id": id]
        switch result {
        case .success(let token): detail["token"] = token
        case .failure(let error): detail["error"] = error.rawValue
        }
        webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('carecard', { detail }));",
            arguments: ["detail": detail], in: nil, in: .page, completionHandler: nil)
    }
}

// MARK: - WebKit delegates

extension KioskModel: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
        if scheme == "http" || scheme == "https" || scheme == "about" || scheme == "blob" || scheme == "data" {
            return decisionHandler(.allow)
        }
        // tel:, mailto: and the like go to the system.
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled { return }
        loadError = nsError.localizedDescription
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadError = nil
    }

    // target=_blank and window.open load in the kiosk itself.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        show(message)
        completionHandler()
    }
}

/// Breaks the retain cycle between the content controller and the model.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var model: KioskModel?
    init(_ model: KioskModel) { self.model = model }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { model?.handle(message) }
    }
}
