import SwiftUI
import WebKit

/// The kiosk site, full-bleed with no native chrome. The only native UI is Apple's NFC sheet and
/// the settings screen behind a two-finger long press (plus a screen if the server can't be reached).
struct ContentView: View {
    @StateObject private var model = KioskModel()

    var body: some View {
        WebViewContainer(webView: model.webView)
            .ignoresSafeArea()
            .background(Color(KioskModel.pageBackground).ignoresSafeArea())
            .overlay { if let error = model.loadError { LoadErrorView(message: error, model: model) } }
            .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
            .alert("Simulate a CareCard scan", isPresented: $model.simulatePrompt) {
                TextField("Card token or /t/ link", text: $model.simulateText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Scan") { model.finishSimulate(submit: true) }
                Button("Cancel", role: .cancel) { model.finishSimulate(submit: false) }
            } message: {
                Text("This device has no NFC (debug build). Enter a CareCard token.")
            }
            .alert("Card not accepted", isPresented: Binding(
                get: { model.simulateError != nil }, set: { if !$0 { model.simulateError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.simulateError ?? "")
            }
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }
}

private struct LoadErrorView: View {
    let message: String
    @ObservedObject var model: KioskModel

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark").font(.largeTitle)
            Text("Can't reach the kiosk server").font(.title3.bold())
            Text(model.server.absoluteString).font(.footnote.monospaced()).foregroundStyle(.secondary)
            Text(message).font(.footnote).multilineTextAlignment(.center).foregroundStyle(.secondary)
            HStack {
                Button("Retry") { model.reload() }.buttonStyle(.borderedProminent)
                Button("Settings") { model.showSettings = true }.buttonStyle(.bordered)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(KioskModel.pageBackground))
    }
}

struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
