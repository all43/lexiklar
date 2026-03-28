package app.lexiklar.sqlite;

import android.content.Context;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "LexiklarSqlite")
public class LexiklarSqlitePlugin extends Plugin {
    private final SqliteDb db = new SqliteDb();

    /**
     * Resolve a database name to its filesystem path.
     * On first use, copies the bundled DB from app assets.
     */
    private String resolvePath(String name) throws Exception {
        File dbDir = new File(getContext().getFilesDir(), "databases");
        if (!dbDir.exists()) dbDir.mkdirs();

        File dbFile = new File(dbDir, name);

        if (!dbFile.exists()) {
            // Copy from bundled assets (public/data/)
            String assetPath = "public/data/" + name;
            try (InputStream in = getContext().getAssets().open(assetPath);
                 FileOutputStream out = new FileOutputStream(dbFile)) {
                byte[] buf = new byte[8192];
                int len;
                while ((len = in.read(buf)) > 0) {
                    out.write(buf, 0, len);
                }
            }
        }

        return dbFile.getAbsolutePath();
    }

    private static String databaseDirectory(Context context) {
        return new File(context.getFilesDir(), "databases").getAbsolutePath();
    }

    @PluginMethod
    public void open(PluginCall call) {
        String name = call.getString("path", "lexiklar.db");
        boolean readOnly = call.getBoolean("readOnly", false);

        try {
            String path = resolvePath(name);
            db.open(path, readOnly);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void query(PluginCall call) {
        String sql = call.getString("sql");
        if (sql == null) {
            call.reject("Missing 'sql' parameter");
            return;
        }

        JSArray jsParams = call.getArray("params");
        String[] params = null;
        if (jsParams != null) {
            try {
                params = new String[jsParams.length()];
                for (int i = 0; i < jsParams.length(); i++) {
                    Object val = jsParams.get(i);
                    params[i] = val == JSONObject.NULL ? null : String.valueOf(val);
                }
            } catch (Exception e) {
                call.reject("Invalid params: " + e.getMessage());
                return;
            }
        }

        try {
            JSONArray rows = db.query(sql, params);
            JSObject result = new JSObject();
            result.put("rows", rows);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void execute(PluginCall call) {
        String sql = call.getString("sql");
        if (sql == null) {
            call.reject("Missing 'sql' parameter");
            return;
        }
        boolean transaction = call.getBoolean("transaction", true);

        try {
            int changes = db.execute(sql, transaction);
            JSObject result = new JSObject();
            result.put("changes", changes);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        db.close();
        call.resolve();
    }

    @PluginMethod
    public void deleteDatabase(PluginCall call) {
        String name = call.getString("path", "lexiklar.db");
        String dbDir = databaseDirectory(getContext());
        File dbFile = new File(dbDir, name);

        if (dbFile.exists()) {
            dbFile.delete();
        }
        call.resolve();
    }

    @PluginMethod
    public void getDatabasePath(PluginCall call) {
        JSObject result = new JSObject();
        result.put("path", databaseDirectory(getContext()));
        call.resolve(result);
    }
}
