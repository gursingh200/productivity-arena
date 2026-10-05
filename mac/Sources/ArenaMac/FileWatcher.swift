import Foundation
import CoreServices

/// Watches a set of directories for file changes using FSEvents.
/// Latency: 5 seconds (batched). Used to trigger incremental JSONL reads.
public final class FileWatcher {

    public var paths: [String]
    public var onEvent: (([String]) -> Void)?

    private var stream: FSEventStreamRef?

    public static let defaultLatency: CFTimeInterval = 5.0

    public init(paths: [String]) {
        self.paths = paths
    }

    public func start() {
        guard !paths.isEmpty else { return }

        let ctx = Unmanaged.passRetained(self)

        var context = FSEventStreamContext(
            version: 0,
            info: ctx.toOpaque(),
            retain: nil,
            release: { ptr in
                guard let p = ptr else { return }
                Unmanaged<FileWatcher>.fromOpaque(p).release()
            },
            copyDescription: nil
        )

        let flags = UInt32(
            kFSEventStreamCreateFlagUseCFTypes |
            kFSEventStreamCreateFlagFileEvents |
            kFSEventStreamCreateFlagNoDefer
        )

        stream = FSEventStreamCreate(
            nil,
            { _, info, numEvents, eventPaths, _, _ in
                guard let info = info else { return }
                let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()
                // eventPaths is a CFArray of CFString when kFSEventStreamCreateFlagUseCFTypes
                // is set; bridge through CFArray → NSArray → [String].
                let cfArray = unsafeBitCast(eventPaths, to: CFArray.self)
                guard let nsArray = cfArray as? [String] else { return }
                let paths = Array(nsArray.prefix(numEvents))
                watcher.onEvent?(paths)
            },
            &context,
            paths as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            Self.defaultLatency,
            flags
        )

        if let stream = stream {
            FSEventStreamSetDispatchQueue(stream, .main)
            FSEventStreamStart(stream)
        }
    }

    public func stop() {
        if let stream = stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
        }
    }

    deinit { stop() }
}
