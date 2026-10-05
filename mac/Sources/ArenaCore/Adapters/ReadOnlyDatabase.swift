import Foundation
import SQLite3

/// Opens another app's SQLite database strictly read-only and closes it when
/// done. Never writes, never holds the file open between scans.
struct ReadOnlyDatabase {

    /// Runs `body` for every row of `sql`. Returns false if the database could
    /// not be opened or the query failed (e.g. the app changed its schema).
    static func eachRow(path: String, sql: String, bind: [Int64] = [], _ body: (OpaquePointer) -> Void) -> Bool {
        guard FileManager.default.fileExists(atPath: path) else { return false }
        var db: OpaquePointer?
        let uri = URL(fileURLWithPath: path).absoluteString + "?mode=ro"
        guard sqlite3_open_v2(uri, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nil) == SQLITE_OK, let db else {
            sqlite3_close(db)
            return false
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 200)

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { return false }
        defer { sqlite3_finalize(stmt) }
        for (i, value) in bind.enumerated() { sqlite3_bind_int64(stmt, Int32(i + 1), value) }

        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { return true }
            guard rc == SQLITE_ROW else { return false }
            body(stmt)
        }
    }

    static func text(_ stmt: OpaquePointer, _ col: Int32) -> String? {
        sqlite3_column_text(stmt, col).map { String(cString: $0) }
    }
}

/// Events for several sessions, as read from an app database.
public typealias SessionEvents = [String: [AgentEvent]]
