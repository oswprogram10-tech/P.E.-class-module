import Foundation

public struct AppleWatchProfile: Equatable, Sendable {
    public let hardwareIdentifier: String
    public let displayName: String
    public let releaseDate: String
    public let minimumWatchOS: Int
    public let minimumIOS: Int
}

public struct AppleWatchRetailFamily: Equatable, Sendable {
    public let name: String
    public let releaseDate: String
    public let minimumWatchOS: Int
    public let minimumIOS: Int
    public let modelNumbers: [String]
}

/// Retail model numbers and initial store availability documented by Apple. These
/// A-numbers are not runtime identifiers and do not establish a WatchN,N mapping.
public enum AppleWatchRetailCatalog {
    public static let families: [AppleWatchRetailFamily] = [
        .init(name: "Apple Watch Series 9", releaseDate: "2023-09-22", minimumWatchOS: 10, minimumIOS: 17, modelNumbers: ["A2978", "A2980", "A2982", "A2983", "A2984", "A2985"]),
        .init(name: "Apple Watch Ultra 2", releaseDate: "2023-09-22", minimumWatchOS: 10, minimumIOS: 17, modelNumbers: ["A2986", "A2987"]),
        .init(name: "Apple Watch Series 10", releaseDate: "2024-09-20", minimumWatchOS: 11, minimumIOS: 18, modelNumbers: ["A2997", "A2998", "A2999", "A3000", "A3001", "A3002", "A3003", "A3206"]),
        .init(name: "Apple Watch Series 11", releaseDate: "2025-09-19", minimumWatchOS: 26, minimumIOS: 26, modelNumbers: ["A3331", "A3450", "A3333", "A3451", "A3335", "A3452", "A3337", "A3453"]),
        .init(name: "Apple Watch SE 3", releaseDate: "2025-09-19", minimumWatchOS: 26, minimumIOS: 26, modelNumbers: ["A3324", "A3391", "A3325", "A3392", "A3326", "A3327", "A3328", "A3329"]),
        .init(name: "Apple Watch Ultra 3", releaseDate: "2025-09-19", minimumWatchOS: 26, minimumIOS: 26, modelNumbers: ["A3281", "A3282"]),
        .init(name: "Apple Watch Series 12", releaseDate: "2026-09-18", minimumWatchOS: 27, minimumIOS: 27, modelNumbers: ["A3581", "A3583", "A3584", "A3585", "A3582", "A3586", "A3587", "A3588"]),
        .init(name: "Apple Watch Ultra 4", releaseDate: "2026-09-18", minimumWatchOS: 27, minimumIOS: 27, modelNumbers: ["A3579", "A3580"])
    ]

    public static func family(for modelNumber: String) -> AppleWatchRetailFamily? {
        families.first { $0.modelNumbers.contains(modelNumber.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
}

/// Provisional runtime candidates. Neither their family assignments nor dates
/// have been verified by Apple; they must not be joined to retail model numbers.
public enum AppleWatchCatalog {
    private static let profiles: [String: AppleWatchProfile] = {
        var values: [String: AppleWatchProfile] = [:]
        for (suffixes, year, date, watchOS, iOS) in [
            (1...6, "2023", "2023-09-22", 10, 17),
            (8...11, "2024", "2024-09-20", 11, 18)
        ] {
            for suffix in suffixes {
                let identifier = "Watch7,\(suffix)"
                values[identifier] = AppleWatchProfile(hardwareIdentifier: identifier, displayName: "Apple Watch (\(year) candidate)", releaseDate: date, minimumWatchOS: watchOS, minimumIOS: iOS)
            }
        }
        return values
    }()

    public static func profile(for hardwareIdentifier: String) -> AppleWatchProfile? {
        profiles[hardwareIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)]
    }
}

/// A fresh accepted ready message is required for every session token.
public struct WatchSampleGate {
    private var acceptedToken: String?
    public init() {}
    public mutating func reset() { acceptedToken = nil }
    @discardableResult public mutating func acceptReady(token: String, identifier: String, iOSMajor: Int) -> AppleWatchProfile? {
        acceptedToken = nil
        guard let profile = AppleWatchCatalog.profile(for: identifier), iOSMajor >= profile.minimumIOS else { return nil }
        acceptedToken = token
        return profile
    }
    public func permitsSample(token: String) -> Bool { acceptedToken == token }
}
