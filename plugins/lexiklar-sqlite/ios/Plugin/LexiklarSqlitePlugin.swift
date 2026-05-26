import Foundation
import Capacitor

@objc(LexiklarSqlitePlugin)
public class LexiklarSqlitePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LexiklarSqlitePlugin"
    public let jsName = "LexiklarSqlite"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "execute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteDatabase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDatabasePath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importDatabaseFromUrl", returnType: CAPPluginReturnPromise)
    ]

    private let db = SqliteDb()
    private var currentPath: String?

    /// Resolve a database path, preferring the writable copy if it exists,
    /// otherwise returning the bundled path directly (read-only, no copy).
    private func resolvePath(_ name: String) throws -> String {
        let dbDir = Self.databaseDirectory()
        let dbPath = (dbDir as NSString).appendingPathComponent(name)

        // If a writable copy exists (from OTA patch or full replacement), use it
        if FileManager.default.fileExists(atPath: dbPath) {
            return dbPath
        }

        // Otherwise use the bundled DB directly (opened read-only)
        let baseName = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        guard let bundlePath = Bundle.main.path(
            forResource: "public/data/\(baseName)",
            ofType: ext
        ) else {
            throw SqliteError.openFailed(
                message: "Bundled database '\(name)' not found in app assets",
                code: 0)
        }
        return bundlePath
    }

    /// Path to the bundled DB inside the app bundle, or nil if not found.
    private func bundlePath(for name: String) -> String? {
        let baseName = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        return Bundle.main.path(
            forResource: "public/data/\(baseName)",
            ofType: ext
        )
    }

    /// Whether the given path is inside the app bundle (read-only).
    private func isBundlePath(_ path: String) -> Bool {
        guard let bundleRoot = Bundle.main.bundlePath as String? else { return false }
        return path.hasPrefix(bundleRoot)
    }

    /// Copy the bundled DB to the writable directory and reopen as read-write.
    private func copyToWritable(_ name: String) throws -> String {
        guard let src = bundlePath(for: name) else {
            throw SqliteError.openFailed(
                message: "Bundled database '\(name)' not found",
                code: 0)
        }

        let dbDir = Self.databaseDirectory()
        let dbPath = (dbDir as NSString).appendingPathComponent(name)

        try FileManager.default.createDirectory(
            atPath: dbDir, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: dbPath) {
            try FileManager.default.removeItem(atPath: dbPath)
        }
        try FileManager.default.copyItem(atPath: src, toPath: dbPath)

        db.close()
        try db.open(path: dbPath, readOnly: false)
        currentPath = dbPath
        return dbPath
    }

    /// The directory where databases are stored on this platform.
    static func databaseDirectory() -> String {
        let paths = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)
        return (paths[0].appendingPathComponent("databases").path)
    }

    // MARK: - Plugin Methods

    @objc func open(_ call: CAPPluginCall) {
        let name = call.getString("path") ?? "lexiklar.db"
        var readOnly = call.getBool("readOnly") ?? false

        do {
            let path = try resolvePath(name)
            if isBundlePath(path) { readOnly = true }
            try db.open(path: path, readOnly: readOnly)
            currentPath = path
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func query(_ call: CAPPluginCall) {
        guard let sql = call.getString("sql") else {
            call.reject("Missing 'sql' parameter")
            return
        }
        let params = call.getArray("params") ?? []

        do {
            let rows = try db.query(sql: sql, params: params)
            // Convert rows to JSObject-compatible format
            let jsRows = rows.map { row -> [String: Any] in
                var jsRow: [String: Any] = [:]
                for (key, value) in row {
                    jsRow[key] = value ?? NSNull()
                }
                return jsRow
            }
            call.resolve(["rows": jsRows])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func execute(_ call: CAPPluginCall) {
        guard let sql = call.getString("sql") else {
            call.reject("Missing 'sql' parameter")
            return
        }
        let transaction = call.getBool("transaction") ?? true

        do {
            // Copy-on-write: if DB is read-only from bundle, copy to writable storage first
            if let path = currentPath, isBundlePath(path) {
                let name = call.getString("path") ?? "lexiklar.db"
                _ = try copyToWritable(name)
            }

            let changes = try db.execute(sql: sql, transaction: transaction)
            call.resolve(["changes": changes])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        db.close()
        call.resolve()
    }

    @objc func deleteDatabase(_ call: CAPPluginCall) {
        let name = call.getString("path") ?? "lexiklar.db"
        let dbDir = Self.databaseDirectory()
        let dbPath = (dbDir as NSString).appendingPathComponent(name)

        do {
            if FileManager.default.fileExists(atPath: dbPath) {
                try FileManager.default.removeItem(atPath: dbPath)
            }
            call.resolve()
        } catch {
            call.reject("Failed to delete database: \(error.localizedDescription)")
        }
    }

    @objc func getDatabasePath(_ call: CAPPluginCall) {
        call.resolve(["path": Self.databaseDirectory()])
    }

    @objc func importDatabaseFromUrl(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("Missing or invalid 'url' parameter")
            return
        }

        let name = call.getString("path") ?? "lexiklar.db"
        let dbDir = Self.databaseDirectory()
        let dbPath = (dbDir as NSString).appendingPathComponent(name)

        db.close()

        let task = URLSession.shared.downloadTask(with: url) { [weak self] tempUrl, response, error in
            guard self != nil else { return }

            if let error = error {
                call.reject("Download failed: \(error.localizedDescription)")
                return
            }
            guard let tempUrl = tempUrl else {
                call.reject("Download returned no data")
                return
            }

            do {
                try FileManager.default.createDirectory(
                    atPath: dbDir, withIntermediateDirectories: true)

                if FileManager.default.fileExists(atPath: dbPath) {
                    try FileManager.default.removeItem(atPath: dbPath)
                }

                try SqliteDb.decompressGzipFile(from: tempUrl.path, to: dbPath)
                self?.currentPath = dbPath
                call.resolve()
            } catch {
                call.reject("Import failed: \(error.localizedDescription)")
            }
        }
        task.resume()
    }
}
