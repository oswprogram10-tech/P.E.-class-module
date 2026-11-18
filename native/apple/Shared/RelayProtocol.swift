import Foundation
import CoreFoundation

public struct RelayAcknowledgement: Equatable, Sendable {
    public let sessionID: String
    public let resumeToken: String?
    public let serverTime: Int64

    public static func parse(_ text: String, expectedSessionID: String) throws -> RelayAcknowledgement {
        guard let data = text.data(using: .utf8), data.count <= 2_048,
              let object = try? JSONSerialization.jsonObject(with: data), let json = object as? [String: Any],
              let type = json["type"] as? String, type == "session-ready" || type == "session-resumed",
              let sessionID = json["sessionId"] as? String else { throw PairingError.invalidAcknowledgement }
        let isResume = type == "session-resumed"
        let expectedKeys: Set<String> = isResume ? ["type", "sessionId", "serverTime"] : ["type", "sessionId", "resumeToken", "serverTime"]
        guard Set(json.keys) == expectedKeys else { throw PairingError.invalidAcknowledgement }
        guard sessionID.caseInsensitiveCompare(expectedSessionID) == .orderedSame else { throw PairingError.sessionMismatch }
        guard let time = json["serverTime"] as? NSNumber, CFGetTypeID(time) != CFBooleanGetTypeID(),
              time.doubleValue.rounded(.towardZero) == time.doubleValue,
              time.int64Value > 0, time.int64Value <= 9_007_199_254_740_991 else { throw PairingError.invalidAcknowledgement }

        var resumeToken: String?
        if !isResume {
            guard let token = json["resumeToken"] as? String,
                  token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw PairingError.invalidAcknowledgement }
            var base64 = token.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
            guard Data(base64Encoded: base64)?.count == 32 else { throw PairingError.invalidAcknowledgement }
            resumeToken = token
        }
        return RelayAcknowledgement(sessionID: sessionID.lowercased(), resumeToken: resumeToken, serverTime: time.int64Value)
    }
}

public enum RelayMessage {
    public static func deviceReady(model: String, releaseDate: String) throws -> String {
        guard !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, model.count <= 100,
              releaseDate.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { throw PairingError.invalidMessage }
        let device: [String: Any] = ["platform": "apple-watch", "model": model, "releaseDate": releaseDate, "heartRateAvailable": true]
        return try encode(["type": "device-ready", "device": device])
    }

    public static func sample(bpm: Double, timestamp: Int64) throws -> String {
        guard bpm.isFinite, (20...250).contains(bpm), timestamp > 0, timestamp <= 9_007_199_254_740_991 else { throw PairingError.invalidMessage }
        return try encode(["type": "sample", "metric": "heartRate", "value": bpm, "timestamp": timestamp])
    }

    public static func status(_ type: String) throws -> String {
        guard ["permission-unavailable", "permission-revoked", "disconnected"].contains(type) else { throw PairingError.invalidMessage }
        return try encode(["type": type])
    }

    private static func encode(_ value: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        guard data.count <= 2_048, let text = String(data: data, encoding: .utf8) else { throw PairingError.invalidMessage }
        return text
    }
}
