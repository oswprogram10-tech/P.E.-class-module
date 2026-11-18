import CryptoKit
import CoreFoundation
import Foundation
import Security

final class RelayTLSDelegate: NSObject, URLSessionDelegate {
    let expectedFingerprint: String

    init(expectedFingerprint: String) { self.expectedFingerprint = expectedFingerprint.lowercased() }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let certificate = SecTrustGetCertificateAtIndex(trust, 0),
              let publicKeyInfo = try? Self.subjectPublicKeyInfo(from: SecCertificateCopyData(certificate) as Data),
              SHA256.hash(data: publicKeyInfo).map({ String(format: "%02x", $0) }).joined() == expectedFingerprint,
              // The ephemeral certificate is pinned by its SPKI, so the local IP/DNS name is not its identity.
              SecTrustSetPolicies(trust, SecPolicyCreateBasicX509()) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [certificate] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustEvaluateWithError(trust, nil) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    private static func subjectPublicKeyInfo(from certificate: Data) throws -> Data {
        guard certificate.count <= 32_768 else { throw PinError.invalidCertificate }
        let bytes = [UInt8](certificate)
        let root = try DERNode.read(bytes, at: 0)
        guard root.tag == 0x30 else { throw PinError.invalidCertificate }
        let certificateParts = try DERNode.children(bytes, of: root)
        guard certificateParts.count == 3, certificateParts[0].tag == 0x30 else { throw PinError.invalidCertificate }
        let tbs = try DERNode.children(bytes, of: certificateParts[0])
        let hasVersion = tbs.first?.tag == 0xa0
        let spkiIndex = hasVersion ? 6 : 5
        guard tbs.count > spkiIndex, tbs[spkiIndex].tag == 0x30 else { throw PinError.invalidCertificate }
        let spki = tbs[spkiIndex]
        let encoded = Data(bytes[spki.fullRange])
        guard !encoded.isEmpty else { throw PinError.invalidCertificate }
        return encoded
    }
}

private enum PinError: Error { case invalidCertificate }

private struct DERNode {
    let tag: UInt8
    let fullRange: Range<Int>
    let valueRange: Range<Int>

    static func read(_ bytes: [UInt8], at offset: Int) throws -> DERNode {
        guard offset + 2 <= bytes.count else { throw PinError.invalidCertificate }
        let tag = bytes[offset]
        let firstLength = Int(bytes[offset + 1])
        let header: Int
        let length: Int
        if firstLength & 0x80 == 0 {
            header = 2
            length = firstLength
        } else {
            let count = firstLength & 0x7f
            guard count > 0, count <= 4, offset + 2 + count <= bytes.count else { throw PinError.invalidCertificate }
            header = 2 + count
            length = bytes[(offset + 2)..<(offset + 2 + count)].reduce(0) { ($0 << 8) | Int($1) }
        }
        let valueStart = offset + header
        let end = valueStart + length
        guard end <= bytes.count else { throw PinError.invalidCertificate }
        return DERNode(tag: tag, fullRange: offset..<end, valueRange: valueStart..<end)
    }

    static func children(_ bytes: [UInt8], of parent: DERNode) throws -> [DERNode] {
        var result: [DERNode] = []
        var offset = parent.valueRange.lowerBound
        while offset < parent.valueRange.upperBound {
            let node = try read(bytes, at: offset)
            guard node.fullRange.upperBound <= parent.valueRange.upperBound else { throw PinError.invalidCertificate }
            result.append(node)
            offset = node.fullRange.upperBound
        }
        guard offset == parent.valueRange.upperBound else { throw PinError.invalidCertificate }
        return result
    }
}
