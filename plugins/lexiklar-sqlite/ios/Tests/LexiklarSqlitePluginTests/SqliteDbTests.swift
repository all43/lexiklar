import XCTest
@testable import SqliteDb

final class SqliteDbTests: XCTestCase {
    var db: SqliteDb!
    var testDbPath: String!

    override func setUp() {
        super.setUp()
        db = SqliteDb()

        // Copy bundled test.db to a temp location (so tests don't modify the original)
        let bundle = Bundle.module
        guard let src = bundle.path(forResource: "test", ofType: "db", inDirectory: "Resources") else {
            XCTFail("test.db not found in test bundle")
            return
        }
        testDbPath = NSTemporaryDirectory() + "test_\(UUID().uuidString).db"
        try? FileManager.default.copyItem(atPath: src, toPath: testDbPath)
    }

    override func tearDown() {
        db.close()
        try? FileManager.default.removeItem(atPath: testDbPath)
        super.tearDown()
    }

    // MARK: - Open / Close

    func testOpenReadOnly() throws {
        try db.open(path: testDbPath, readOnly: true)
        let rows = try db.query(sql: "SELECT 1 as n")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0]["n"] as? Int, 1)
    }

    func testOpenReadWrite() throws {
        try db.open(path: testDbPath, readOnly: false)
        let rows = try db.query(sql: "SELECT 1 as n")
        XCTAssertEqual(rows.count, 1)
    }

    func testOpenNonExistentFails() {
        XCTAssertThrowsError(
            try db.open(path: "/nonexistent/path.db", readOnly: true)
        )
    }

    func testQueryWithoutOpenFails() {
        XCTAssertThrowsError(
            try db.query(sql: "SELECT 1")
        )
    }

    // MARK: - Query

    func testQueryMeta() throws {
        try db.open(path: testDbPath, readOnly: true)
        let rows = try db.query(sql: "SELECT value FROM meta WHERE key = ?", params: ["version"])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0]["value"] as? String, "test123")
    }

    func testQueryMultipleRows() throws {
        try db.open(path: testDbPath, readOnly: true)
        let rows = try db.query(sql: "SELECT id, lemma FROM words ORDER BY id")
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0]["lemma"] as? String, "Tisch")
        XCTAssertEqual(rows[1]["lemma"] as? String, "laufen")
    }

    func testQueryNoResults() throws {
        try db.open(path: testDbPath, readOnly: true)
        let rows = try db.query(sql: "SELECT * FROM words WHERE lemma = ?", params: ["xyz"])
        XCTAssertEqual(rows.count, 0)
    }

    func testQueryColumnTypes() throws {
        try db.open(path: testDbPath, readOnly: true)
        let rows = try db.query(sql: "SELECT id, lemma, data FROM words WHERE id = 1")
        XCTAssertEqual(rows.count, 1)
        // INTEGER column
        XCTAssertEqual(rows[0]["id"] as? Int, 1)
        // TEXT columns
        XCTAssertEqual(rows[0]["lemma"] as? String, "Tisch")
        XCTAssertTrue((rows[0]["data"] as? String)?.contains("noun") == true)
    }

    func testQueryNullValue() throws {
        try db.open(path: testDbPath, readOnly: false)
        _ = try db.execute(sql: "CREATE TABLE t (a TEXT, b TEXT)", transaction: false)
        _ = try db.execute(sql: "INSERT INTO t VALUES ('hello', NULL)", transaction: false)
        let rows = try db.query(sql: "SELECT a, b FROM t")
        XCTAssertEqual(rows[0]["a"] as? String, "hello")
        XCTAssertNil(rows[0]["b"] as? String)
    }

    // MARK: - Execute

    func testExecuteInsert() throws {
        try db.open(path: testDbPath, readOnly: false)
        let changes = try db.execute(
            sql: "INSERT INTO words VALUES (3, 'gehen', '{}')",
            transaction: true)
        XCTAssertEqual(changes, 1)

        let rows = try db.query(sql: "SELECT COUNT(*) as cnt FROM words")
        XCTAssertEqual(rows[0]["cnt"] as? Int, 3)
    }

    func testExecuteMultiStatement() throws {
        try db.open(path: testDbPath, readOnly: false)
        let sql = """
        INSERT INTO words VALUES (3, 'gehen', '{}');
        INSERT INTO words VALUES (4, 'sehen', '{}');
        UPDATE words SET data = '{"updated":true}' WHERE id = 1;
        """
        _ = try db.execute(sql: sql, transaction: true)

        let rows = try db.query(sql: "SELECT COUNT(*) as cnt FROM words")
        XCTAssertEqual(rows[0]["cnt"] as? Int, 4)

        let updated = try db.query(sql: "SELECT data FROM words WHERE id = 1")
        XCTAssertTrue((updated[0]["data"] as? String)?.contains("updated") == true)
    }

    func testExecuteRollbackOnError() throws {
        try db.open(path: testDbPath, readOnly: false)

        // This should fail (duplicate primary key) and roll back
        let sql = """
        INSERT INTO words VALUES (3, 'gehen', '{}');
        INSERT INTO words VALUES (1, 'duplicate', '{}');
        """
        XCTAssertThrowsError(try db.execute(sql: sql, transaction: true))

        // Verify rollback — count should still be 2
        let rows = try db.query(sql: "SELECT COUNT(*) as cnt FROM words")
        XCTAssertEqual(rows[0]["cnt"] as? Int, 2)
    }

    // MARK: - Close and reopen

    func testCloseAndReopen() throws {
        try db.open(path: testDbPath, readOnly: true)
        let rows1 = try db.query(sql: "SELECT COUNT(*) as cnt FROM words")
        XCTAssertEqual(rows1[0]["cnt"] as? Int, 2)

        db.close()

        try db.open(path: testDbPath, readOnly: true)
        let rows2 = try db.query(sql: "SELECT COUNT(*) as cnt FROM words")
        XCTAssertEqual(rows2[0]["cnt"] as? Int, 2)
    }
}
