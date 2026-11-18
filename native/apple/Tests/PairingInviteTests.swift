import Foundation
import XCTest
@testable import PELoopAppleCore

final class PairingInviteTests: XCTestCase {
    private let now: Int64 = 1_800_000_000_000

    func testValidPrivateLanInviteParses() throws {
        let invite = try PairingInvite(qr: makeQR(), nowMilliseconds: now)
        XCTAssertEqual(invite.host, "192.168.1.12")
        XCTAssertEqual(invite.port, 45_678)
        XCTAssertEqual(invite.sessionID, "123e4567-e89b-42d3-a456-426614174000")
        XCTAssertEqual(invite.fingerprint.count, 64)
        XCTAssertEqual(invite.webSocketURL.path, "/wearable/v1")
    }

    func testPublicAddressAndNonCanonicalAddressAreRejected() {
        XCTAssertThrowsError(try PairingInvite(qr: makeQR(host: "8.8.8.8"), nowMilliseconds: now))
        XCTAssertThrowsError(try PairingInvite(qr: makeQR(host: "192.168.001.12"), nowMilliseconds: now))
    }

    func testExpiredOrOverlongInviteIsRejected() {
        XCTAssertThrowsError(try PairingInvite(qr: makeQR(expiresAt: now), nowMilliseconds: now))
        XCTAssertThrowsError(try PairingInvite(qr: makeQR(expiresAt: now + 120_001), nowMilliseconds: now))
    }

    func testAcknowledgementRequiresExpectedSessionAndFreshResumeToken() throws {
        let token = Data(repeating: 0x51, count: 32).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let ready = "{\"type\":\"session-ready\",\"sessionId\":\"123e4567-e89b-42d3-a456-426614174000\",\"resumeToken\":\"\(token)\",\"serverTime\":1800000000000}"
        XCTAssertEqual(try RelayAcknowledgement.parse(ready, expectedSessionID: "123e4567-e89b-42d3-a456-426614174000").resumeToken, token)
        XCTAssertThrowsError(try RelayAcknowledgement.parse(ready, expectedSessionID: "123e4567-e89b-42d3-a456-426614174001"))
    }

    func testMessagesAllowOnlyHeartRateAndBoundedSamples() throws {
        XCTAssertTrue(try RelayMessage.deviceReady(model: "Apple Watch Series 9", releaseDate: "2023-09-22").contains("heartRateAvailable"))
        XCTAssertTrue(try RelayMessage.sample(bpm: 120, timestamp: now).contains("heartRate"))
        XCTAssertThrowsError(try RelayMessage.sample(bpm: 251, timestamp: now))
    }

    func testUnknownWatchIdentifiersStayRejected() {
        XCTAssertNotNil(AppleWatchCatalog.profile(for: "Watch7,8"))
        XCTAssertNil(AppleWatchCatalog.profile(for: "Watch6,14"))
        XCTAssertNil(AppleWatchCatalog.profile(for: "Watch9,1"))
    }

    func testRetailCatalogMatchesAppleFamiliesAndDoesNotMapRuntimeIDs() {
        let expected: [(String, String, Int, Int, String)] = [
            ("A2982", "Apple Watch Series 9", 17, 10, "2023-09-22"),
            ("A2987", "Apple Watch Ultra 2", 17, 10, "2023-09-22"),
            ("A3206", "Apple Watch Series 10", 18, 11, "2024-09-20"),
            ("A3453", "Apple Watch Series 11", 26, 26, "2025-09-19"),
            ("A3327", "Apple Watch SE 3", 26, 26, "2025-09-19"),
            ("A3281", "Apple Watch Ultra 3", 26, 26, "2025-09-19"),
            ("A3588", "Apple Watch Series 12", 27, 27, "2026-09-18"),
            ("A3579", "Apple Watch Ultra 4", 27, 27, "2026-09-18")
        ]
        XCTAssertEqual(AppleWatchRetailCatalog.families.count, 8)
        for (number, name, iOS, watchOS, date) in expected {
            let family = AppleWatchRetailCatalog.family(for: number)
            XCTAssertEqual(family?.name, name)
            XCTAssertEqual(family?.minimumIOS, iOS)
            XCTAssertEqual(family?.minimumWatchOS, watchOS)
            XCTAssertEqual(family?.releaseDate, date)
            XCTAssertNil(AppleWatchCatalog.profile(for: number))
        }
        XCTAssertNil(AppleWatchRetailCatalog.family(for: "Watch7,8"))
    }

    func testSampleGateRequiresValidReadyForCurrentTokenAndOS() {
        var gate = WatchSampleGate()
        XCTAssertFalse(gate.permitsSample(token: "first"))
        XCTAssertNil(gate.acceptReady(token: "first", identifier: "Watch7,8", iOSMajor: 17))
        XCTAssertFalse(gate.permitsSample(token: "first"))
        XCTAssertNotNil(gate.acceptReady(token: "first", identifier: "Watch7,8", iOSMajor: 18))
        XCTAssertTrue(gate.permitsSample(token: "first"))
        XCTAssertFalse(gate.permitsSample(token: "second"))
        XCTAssertNil(gate.acceptReady(token: "first", identifier: "Watch9,1", iOSMajor: 27))
        XCTAssertFalse(gate.permitsSample(token: "first"))
        XCTAssertNotNil(gate.acceptReady(token: "second", identifier: "Watch7,1", iOSMajor: 17))
        XCTAssertEqual(AppleWatchCatalog.profile(for: "Watch7,1")?.minimumWatchOS, 10)
        XCTAssertEqual(AppleWatchCatalog.profile(for: "Watch7,8")?.minimumWatchOS, 11)
        gate.reset()
        XCTAssertFalse(gate.permitsSample(token: "second"))
    }

    private func makeQR(host: String = "192.168.1.12", expiresAt: Int64? = nil) -> String {
        let ticket = Data(repeating: 0x22, count: 32).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let json: [String: Any] = [
            "v": 1, "host": host, "port": 45_678,
            "sessionId": "123e4567-e89b-42d3-a456-426614174000",
            "ticket": ticket, "fingerprint": String(repeating: "a", count: 64),
            "expiresAt": expiresAt ?? now + 60_000
        ]
        let data = try! JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
        return PairingInvite.prefix + data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
