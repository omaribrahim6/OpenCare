import CoreNFC
import Foundation
import os

private let kioskLogger = Logger(subsystem: "com.opencare.kiosk", category: "carecard")

/// Kiosk diagnostics: to the unified log (Xcode console) and stdout (devicectl --console).
enum kioskLog {
    static func notice(_ message: String) { kioskLogger.notice("\(message)"); print("[kiosk] \(message)") }
    static func error(_ message: String) { kioskLogger.error("\(message)"); print("[kiosk] ERROR \(message)") }
}

/// Why a scan ended without a token. The raw value is what the web page receives as `error`.
enum ScanError: String, Error {
    case cancelled
    case timeout
    case invalidCard = "invalid_card"
    /// The server didn't accept the card (unknown, revoked, or the kiosk isn't paired).
    case rejected
    case nfcUnavailable = "nfc_unavailable"
    case busy
    case failed
}

/// Pulls the card token out of what a CareCard holds. A card has one NDEF Text record whose
/// payload is the raw token. Older cards hold a URI record, `https://<host>/t/<token>`, which is
/// still accepted.
enum CareCardToken {
    private static let pattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{10,64}$")

    static func isValid(_ token: String) -> Bool {
        let range = NSRange(token.startIndex..., in: token)
        return pattern.firstMatch(in: token, range: range) != nil
    }

    /// The token from a `/t/<token>` link, on any host (the backend checks the token itself).
    static func from(url: URL) -> String? {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count >= 2, parts[parts.count - 2] == "t", let token = parts.last else { return nil }
        return isValid(token) ? token : nil
    }

    /// A bare token, or a `/t/<token>` link, typed or stored as text.
    static func from(text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if isValid(trimmed) { return trimmed }
        if let url = URL(string: trimmed), url.scheme != nil { return from(url: url) }
        return nil
    }

    static func from(messages: [NFCNDEFMessage]) -> String? {
        let records = messages.flatMap(\.records)
        for record in records {
            let (text, _) = record.wellKnownTypeTextPayload()
            if let text, let token = from(text: text) { return token }
        }
        for record in records {
            if let url = record.wellKnownTypeURIPayload(), let token = from(url: url) { return token }
        }
        return nil
    }

    /// What a CareCard is written with: one NDEF Text record holding the token.
    static func message(for token: String) -> NFCNDEFMessage? {
        guard isValid(token), let record = NFCNDEFPayload.wellKnownTypeTextPayload(string: token, locale: Locale(identifier: "en")) else { return nil }
        return NFCNDEFMessage(records: [record])
    }
}

/// The NFC sheet's text. Mohamed's call: no "top of the phone" wording.
enum NFCCopy {
    static let ready = "Tap your card."
    static let checking = "Checking your card…"
    static let accepted = "Card accepted."
    static let notACareCard = "That isn't an OpenCare CareCard."
}

/// One NFC read at a time with `NFCNDEFReaderSession`. Callbacks arrive on the main queue.
///
/// `verify` runs while the sheet is still open: pass nil to accept the token, or a message to show
/// in the sheet as an error. So a card the server rejects never leaves the tap screen.
/// Ends a session showing `message`. invalidate(errorMessage:) is refused by some iOS versions
/// ("Session does not support invalidation with error"), which left the sheet without feedback,
/// so the message goes in alertMessage and the sheet closes a moment later.
func closeSession(_ session: NFCNDEFReaderSession, showing message: String) {
    kioskLog.notice("NFC sheet closing with: \(message)")
    session.alertMessage = message
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { session.invalidate() }
}

final class CareCardScanner: NSObject, NFCNDEFReaderSessionDelegate {
    typealias Verify = (_ token: String, _ done: @escaping (_ errorMessage: String?) -> Void) -> Void

    static var isAvailable: Bool { NFCNDEFReaderSession.readingAvailable }

    private var session: NFCNDEFReaderSession?
    private var verify: Verify?
    private var completion: ((Result<String, ScanError>) -> Void)?
    private var verifying = false

    func scan(verify: @escaping Verify, _ completion: @escaping (Result<String, ScanError>) -> Void) {
        guard self.completion == nil else { return completion(.failure(.busy)) }
        guard Self.isAvailable else { return completion(.failure(.nfcUnavailable)) }
        self.verify = verify
        self.completion = completion
        let session = NFCNDEFReaderSession(delegate: self, queue: .main, invalidateAfterFirstRead: false)
        session.alertMessage = NFCCopy.ready
        self.session = session
        session.begin()
    }

    private func finish(_ result: Result<String, ScanError>) {
        let done = completion
        completion = nil
        verify = nil
        session = nil
        verifying = false
        done?(result)
    }

