import Combine
import Foundation
import Network

@MainActor
final class StudentSessionModel: ObservableObject {
    @Published private(set) var status = "학생·보호자 동의를 확인한 뒤 교사 QR을 스캔하세요."
    @Published private(set) var liveBPM: Int?
    @Published private(set) var active = false
    @Published private(set) var wifiAvailable = false

    private let watch = PhoneWatchBridge()
    private let pathMonitor = NWPathMonitor(requiredInterfaceType: .wifi)
    private let pathQueue = DispatchQueue(label: "com.peloop.studentcompanion.path")
    private var invite: PairingInvite?
    private var relay: RelayClient?
    private var credential: String?
    private var sampleGate = WatchSampleGate()
    private var watchToken: String?
    private var watchStartRequestedToken: String?
    private var serverClockOffset: Int64 = 0
    private var lastSampleTime: Int64 = 0
    private var retryTask: Task<Void, Never>?
    private var staleTask: Task<Void, Never>?
    private var discovery: RelayDiscovery?
    private var retryAttempt = 0
    private var hasUsedPairingTicket = false

    init() {
        watch.onMessage = { [weak self] message in self?.receiveWatchMessage(message) }
        watch.onReachabilityChanged = { [weak self] reachable in
            guard let self else { return }
            if reachable { self.startWatchIfNeeded() }
            else {
                self.watchStartRequestedToken = nil
                self.sampleGate.reset()
                self.liveBPM = nil
            }
        }
        watch.onStartFailure = { [weak self] token in
            guard let self, self.watchToken == token else { return }
            self.watchStartRequestedToken = nil
            self.sampleGate.reset()
            self.liveBPM = nil
            self.status = "Apple Watch 연결이 잠시 끊겨 측정값을 비워 둡니다. 다시 연결되면 측정을 재개합니다."
        }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let available = path.status == .satisfied && path.usesInterfaceType(.wifi)
                let cameBack = available && !self.wifiAvailable
                self.wifiAvailable = available
                if cameBack && self.active && self.relay == nil { self.scheduleReconnect() }
            }
        }
        pathMonitor.start(queue: pathQueue)
    }

    func pair(qr: String, studentConsent: Bool, guardianConsent: Bool) async {
        guard studentConsent && guardianConsent else {
            status = "학생 본인과 보호자의 동의가 모두 확인되어야 연결할 수 있습니다."
            return
        }
        guard wifiAvailable else {
            status = "교사 태블릿과 같은 로컬 Wi-Fi에 연결한 뒤 QR을 스캔해 주세요."
            return
        }
        guard watch.reachable else {
            status = "페어링된 Apple Watch 앱이 연결될 때까지 측정값은 비워 둡니다."
            return
        }
        do {
            let invitation = try PairingInvite(qr: qr)
            stop(clearStatus: false)
            invite = invitation
            credential = invitation.ticket
            active = true
            status = "교사 태블릿에 보안 로컬 연결 중입니다."
            try await connect(host: invitation.host, port: invitation.port)
        } catch {
            stop(clearStatus: false)
            status = error is PairingError ? "교사 연결 QR이 만료되었거나 올바르지 않습니다." : "연결할 수 없습니다. 기록을 비워 두고 교사에게 새 QR을 요청하세요."
        }
    }

    func stop(clearStatus: Bool = true) {
        retryTask?.cancel()
        retryTask = nil
        staleTask?.cancel()
        staleTask = nil
        discovery?.stop()
        discovery = nil
        watch.stop(token: watchToken)
        relay?.close()
        relay = nil
        invite = nil
        credential = nil
        sampleGate.reset()
        watchToken = nil
        watchStartRequestedToken = nil
        lastSampleTime = 0
        liveBPM = nil
        active = false
        hasUsedPairingTicket = false
        if clearStatus { status = "수업 연결을 종료했습니다. 측정 기록은 저장하지 않았습니다." }
    }

    private func connect(host: String, port: Int) async throws {
        guard let invite, let credential else { throw RelayClientError.notConnected }
        let client = RelayClient(invite: invite, host: host, port: port)
        client.onDisconnect = { [weak self, weak client] in
            Task { @MainActor in
                guard let self, let client, self.relay === client, self.active else { return }
                self.handleDisconnect()
            }
        }
        relay = client
        let (ack, phoneTime) = try await client.connect(credential: credential)
        if hasUsedPairingTicket {
            guard ack.resumeToken == nil else { throw PairingError.invalidAcknowledgement }
        } else if let nextToken = ack.resumeToken {
            self.credential = nextToken
            hasUsedPairingTicket = true
        } else {
            throw PairingError.invalidAcknowledgement
        }
        serverClockOffset = ack.serverTime - phoneTime
        retryAttempt = 0
        lastSampleTime = 0
        liveBPM = nil
        status = "워치 심박 준비를 기다립니다. 새 측정값이 없으면 기록은 비워 둡니다."
        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        sampleGate.reset()
        watchToken = token
        watchStartRequestedToken = nil
        startWatchIfNeeded()
    }

    private func receiveWatchMessage(_ message: PhoneWatchMessage) {
        guard active, message.sessionToken == watchToken, let relay else { return }
        switch message.kind {
        case let .ready(hardwareIdentifier):
            liveBPM = nil
            staleTask?.cancel()
            guard let profile = sampleGate.acceptReady(token: message.sessionToken, identifier: hardwareIdentifier, iOSMajor: ProcessInfo.processInfo.operatingSystemVersion.majorVersion) else {
                status = "이 Apple Watch 모델 또는 iOS 버전은 측정 후보 조건에 맞지 않아 측정값을 비워 둡니다."
                sendStatus("disconnected", using: relay)
                return
            }
            Task { [weak self, weak relay] in
                guard let self, let relay,
                      let frame = try? RelayMessage.deviceReady(model: profile.displayName, releaseDate: profile.releaseDate) else { return }
                do { try await relay.send(frame) }
                catch { self.handleDisconnect() }
            }
            status = "워치 심박 센서를 기다립니다. 측정값이 없으면 기록은 비워 둡니다."
        case let .sample(bpm, timestamp):
            guard sampleGate.permitsSample(token: message.sessionToken), timestamp > lastSampleTime else { return }
            lastSampleTime = timestamp
            let receivedAt = Int64(Date().timeIntervalSince1970 * 1_000)
            guard abs(receivedAt - timestamp) <= 5_000 else { return }
            let translated = receivedAt + serverClockOffset
            guard translated > 0 else { return }
            let displayed = Int(bpm.rounded())
            liveBPM = displayed
            status = "수업 중 심박 측정 중입니다."
            staleTask?.cancel()
            staleTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled, let self, self.liveBPM == displayed else { return }
                self.liveBPM = nil
                self.status = "새 심박 측정값이 없어 기록을 비워 둡니다."
            }
            Task { [weak relay] in
                guard let relay, let frame = try? RelayMessage.sample(bpm: bpm, timestamp: translated) else { return }
                do { try await relay.send(frame) }
                catch { }
            }
        case let .unsupported(model):
            sampleGate.reset()
            liveBPM = nil
            status = "지원 후보에 없는 Apple Watch(\(model))입니다. 측정값은 비워 둡니다."
            sendStatus("disconnected", using: relay)
        case .unavailable:
            sampleGate.reset()
            liveBPM = nil
            status = "HealthKit 운동 세션을 시작하지 못했습니다. 측정값은 비워 둡니다."
            sendStatus("permission-unavailable", using: relay)
        case .disconnected:
            sampleGate.reset()
            liveBPM = nil
            status = "워치 연결이 끊겨 측정값을 비워 두었습니다."
            sendStatus("disconnected", using: relay)
        }
    }

    private func handleDisconnect() {
        guard active else { return }
        relay?.close()
        relay = nil
        watch.stop(token: watchToken)
        sampleGate.reset()
        watchToken = nil
        watchStartRequestedToken = nil
        liveBPM = nil
        staleTask?.cancel()
        staleTask = nil
        status = "로컬 Wi-Fi가 끊겨 측정 공백입니다. 연결이 복구되면 다시 찾습니다."
        if wifiAvailable { scheduleReconnect() }
    }

    private func startWatchIfNeeded() {
        guard active, relay != nil, watch.reachable,
              let token = watchToken, watchStartRequestedToken != token else { return }
        do {
            try watch.start(token: token)
            watchStartRequestedToken = token
            status = "Apple Watch 심박 측정 준비를 기다립니다. 새 값이 없으면 기록은 비워 둡니다."
        } catch {
            watchStartRequestedToken = nil
            status = "Apple Watch 연결을 확인할 수 없습니다. 수업은 계속되고 측정값은 비워 둡니다."
        }
    }

    private func sendStatus(_ type: String, using relay: RelayClient) {
        guard let frame = try? RelayMessage.status(type) else { return }
        Task { try? await relay.send(frame) }
    }

    private func scheduleReconnect() {
        guard active, retryTask == nil else { return }
        let wait = min(15, 1 << min(retryAttempt, 4))
        retryAttempt += 1
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Double(wait)))
            guard !Task.isCancelled, let self, self.active, self.relay == nil else { return }
            self.retryTask = nil
            await self.reconnect()
        }
    }

    private func reconnect() async {
        guard wifiAvailable, let invite, let credential else { return }
        do {
            try await connect(host: invite.host, port: invite.port)
        } catch {
            relay?.close()
            relay = nil
            liveBPM = nil
            discoverChangedHost(invite: invite, credential: credential)
        }
    }

    private func discoverChangedHost(invite: PairingInvite, credential: String) {
        status = "태블릿 IP가 바뀌었는지 로컬 Wi-Fi에서 찾습니다."
        let search = RelayDiscovery(sessionID: invite.sessionID, fingerprint: invite.fingerprint) { [weak self] host, port in
            Task { @MainActor in
                guard let self, self.active else { return }
                self.discovery = nil
                guard let host, port > 0 else {
                    self.stop(clearStatus: false)
                    self.status = "태블릿을 찾지 못했습니다. 교사에게 새 연결 QR을 요청해 주세요."
                    return
                }
                do { try await self.connect(host: host, port: port) }
                catch {
                    self.relay?.close()
                    self.relay = nil
                    self.stop(clearStatus: false)
                    self.status = "태블릿 연결을 복구하지 못했습니다. 교사에게 새 연결 QR을 요청해 주세요."
                }
            }
        }
        discovery = search
        search.start()
    }
}
