import SwiftUI

@main
struct PELoopWatchApp: App {
    @StateObject private var coordinator = WorkoutCoordinator()

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Text("PELoop 수업 심박").font(.headline)
                Text(coordinator.status).font(.footnote).multilineTextAlignment(.center)
                if coordinator.active {
                    Button("측정 종료", role: .destructive) { coordinator.stop() }
                } else {
                    Text("연결은 페어링 휴대폰에서 시작합니다.").font(.caption2)
                }
            }
            .padding()
        }
    }
}
