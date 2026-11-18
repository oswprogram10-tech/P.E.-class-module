import SwiftUI
import VisionKit

struct PairingQRScanner: UIViewControllerRepresentable {
    let onPayload: (String) -> Void
    let onFailure: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPayload: onPayload, onFailure: onFailure) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        guard DataScannerViewController.isSupported && DataScannerViewController.isAvailable else {
            context.coordinator.fail("이 기기에서 실시간 QR 스캔을 사용할 수 없습니다.")
            return scanner
        }
        do { try scanner.startScanning() }
        catch { context.coordinator.fail("카메라 권한 또는 스캔을 확인해 주세요.") }
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) { }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onPayload: (String) -> Void
        private let onFailure: (String) -> Void
        private var delivered = false
        private var failed = false

        init(onPayload: @escaping (String) -> Void, onFailure: @escaping (String) -> Void) {
            self.onPayload = onPayload
            self.onFailure = onFailure
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !delivered,
                  let payload = addedItems.compactMap({ item -> String? in
                      guard case let .barcode(barcode) = item else { return nil }
                      return barcode.payloadStringValue
                  }).first else { return }
            delivered = true
            dataScanner.stopScanning()
            onPayload(payload)
        }

        func fail(_ message: String) {
            guard !failed else { return }
            failed = true
            let handler = onFailure
            DispatchQueue.main.async { handler(message) }
        }
    }
}
