package app.lexiklar;

import android.os.Build;
import android.os.Bundle;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            // enableEdgeToEdge() (auto-called by AndroidX Activity 1.9+ when
            // targetSdk >= 35) installs a persistent OnApplyWindowInsetsListener
            // on the decor view. Clear it, revert to traditional insets, and
            // trigger re-layout so the WebView fills the content area.
            ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), null);
            WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
            getWindow().getDecorView().requestApplyInsets();
        }
    }
}
