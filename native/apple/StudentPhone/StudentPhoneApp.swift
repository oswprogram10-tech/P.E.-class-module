import SwiftUI

@main
struct PELoopStudentPhoneApp: App {
    @StateObject private var model = StudentSessionModel()

    var body: some Scene {
        WindowGroup { StudentHomeView(model: model) }
    }
}

private struct StudentHomeView: View {
    @ObservedObject var model: StudentSessionModel
    @State private var studentConsent = false
    @State private var guardianConsent = false
    @State private var showScanner = false
    @State private var scannerError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("PELoop 학생 심박 연결").font(.title2.bold())
                    Text("이번 수업에서 심박수만 실시간으로 전달합니다. 측정값은 수업 화면에만 표시되고 저장하거나 연결이 끊긴 동안 다시 보내지 않습니다.")
                        .font(.body)
                    Toggle("학생 본인이 이번 수업의 심박 측정에 동의합니다.", isOn: $studentConsent)
                    Toggle("보호자 동의가 학교에 제출되어 확인되었습니다.", isOn: $guardianConsent)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("연결 상태").font(.headline)
                        Text(model.status).font(.callout)
                        Text(model.liveBPM.map { "\($0) bpm" } ?? "— bpm")
                            .font(.system(size: 42, weight: .semibold, design: .rounded))
                            .accessibilityLabel(model.liveBPM.map { "심박수 \($0) bpm" } ?? "측정값 없음")
                    }
                    Button("교사 태블릿 QR 스캔") { showScanner = true }
                        .buttonStyle(.borderedProminent)
                        .disabled(!studentConsent || !guardianConsent || model.active)
                    Button("수업 연결 종료", role: .destructive) { model.stop() }
                        .disabled(!model.active)
                    Text("학생·보호자 동의가 없거나 연결이 실패해도 수업은 계속됩니다. 이 화면의 심박값은 5초 동안 새 표본이 없으면 사라집니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("수업 중에는 이 앱을 열어 두세요. iOS가 백그라운드 앱의 로컬 연결을 중지하면 화면에는 측정 공백이 표시됩니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("학생 앱")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: studentConsent) { value in if !value && model.active { model.stop() } }
            .onChange(of: guardianConsent) { value in if !value && model.active { model.stop() } }
            .sheet(isPresented: $showScanner) {
                PairingQRScanner(onPayload: { payload in
                    showScanner = false
                    Task { await model.pair(qr: payload, studentConsent: studentConsent, guardianConsent: guardianConsent) }
                }, onFailure: { message in
                    scannerError = message
                    showScanner = false
                }).ignoresSafeArea()
            }
            .alert("QR 스캔을 사용할 수 없습니다", isPresented: Binding(get: { scannerError != nil }, set: { if !$0 { scannerError = nil } })) {
                Button("확인", role: .cancel) { scannerError = nil }
            } message: { Text(scannerError ?? "") }
        }
    }
}
