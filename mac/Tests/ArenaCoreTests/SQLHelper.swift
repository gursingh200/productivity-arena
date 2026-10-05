import Foundation
import SQLite3

/// Builds fixture databases for the app-database readers.
func runSQL(_ path: String, _ sql: String) throws {
    var db: OpaquePointer?
    guard sqlite3_open(path, &db) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
    defer { sqlite3_close(db) }
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
}
