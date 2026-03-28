package app.lexiklar.sqlite;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Minimal SQLite wrapper using Android's built-in SQLite.
 */
public class SqliteDb {
    private SQLiteDatabase db;

    public void open(String path, boolean readOnly) {
        int flags = readOnly
                ? SQLiteDatabase.OPEN_READONLY
                : SQLiteDatabase.OPEN_READWRITE;
        db = SQLiteDatabase.openDatabase(path, null, flags);
    }

    public JSONArray query(String sql, String[] params) throws Exception {
        if (db == null) throw new IllegalStateException("Database is not open");

        JSONArray rows = new JSONArray();
        try (Cursor cursor = db.rawQuery(sql, params)) {
            String[] columns = cursor.getColumnNames();
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                for (int i = 0; i < columns.length; i++) {
                    switch (cursor.getType(i)) {
                        case Cursor.FIELD_TYPE_NULL:
                            row.put(columns[i], JSONObject.NULL);
                            break;
                        case Cursor.FIELD_TYPE_INTEGER:
                            row.put(columns[i], cursor.getLong(i));
                            break;
                        case Cursor.FIELD_TYPE_FLOAT:
                            row.put(columns[i], cursor.getDouble(i));
                            break;
                        case Cursor.FIELD_TYPE_STRING:
                            row.put(columns[i], cursor.getString(i));
                            break;
                        case Cursor.FIELD_TYPE_BLOB:
                            // Return blob as null for simplicity — not used in our schema
                            row.put(columns[i], JSONObject.NULL);
                            break;
                    }
                }
                rows.put(row);
            }
        }
        return rows;
    }

    public int execute(String sql, boolean transaction) throws Exception {
        if (db == null) throw new IllegalStateException("Database is not open");

        if (transaction) {
            db.beginTransaction();
        }
        try {
            // Split and execute statements individually
            // Android's execSQL doesn't support multi-statement strings
            String[] statements = sql.split(";");
            int totalChanges = 0;
            for (String stmt : statements) {
                String trimmed = stmt.trim();
                if (trimmed.isEmpty()) continue;
                db.execSQL(trimmed);
            }
            totalChanges = getChanges();
            if (transaction) {
                db.setTransactionSuccessful();
            }
            return totalChanges;
        } finally {
            if (transaction) {
                db.endTransaction();
            }
        }
    }

    public void close() {
        if (db != null) {
            db.close();
            db = null;
        }
    }

    private int getChanges() {
        try (Cursor c = db.rawQuery("SELECT changes()", null)) {
            if (c.moveToFirst()) return c.getInt(0);
            return 0;
        }
    }
}
