import Foundation
import Darwin

enum WatchModelIdentifier {
    static func current() -> String? {
        var size = 0
        guard sysctlbyname("hw.machine", nil, &size, nil, 0) == 0, size > 0, size < 128 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname("hw.machine", &buffer, &size, nil, 0) == 0 else { return nil }
        return String(cString: buffer)
    }
}
