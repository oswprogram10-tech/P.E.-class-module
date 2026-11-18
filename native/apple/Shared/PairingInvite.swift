import Foundation
import CoreFoundation

public struct PairingInvite: Equatable, Sendable {
    public let host: String
    public let port: Int
    public let sessionID: String
    public let ticket: String
    public let fingerprint: String
    public let expiresAt: Int64

    public static let prefix = "PELOOP_PAIR_V1."
    public static let ttlLimitMilliseconds: Int64 = 120_000

    public init(qr: String, nowMilliseconds: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) throws {
        guard qr.hasPrefix(Self.prefix), qr.utf8.count <= 4_096 else { throw PairingError.invalidQR }
        let encoded = String(qr.dropFirst(Self.prefix.count))
        guard !encoded.isEmpty, encoded.unicodeScalars.allSatisfy({
            CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-").contains($0)
        }) else { throw PairingError.invalidQR }

        var base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64), data.count <= 2_048,
              let object = try? JSONSerialization.jsonObject(with: data),
              let json = object as? [String: Any],
              Set(json.keys) == Set(["v", "host", "port", "sessionId", "ticket", "fingerprint", "expiresAt"])
        else { throw PairingError.invalidQR }

        guard let version = json["v"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
              let host = json["host"] as? String, Self.isPrivateIPv4(host),
              let portNumber = json["port"] as? NSNumber, CFGetTypeID(portNumber) != CFBooleanGetTypeID(),
              portNumber.doubleValue.rounded(.towardZero) == portNumber.doubleValue,
              (1_024.0...65_535.0).contains(portNumber.doubleValue),
              let sessionID = json["sessionId"] as? String, Self.isCanonicalUUID(sessionID),
              let ticket = json["ticket"] as? String, Self.isToken(ticket, bytes: 32),
              let fingerprint = json["fingerprint"] as? String, fingerprint.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil,
              let expiry = json["expiresAt"] as? NSNumber, CFGetTypeID(expiry) != CFBooleanGetTypeID(),
              expiry.doubleValue.rounded(.towardZero) == expiry.doubleValue
        else { throw PairingError.invalidQR }

        let expiryDouble = expiry.doubleValue
        guard expiryDouble <= 9_007_199_254_740_991,
              expiryDouble > Double(nowMilliseconds),
              expiryDouble <= Double(nowMilliseconds + Self.ttlLimitMilliseconds) else { throw PairingError.expiredQR }
        let expiryMilliseconds = expiry.int64Value

        self.host = host
        self.port = portNumber.intValue
        self.sessionID = sessionID.lowercased()
        self.ticket = ticket
        self.fingerprint = fingerprint.lowercased()
        self.expiresAt = expiryMilliseconds
    }

    public var webSocketURL: URL {
        URL(string: "wss://\(host):\(port)/wearable/v1")!
    }

    private static func isCanonicalUUID(_ value: String) -> Bool {
        guard value.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil,
              let uuid = UUID(uuidString: value) else { return false }
        return uuid.uuidString.caseInsensitiveCompare(value) == .orderedSame
    }

    private static func isToken(_ value: String, bytes: Int) -> Bool {
        guard value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { return false }
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)?.count == bytes
    }

    private static func isPrivateIPv4(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let octets = parts.compactMap { part -> Int? in
            guard part == "0" || (part.first != "0" && part.allSatisfy(\.isNumber)),
                  let value = Int(part), (0...255).contains(value) else { return nil }
            return value
        }
        guard octets.count == 4 else { return false }
        return octets[0] == 10 || (octets[0] == 172 && (16...31).contains(octets[1])) || (octets[0] == 192 && octets[1] == 168)
    }
}

public enum PairingError: Error, Equatable {
    case invalidQR
    case expiredQR
    case invalidAcknowledgement
    case sessionMismatch
    case invalidMessage
}

