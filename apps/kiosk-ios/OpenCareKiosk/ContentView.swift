import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var model = KioskModel()

    var body: some View {
        WebViewContainer(webView: model.webView)
            .ignoresSafeArea(.container, edges: .bottom)
            .overlay { if let error = model.loadError { LoadErrorView(message: error, model: model) } }
            .overlay(alignment: .bottomTrailing) { CareCardButton(model: model).padding(16) }
            .overlay(alignment: .top) {
                if let toast = model.toast {
                    Text(toast)
                        .font(.callout.weight(.medium))
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.easeOut(duration: 0.2), value: model.toast)
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
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }
}

/// Tap: read a CareCard. Long-press: settings, reload, back to the kiosk start.
private struct CareCardButton: View {
    @ObservedObject var model: KioskModel

    var body: some View {
        Button { model.nativeTap() } label: {
            Image(systemName: "wave.3.right.circle.fill")
                .font(.system(size: 30))
                .symbolRenderingMode(.hierarchical)
                .frame(width: 52, height: 52)
                .background(.ultraThinMaterial, in: Circle())
        }
        .accessibilityLabel("Tap your CareCard")
        .contextMenu {
            Button { model.nativeTap() } label: { Label("Read a CareCard", systemImage: "wave.3.right") }
            Button { model.open(path: KioskModel.startPath) } label: { Label("Kiosk start", systemImage: "house") }
            Button { model.reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
            Button { model.showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
        }
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
        .background(Color(.systemBackground))
    }
}

struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
