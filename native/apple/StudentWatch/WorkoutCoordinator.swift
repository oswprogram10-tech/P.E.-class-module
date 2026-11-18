import Foundation
import Combine
import HealthKit
import WatchConnectivity
import WatchKit

@MainActor
final class WorkoutCoordinator: NSObject, ObservableObject {
    @Published private(set) var status = "휴대폰에서 동의 후 수업 연결을 시작하세요."
    @Published private(set) var active = false

    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    private var sessionToken: String?
    private var stopping = false
    private let watchSession: WCSession? = WCSession.isSupported() ? .default : nil

    override init() {
        super.init()
        watchSession?.delegate = self
        watchSession?.activate()
    }

    func handlePhoneMessage(_ message: [String: Any]) {
        guard let type = message["type"] as? String else { return }
        if type == "stop" {
            guard Set(message.keys) == ["type", "sessionToken"],
                  message["sessionToken"] as? String == sessionToken else { return }
            stop(notifyPhone: false)
            return
        }
        guard type == "start", Set(message.keys) == ["type", "sessionToken"],
              let token = message["sessionToken"] as? String,
              token.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil else { return }
        Task { await start(token: token) }
    }

    func stop(notifyPhone: Bool = true) {
        if notifyPhone, let token = sessionToken { sendPhone(["type": "disconnected", "sessionToken": token]) }
        Task { await endCurrentWorkout() }
    }

    private func start(token: String) async {
        await endCurrentWorkout()
        guard HKHealthStore.isHealthDataAvailable(), HKWorkoutSession.isSupported() else {
            status = "이 Apple Watch에서 수업 중 심박 세션을 사용할 수 없습니다."
            sendPhone(["type": "unsupported", "sessionToken": token])
            return
        }
        guard let identifier = WatchModelIdentifier.current(),
              let profile = AppleWatchCatalog.profile(for: identifier) else {
            status = "이 Watch 모델은 출시일 확인 목록에 없어 측정을 시작하지 않았습니다."
            sendPhone(["type": "unsupported", "sessionToken": token, "model": WatchModelIdentifier.current() ?? "unknown"])
            return
        }
        guard ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= profile.minimumWatchOS else {
            status = "이 Watch의 watchOS 버전은 측정 후보의 최소 버전보다 낮습니다."
            sendPhone(["type": "unsupported", "sessionToken": token, "model": identifier])
            return
        }
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            status = "심박 측정 항목을 사용할 수 없습니다."
            sendPhone(["type": "unavailable", "sessionToken": token])
            return
        }
        do {
            try await healthStore.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartRateType])
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .other
            configuration.locationType = .unknown
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
            sessionToken = token
            workoutSession = session
            workoutBuilder = builder
            session.delegate = self
            builder.delegate = self
            let start = Date()
            session.startActivity(with: start)
            try await builder.beginCollection(at: start)
            active = true
            status = "수업 심박 측정을 기다리는 중입니다. 측정값은 휴대폰으로만 보냅니다."
            sendPhone(["type": "ready", "sessionToken": token, "hardwareIdentifier": profile.hardwareIdentifier, "heartRateAvailable": true])
        } catch {
            status = "워치 운동 세션을 시작하지 못했습니다. 측정값은 비워 둡니다."
            sendPhone(["type": "unavailable", "sessionToken": token])
            clearSession()
        }
    }

    private func sendHeartRate(_ quantity: HKQuantity, at date: Date) {
        guard active, let token = sessionToken else { return }
        let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        guard bpm.isFinite, (20...250).contains(bpm) else { return }
        sendPhone(["type": "sample", "sessionToken": token, "bpm": bpm, "timestamp": Int64(date.timeIntervalSince1970 * 1_000)])
    }

    private func sendPhone(_ message: [String: Any]) {
        guard let watchSession, watchSession.activationState == .activated, watchSession.isReachable else {
            status = "페어링 휴대폰에 연결되지 않았습니다. 측정값은 전달하지 않습니다."
            return
        }
        watchSession.sendMessage(message, replyHandler: nil) { [weak self] _ in
            Task { @MainActor in self?.status = "휴대폰 연결이 끊겨 측정값을 전달하지 못했습니다." }
        }
    }

    private func clearSession() {
        active = false
        sessionToken = nil
        workoutSession = nil
        workoutBuilder = nil
        status = "수업 심박 세션을 종료했습니다. 운동 기록은 저장하지 않았습니다."
    }

    private func endCurrentWorkout() async {
        guard !stopping else { return }
        guard let currentSession = workoutSession else {
            clearSession()
            return
        }
        stopping = true
        defer { stopping = false }
        let currentBuilder = workoutBuilder
        currentSession.end()
        if let currentBuilder {
            _ = try? await currentBuilder.endCollection(at: Date())
            await currentBuilder.discardWorkout()
        }
        if workoutSession === currentSession { clearSession() }
    }
}

extension WorkoutCoordinator: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor [weak self] in self?.handlePhoneMessage(message) }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard !session.isReachable else { return }
        Task { @MainActor [weak self] in
            guard let self, self.active else { return }
            self.status = "휴대폰 연결이 끊겨 심박 측정을 멈췄습니다. 기록은 비워 둡니다."
            self.stop(notifyPhone: false)
        }
    }
}

extension WorkoutCoordinator: HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        if toState == .ended { Task { @MainActor [weak self] in self?.clearSession() } }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            self?.status = "워치 심박 측정 연결이 끊겼습니다. 측정값은 비워 둡니다."
            if let token = self?.sessionToken { self?.sendPhone(["type": "disconnected", "sessionToken": token]) }
            self?.clearSession()
        }
    }

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        guard let type = HKObjectType.quantityType(forIdentifier: .heartRate), types.contains(type),
              let statistics = workoutBuilder.statistics(for: type),
              let quantity = statistics.mostRecentQuantity(),
              let date = statistics.mostRecentQuantityDateInterval()?.end else { return }
        Task { @MainActor [weak self] in self?.sendHeartRate(quantity, at: date) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) { }
}
