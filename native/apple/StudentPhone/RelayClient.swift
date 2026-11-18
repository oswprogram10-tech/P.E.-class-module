import Foundation

@MainActor
final class RelayClient: NSObject {
    private let invite: PairingInvite
    private let tlsDelegate: RelayTLSDelegate
    private var session: URLSession!
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    var onDisconnect: (() -> Void)?

    init(invite: PairingInvite, host: String? = nil, port: Int? = nil) {
        self.invite = invite
        self.tlsDelegate = RelayTLSDelegate(expectedFingerprint: invite.fingerprint)
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration, delegate: tlsDelegate, delegateQueue: nil)
        if let host, let port { overrideEndpoint = (host, port) }
    }

    private var overrideEndpoint: (String, Int)?

    func connect(credential: String) async throws -> (RelayAcknowledgement, Int64) {
        var components = URLComponents()
        components.scheme = "wss"
        components.host = overrideEndpoint?.0 ?? invite.host
        components.port = overrideEndpoint?.1 ?? invite.port
        components.path = "/wearable/v1"
        guard let url = components.url else { throw RelayClientError.invalidAddress }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        socket = task
        task.resume()
        let message = try await withThrowingTaskGroup(of: URLSessionWebSocketTask.Message.self) { group in
            group.addTask { try await task.receive() }
            group.addTask {
                try await Task.sleep(for: .seconds(8))
                throw RelayClientError.acknowledgementTimeout
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else { throw RelayClientError.acknowledgementTimeout }
            return first
        }
        guard case let .string(text) = message else { throw PairingError.invalidAcknowledgement }
        let phoneTimeAtAck = Int64(Date().timeIntervalSince1970 * 1_000)
        let acknowledgement = try RelayAcknowledgement.parse(text, expectedSessionID: invite.sessionID)
        receiveTask = Task { [weak self] in await self?.monitorSocket(task) }
        return (acknowledgement, phoneTimeAtAck)
    }

    func send(_ message: String) async throws {
        guard let socket else { throw RelayClientError.notConnected }
        try await socket.send(.string(message))
    }

    func close() {
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session.invalidateAndCancel()
    }

    private func monitorSocket(_ task: URLSessionWebSocketTask) async {
        do {
            while !Task.isCancelled {
                let message = try await task.receive()
                // The relay sends only its first acknowledgement. Any later server frame is a protocol violation.
                if case .string = message { task.cancel(with: .protocolError, reason: nil) }
                onDisconnect?()
                return
            }
        } catch {
            guard !Task.isCancelled else { return }
            onDisconnect?()
        }
    }
}

enum RelayClientError: Error { case invalidAddress, notConnected, acknowledgementTimeout }
