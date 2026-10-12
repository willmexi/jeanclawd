// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "JeanClawd",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "JeanClawd",
            path: "Sources/JeanClawd",
            swiftSettings: [.unsafeFlags(["-swift-version", "5"])]
        ),
    ]
)
