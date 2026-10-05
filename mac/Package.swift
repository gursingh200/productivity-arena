// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Arena",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ArenaCore", targets: ["ArenaCore"]),
        .library(name: "ArenaMac", targets: ["ArenaMac"]),
        .executable(name: "Arena", targets: ["Arena"]),
        .executable(name: "arena-debug", targets: ["ArenaDebug"]),
        .executable(name: "arena-sign", targets: ["ArenaSign"]),
    ],
    targets: [
        .target(
            name: "ArenaCore",
            dependencies: [],
            path: "Sources/ArenaCore",
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .target(
            name: "ArenaMac",
            dependencies: ["ArenaCore"],
            path: "Sources/ArenaMac"
        ),
        .executableTarget(
            name: "Arena",
            dependencies: ["ArenaCore", "ArenaMac"],
            path: "Sources/Arena"
        ),
        .executableTarget(
            name: "ArenaDebug",
            dependencies: ["ArenaCore"],
            path: "Sources/ArenaDebug",
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .executableTarget(
            name: "ArenaSign",
            dependencies: [],
            path: "Sources/ArenaSign"
        ),
        .testTarget(
            name: "ArenaCoreTests",
            dependencies: ["ArenaCore"],
            path: "Tests/ArenaCoreTests"
        ),
    ]
)