    func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        guard !verifying else { return }
        let records = messages.flatMap(\.records)
        kioskLog.notice("NFC read \(records.count) record(s): \(records.map { "tnf=\($0.typeNameFormat.rawValue) type=\(String(decoding: $0.type, as: UTF8.self)) bytes=\($0.payload.count)" }.joined(separator: ", "))")
        guard let token = CareCardToken.from(messages: messages) else {
            closeSession(session, showing: NFCCopy.notACareCard)
            return finish(.failure(.invalidCard))
        }
        verifying = true
        session.alertMessage = NFCCopy.checking
        (verify ?? { _, done in done(nil) })(token) { [weak self] errorMessage in
            guard let self, self.completion != nil else { return }
            if let errorMessage {
                closeSession(session, showing: errorMessage)
                self.finish(.failure(.rejected))
            } else {
                session.alertMessage = NFCCopy.accepted
                session.invalidate()
                self.finish(.success(token))
            }
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        kioskLog.notice("NFC read session ended: \(error.localizedDescription)")
        // Also called after our own invalidate(); finish() already ran then.
        guard completion != nil else { return }
        switch (error as? NFCReaderError)?.code {
        case .readerSessionInvalidationErrorUserCanceled: finish(.failure(.cancelled))
        case .readerSessionInvalidationErrorSessionTimeout: finish(.failure(.timeout))
        default: finish(.failure(.failed))
        }
    }
}

/// Writes a token to a blank (or rewritable) tag as one NDEF Text record. Staff only, from Settings.
final class CareCardWriter: NSObject, NFCNDEFReaderSessionDelegate {
    private var session: NFCNDEFReaderSession?
    private var message: NFCNDEFMessage?
    private var completion: ((Result<Void, WriteError>) -> Void)?

    enum WriteError: Error, CustomStringConvertible {
        case invalidToken, nfcUnavailable, busy, cancelled, failed(String)
        var description: String {
            switch self {
            case .invalidToken: return "That isn't a valid card token."
            case .nfcUnavailable: return "This device can't write NFC tags."
            case .busy: return "Already writing a card."
            case .cancelled: return "Cancelled."
            case .failed(let why): return why
            }
        }
    }

    func write(token: String, _ completion: @escaping (Result<Void, WriteError>) -> Void) {
        guard self.completion == nil else { return completion(.failure(.busy)) }
        guard let message = CareCardToken.message(for: token) else { return completion(.failure(.invalidToken)) }
        guard NFCNDEFReaderSession.readingAvailable else { return completion(.failure(.nfcUnavailable)) }
        self.message = message
        self.completion = completion
        let session = NFCNDEFReaderSession(delegate: self, queue: .main, invalidateAfterFirstRead: false)
        session.alertMessage = "Hold a blank CareCard to the iPhone to write it."
        self.session = session
        session.begin()
    }

    private func finish(_ result: Result<Void, WriteError>) {
        let done = completion
        completion = nil
        message = nil
        session = nil
        done?(result)
    }

    private func fail(_ session: NFCNDEFReaderSession, _ why: String) {
        closeSession(session, showing: why)
        finish(.failure(.failed(why)))
    }

    func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    // Required by the protocol; with didDetect tags implemented, reads arrive there instead.
    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let message else { return }
        guard tags.count == 1, let tag = tags.first else {
            session.alertMessage = "More than one card found. Hold just one."
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { session.restartPolling() }
            return
        }
        session.connect(to: tag) { [weak self] error in
            guard let self else { return }
            if error != nil { return self.fail(session, "Couldn't connect to the card. Try again.") }
            tag.queryNDEFStatus { status, capacity, error in
                if error != nil { return self.fail(session, "Couldn't read the card. Try again.") }
                switch status {
                case .notSupported: return self.fail(session, "This tag can't hold a CareCard.")
                case .readOnly: return self.fail(session, "This card is locked and can't be rewritten.")
                case .readWrite:
                    guard message.length <= capacity else { return self.fail(session, "This tag is too small.") }
                    tag.writeNDEF(message) { error in
                        if error != nil { return self.fail(session, "Writing failed. Try again.") }
                        session.alertMessage = "CareCard written."
                        session.invalidate()
                        self.finish(.success(()))
                    }
                @unknown default: return self.fail(session, "This tag can't hold a CareCard.")
                }
            }
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        guard completion != nil else { return }
        if (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorUserCanceled {
            finish(.failure(.cancelled))
        } else {
            finish(.failure(.failed("The card wasn't written.")))
        }
    }
}
