import Foundation
import Combine
import CoreFoundation
import WatchConnectivity

struct PhoneWatchMessage: Sendable {
    enum Kind: Sendable { case ready(hardwareIdentifier: String), sample(bpm: Double, timestamp: Int64), unsupported(String), unavailable, disconnected }
    let sessionToken: String
    let kind: Kind
}

@MainActor
final class PhoneWatchBridge: NSObject, ObservableObject {
    var onMessage: ((PhoneWatchMessage) -> Void)?
    var onReachabilityChanged: ((Bool) -> Void)?
    var onStartFailure: ((String) -> Void)?
    @Published private(set) var reachable = false

    private let session: WCSession? = WCSession.isSupported() ? .default : nil

    override init() {
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func start(token: String) throws {
        guard let session, session.activationState == .activated, session.isPaired,
              session.isWatchAppInstalled, session.isReachable else { throw WatchLinkError.unavailable }
        session.sendMessage(["type": "start", "sessionToken": token], replyHandler: nil) { _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.updateReachability(false)
                self.onStartFailure?(token)
            }
        }
    }

    func stop(token: String?) {
        guard let token, let session, session.activationState == .activated, session.isReachable else { return }
        let message: [String: Any] = ["type": "stop", "sessionToken": token]
        session.sendMessage(message, replyHandler: nil, errorHandler: nil)
    }

    private func receive(_ dictionary: [String: Any]) {
        guard let type = dictionary["type"] as? String,
              let token = dictionary["sessionToken"] as? String,
              token.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil else { return }
        let kind: PhoneWatchMessage.Kind
        switch type {
        case "ready":
            guard Set(dictionary.keys) == ["type", "sessionToken", "hardwareIdentifier", "heartRateAvailable"],
                  dictionary["heartRateAvailable"] as? Bool == true,
                  let hardwareIdentifier = dictionary["hardwareIdentifier"] as? String,
                  hardwareIdentifier.count <= 32 else { return }
            kind = .ready(hardwareIdentifier: hardwareIdentifier)
        case "sample":
            guard Set(dictionary.keys) == ["type", "sessionToken", "bpm", "timestamp"],
                  let bpmNumber = dictionary["bpm"] as? NSNumber,
                  let timeNumber = dictionary["timestamp"] as? NSNumber else { return }
            let bpm = bpmNumber.doubleValue
            let timestamp = timeNumber.int64Value
            guard CFGetTypeID(timeNumber) != CFBooleanGetTypeID(),
                  bpm.isFinite, (20...250).contains(bpm), timeNumber.doubleValue.isFinite,
                  timeNumber.doubleValue <= 9_007_199_254_740_991,
                  timeNumber.doubleValue == Double(timestamp), timestamp > 0 else { return }
            kind = .sample(bpm: bpm, timestamp: timestamp)
        case "unsupported":
            guard Set(dictionary.keys).isSubset(of: ["type", "sessionToken", "model"]) else { return }
            kind = .unsupported((dictionary["model"] as? String)?.prefix(80).description ?? "알 수 없음")
        case "unavailable":
            guard Set(dictionary.keys) == ["type", "sessionToken"] else { return }
            kind = .unavailable
        case "disconnected":
            guard Set(dictionary.keys) == ["type", "sessionToken"] else { return }
            kind = .disconnected
        default: return
        }
        onMessage(PhoneWatchMessage(sessionToken: token, kind: kind))
    }

    private func updateReachability(_ value: Bool) {
        reachable = value
        onReachabilityChanged?(value)
    }
}

enum WatchLinkError: Error { case unavailable }

extension PhoneWatchBridge: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor [weak self] in self?.updateReachability(session.isReachable) }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) { }

    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in self?.updateReachability(session.isReachable) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor [weak self] in self?.receive(message) }
    }
}
