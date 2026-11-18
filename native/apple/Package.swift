// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PELoopAppleCore",
    platforms: [.iOS(.v16), .watchOS(.v9), .macOS(.v13)],
    products: [.library(name: "PELoopAppleCore", targets: ["PELoopAppleCore"])],
    targets: [
        .target(name: "PELoopAppleCore", path: "Shared"),
        .testTarget(name: "PELoopAppleCoreTests", dependencies: ["PELoopAppleCore"], path: "Tests")
    ]
)
