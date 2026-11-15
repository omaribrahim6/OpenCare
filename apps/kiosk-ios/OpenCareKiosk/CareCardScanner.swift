import CoreNFC
import Foundation

/// Why a scan ended without a token. The raw value is what the web page receives as `error`.
enum ScanError: String, Error {
    case cancelled
    case timeout
    case invalidCard = "invalid_card"
    case nfcUnavailable = "nfc_unavailable"
    case busy
    case failed

    /// A short message for the kiosk screen, or nil when nothing needs saying.
    var message: String? {
        switch self {
        case .cancelled: return nil
        case .timeout: return "No card found. Try again."
        case .invalidCard: return "That isn't an OpenCare CareCard."
        case .nfcUnavailable: return "This iPhone can't read cards."
        case .busy: return "Already reading a card."
        case .failed: return "Couldn't read the card. Try again."
        }
    }
}

/// Pulls the card token out of what a CareCard holds. The tag has one NDEF URI record,
/// `https://<host>/t/<token>`; a text record with a bare token (or that URL) is accepted too.
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
        for record in messages.flatMap(\.records) {
            if let url = record.wellKnownTypeURIPayload(), let token = from(url: url) { return token }
            let (text, _) = record.wellKnownTypeTextPayload()
            if let text, let token = from(text: text) { return token }
        }
        return nil
    }
}

/// One NFC read at a time with `NFCNDEFReaderSession`. Callbacks arrive on the main queue.
final class CareCardScanner: NSObject, NFCNDEFReaderSessionDelegate {
    static var isAvailable: Bool { NFCNDEFReaderSession.readingAvailable }

    private var session: NFCNDEFReaderSession?
    private var completion: ((Result<String, ScanError>) -> Void)?

    func scan(_ completion: @escaping (Result<String, ScanError>) -> Void) {
        guard self.completion == nil else { return completion(.failure(.busy)) }
        guard Self.isAvailable else { return completion(.failure(.nfcUnavailable)) }
        self.completion = completion
        let session = NFCNDEFReaderSession(delegate: self, queue: .main, invalidateAfterFirstRead: false)
        session.alertMessage = "Hold the CareCard near the top of the iPhone."
        self.session = session
        session.begin()
    }

    private func finish(_ result: Result<String, ScanError>) {
        let done = completion
        completion = nil
        session = nil
        done?(result)
    }

    func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        if let token = CareCardToken.from(messages: messages) {
            session.alertMessage = "CareCard read."
            session.invalidate()
            finish(.success(token))
        } else {
            session.invalidate(errorMessage: "That isn't an OpenCare CareCard.")
            finish(.failure(.invalidCard))
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        // Also called after a successful read's invalidate(); finish() already ran then.
        guard completion != nil else { return }
        switch (error as? NFCReaderError)?.code {
        case .readerSessionInvalidationErrorUserCanceled: finish(.failure(.cancelled))
        case .readerSessionInvalidationErrorSessionTimeout: finish(.failure(.timeout))
        default: finish(.failure(.failed))
        }
    }
}
