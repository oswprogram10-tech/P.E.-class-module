import Foundation

final class RelayDiscovery: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let sessionID: String
    private let fingerprint: String
    private let completion: (String?, Int) -> Void
    private let browser = NetServiceBrowser()
    private var candidates: [NetService] = []
    private var finished = false

    init(sessionID: String, fingerprint: String, completion: @escaping (String?, Int) -> Void) {
        self.sessionID = sessionID.lowercased()
        self.fingerprint = fingerprint.lowercased()
        self.completion = completion
        super.init()
        browser.delegate = self
    }

    func start() {
        browser.searchForServices(ofType: "_peloop-wearable._tcp.", inDomain: "local.")
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in self?.finish(host: nil, port: 0) }
    }

    func stop() { finish(host: nil, port: 0) }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard let data = service.txtRecordData() else { return }
        let record = NetService.dictionary(fromTXTRecord: data)
        let serviceID = record["sid"].flatMap { String(data: $0, encoding: .utf8) }?.lowercased()
        let serviceFingerprint = record["fp"].flatMap { String(data: $0, encoding: .utf8) }?.lowercased()
        guard serviceID == sessionID, serviceFingerprint == fingerprint else { return }
        candidates.append(service)
        service.delegate = self
        service.resolve(withTimeout: 5)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        let host = sender.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard let host, !host.isEmpty, host.count <= 253, sender.port > 1_023, sender.port <= 65_535 else { return }
        finish(host: host, port: sender.port)
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) { }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) { finish(host: nil, port: 0) }

    private func finish(host: String?, port: Int) {
        guard !finished else { return }
        finished = true
        browser.stop()
        candidates.forEach { $0.stop() }
        completion(host, port)
    }
}
