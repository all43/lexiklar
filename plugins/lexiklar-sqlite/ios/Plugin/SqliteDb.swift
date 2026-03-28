import Foundation
import SQLite3

/// Minimal SQLite wrapper using the system sqlite3 C library (built into iOS).
public class SqliteDb {
    private var db: OpaquePointer?

    public init() {}

    /// Open a database at the given file path.
    public func open(path: String, readOnly: Bool = false) throws {
        let flags = readOnly
            ? SQLITE_OPEN_READONLY
            : SQLITE_OPEN_READWRITE
        let rc = sqlite3_open_v2(path, &db, flags, nil)
        if rc != SQLITE_OK {
            let msg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "Unknown error"
            sqlite3_close(db)
            db = nil
            throw SqliteError.openFailed(message: msg, code: rc)
        }
    }

    /// Execute a SELECT query with bind parameters, returning rows as dictionaries.
    public func query(sql: String, params: [Any?] = []) throws -> [[String: Any?]] {
        guard let db = db else { throw SqliteError.notOpen }

        var stmt: OpaquePointer?
        let rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nil)
        if rc != SQLITE_OK {
            let msg = String(cString: sqlite3_errmsg(db))
            throw SqliteError.prepareFailed(message: msg, code: rc)
        }
        defer { sqlite3_finalize(stmt) }

        // Bind parameters
        for (i, param) in params.enumerated() {
            let idx = Int32(i + 1)
            try bindValue(stmt: stmt!, index: idx, value: param)
        }

        // Collect results
        var rows: [[String: Any?]] = []
        let colCount = sqlite3_column_count(stmt)

        while sqlite3_step(stmt) == SQLITE_ROW {
            var row: [String: Any?] = [:]
            for col in 0..<colCount {
                let name = String(cString: sqlite3_column_name(stmt, col))
                row[name] = columnValue(stmt: stmt!, col: col)
            }
            rows.append(row)
        }
        return rows
    }

    /// Execute one or more SQL statements (non-query). Returns total changes.
    public func execute(sql: String, transaction: Bool = true) throws -> Int {
        guard let db = db else { throw SqliteError.notOpen }

        var errmsg: UnsafeMutablePointer<CChar>?

        if transaction {
            sqlite3_exec(db, "BEGIN TRANSACTION", nil, nil, nil)
        }

        let rc = sqlite3_exec(db, sql, nil, nil, &errmsg)
        if rc != SQLITE_OK {
            let msg = errmsg.map { String(cString: $0) } ?? "Unknown error"
            sqlite3_free(errmsg)
            if transaction {
                sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
            }
            throw SqliteError.execFailed(message: msg, code: rc)
        }
        sqlite3_free(errmsg)

        if transaction {
            sqlite3_exec(db, "COMMIT", nil, nil, nil)
        }

        return Int(sqlite3_changes(db))
    }

    /// Close the database connection.
    public func close() {
        if let db = db {
            sqlite3_close(db)
        }
        db = nil
    }

    deinit {
        close()
    }

    // MARK: - Private helpers

    private func bindValue(stmt: OpaquePointer, index: Int32, value: Any?) throws {
        let rc: Int32
        switch value {
        case nil:
            rc = sqlite3_bind_null(stmt, index)
        case let v as String:
            rc = sqlite3_bind_text(stmt, index, (v as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        case let v as Int:
            rc = sqlite3_bind_int64(stmt, index, Int64(v))
        case let v as Int64:
            rc = sqlite3_bind_int64(stmt, index, v)
        case let v as Double:
            rc = sqlite3_bind_double(stmt, index, v)
        case let v as NSNumber:
            rc = sqlite3_bind_double(stmt, index, v.doubleValue)
        default:
            // Treat as text
            rc = sqlite3_bind_text(stmt, index, "\(value!)", -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        if rc != SQLITE_OK {
            throw SqliteError.bindFailed(index: Int(index), code: rc)
        }
    }

    private func columnValue(stmt: OpaquePointer, col: Int32) -> Any? {
        switch sqlite3_column_type(stmt, col) {
        case SQLITE_NULL:
            return nil
        case SQLITE_INTEGER:
            return Int(sqlite3_column_int64(stmt, col))
        case SQLITE_FLOAT:
            return sqlite3_column_double(stmt, col)
        case SQLITE_TEXT:
            return String(cString: sqlite3_column_text(stmt, col))
        case SQLITE_BLOB:
            if let ptr = sqlite3_column_blob(stmt, col) {
                let size = Int(sqlite3_column_bytes(stmt, col))
                return Data(bytes: ptr, count: size)
            }
            return nil
        default:
            return nil
        }
    }
}

public enum SqliteError: Error, LocalizedError {
    case notOpen
    case openFailed(message: String, code: Int32)
    case prepareFailed(message: String, code: Int32)
    case execFailed(message: String, code: Int32)
    case bindFailed(index: Int, code: Int32)

    public var errorDescription: String? {
        switch self {
        case .notOpen:
            return "Database is not open"
        case .openFailed(let msg, let code):
            return "Failed to open database (rc=\(code)): \(msg)"
        case .prepareFailed(let msg, let code):
            return "Failed to prepare statement (rc=\(code)): \(msg)"
        case .execFailed(let msg, let code):
            return "Failed to execute SQL (rc=\(code)): \(msg)"
        case .bindFailed(let idx, let code):
            return "Failed to bind parameter at index \(idx) (rc=\(code))"
        }
    }
}
