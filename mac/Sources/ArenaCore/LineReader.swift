import Foundation

/// Reads complete lines appended to a file since a byte offset, in bounded
/// chunks so a large backlog never has to fit in memory at once.
public enum LineReader {

    public struct Chunk {
        public var lines: [Data]
        /// Offset just past the last complete line consumed.
        public var newOffset: Int64
        /// True when nothing complete is left to read after `newOffset`.
        public var reachedEnd: Bool
    }

    public static let defaultChunkBytes = 4 * 1024 * 1024
    static let newline = UInt8(ascii: "\n")

    /// Reads up to `maxBytes` from `offset`. A trailing partial line is left
    /// for the next call. A single line longer than `maxBytes` is skipped.
    public static func read(path: String, from offset: Int64, maxBytes: Int = defaultChunkBytes) throws -> Chunk {
        let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
        defer { try? handle.close() }
        let size = Int64(try handle.seekToEnd())
        guard offset < size else { return Chunk(lines: [], newOffset: offset, reachedEnd: true) }

        try handle.seek(toOffset: UInt64(offset))
        let data = try handle.read(upToCount: maxBytes) ?? Data()
        guard let lastNewline = data.lastIndex(of: newline) else {
            let atEnd = offset + Int64(data.count) >= size
            if atEnd { return Chunk(lines: [], newOffset: offset, reachedEnd: true) }
            // Oversized line: skip to just past its end.
            let skipTo = try offsetAfterNextNewline(handle: handle, from: offset + Int64(data.count), size: size)
            return Chunk(lines: [], newOffset: skipTo ?? offset, reachedEnd: skipTo == nil)
        }

        var lines: [Data] = []
        var start = data.startIndex
        while start <= lastNewline, let end = data[start...lastNewline].firstIndex(of: newline) {
            if end > start { lines.append(data[start..<end]) }
            start = end + 1
        }
        let consumed = Int64(lastNewline - data.startIndex + 1)
        let newOffset = offset + consumed
        return Chunk(lines: lines, newOffset: newOffset, reachedEnd: newOffset >= size)
    }

    private static func offsetAfterNextNewline(handle: FileHandle, from start: Int64, size: Int64) throws -> Int64? {
        var position = start
        try handle.seek(toOffset: UInt64(position))
        while position < size {
            guard let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty else { return nil }
            if let index = data.firstIndex(of: newline) {
                return position + Int64(index - data.startIndex) + 1
            }
            position += Int64(data.count)
        }
        return nil
    }
}
