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
        CAPPluginMethod(name: "getDatabasePath", returnType: CAPPluginReturnPromise)
    ]

    private let db = SqliteDb()

    /// Resolve a database path to the app's database directory.
    /// Copies from bundled assets on first use if the file doesn't exist yet.
    private func resolvePath(_ name: String) throws -> String {
        let dbDir = Self.databaseDirectory()
        let dbPath = (dbDir as NSString).appendingPathComponent(name)

        // If DB doesn't exist at target, copy from bundled assets
        if !FileManager.default.fileExists(atPath: dbPath) {
            try FileManager.default.createDirectory(
                atPath: dbDir, withIntermediateDirectories: true)

            // Look for bundled DB in the app's public/data/ directory
            guard let bundlePath = Bundle.main.path(
                forResource: "public/data/\((name as NSString).deletingPathExtension)",
                ofType: (name as NSString).pathExtension
            ) else {
                throw SqliteError.openFailed(
                    message: "Bundled database '\(name)' not found in app assets",
                    code: 0)
            }
            try FileManager.default.copyItem(atPath: bundlePath, toPath: dbPath)
        }

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
        let readOnly = call.getBool("readOnly") ?? false

        do {
            let path = try resolvePath(name)
            try db.open(path: path, readOnly: readOnly)
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
}
