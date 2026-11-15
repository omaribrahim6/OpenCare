import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: KioskModel
    @Environment(\.dismiss) private var dismiss
    @State private var serverText = ""
    @State private var invalid = false
    @State private var writeToken = ""
    @State private var writeStatus: String?
    @State private var writing = false
    @State private var writer = CareCardWriter()
    #if DEBUG
    @State private var debugToken = ""
    #endif

    private func writeCard() {
        guard let token = CareCardToken.from(text: writeToken) else { return }
        writing = true
        writeStatus = nil
        writer.write(token: token) { result in
            writing = false
            switch result {
            case .success:
                writeStatus = "CareCard written."
                writeToken = ""
            case .failure(let error):
                writeStatus = error.description
            }
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(KioskModel.defaultServer, text: $serverText)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save and open kiosk") {
                        if model.setServer(serverText) { dismiss() } else { invalid = true }
                    }
                    Button("Use production") {
                        serverText = KioskModel.defaultServer
                        model.setServer(serverText)
                        dismiss()
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text(invalid
                         ? "Enter an http:// or https:// address."
                         : "The kiosk opens \(KioskModel.startPath) on this server. For local testing use your Mac's address, e.g. http://192.168.1.20:3000.")
                }

                Section("Kiosk") {
                    Button("Pair this kiosk (staff PIN)") { model.open(path: "/pair"); dismiss() }
                    Button("Charge screen") { model.open(path: KioskModel.startPath); dismiss() }
                    Button("Reload") { model.reload(); dismiss() }
                }

                Section {
                    TextField("Card token", text: $writeToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                    Button(writing ? "Hold the card to the iPhone…" : "Write to card") { writeCard() }
                        .disabled(writing || CareCardToken.from(text: writeToken) == nil)
                    if let writeStatus { Text(writeStatus).font(.footnote).foregroundStyle(.secondary) }
                } header: {
                    Text("Write CareCard (staff)")
                } footer: {
                    Text("Paste the card token (the part after /t/ also works as a full link). It is written as one NFC text record and is not saved in the app. Locked tags can't be rewritten.")
                }

                Section("CareCard reader") {
                    LabeledContent("NFC", value: CareCardScanner.isAvailable ? "Available" : "Not available")
                    Button("Read a CareCard") { dismiss(); model.nativeTap() }
                }

                #if DEBUG
                Section {
                    TextField("Card token", text: $debugToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Simulate scan") {
                        if let token = CareCardToken.from(text: debugToken) {
                            model.openTap(token: token)
                            dismiss()
                        }
                    }
                } header: {
                    Text("Debug")
                } footer: {
                    Text("Debug builds only. Opens /t/<token> as if that card was read.")
                }
                #endif

                Section {
                    Text("Open these settings any time with a two-finger long press on the kiosk.")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                Section("About") {
                    LabeledContent("User agent", value: KioskModel.userAgentSuffix)
                    LabeledContent("Open page", value: model.webView.url?.path ?? "—")
                }
            }
            .navigationTitle("Kiosk settings")
            .onDisappear { writeToken = "" }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { serverText = model.server.absoluteString }
        }
    }
}
