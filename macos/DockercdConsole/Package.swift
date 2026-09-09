// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DockercdConsole",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "DockercdConsole", targets: ["DockercdConsole"])
    ],
    targets: [
        .executableTarget(name: "DockercdConsole"),
        .testTarget(name: "DockercdConsoleTests", dependencies: ["DockercdConsole"])
    ]
)
