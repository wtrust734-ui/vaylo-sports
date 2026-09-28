package com.vaylosports.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.vaylosports.app.health.HealthConnectPlugin;

public class MainActivity extends BridgeActivity {

    /**
     * Health Connect sends these when the athlete taps the privacy-policy link on
     * its permissions screen: ACTION_SHOW_PERMISSIONS_RATIONALE on Android 13 and
     * below, VIEW_PERMISSION_USAGE from Android 14 on. Both are already declared
     * as intent-filters in AndroidManifest.xml.
     *
     * Without handling them the intent simply opened the app on whatever screen
     * the athlete last saw, which fails the Health Connect requirement that the
     * app explains how the requested health data is used and handled. The page is
     * bundled with the web assets rather than fetched, so it renders with no
     * network and shows nothing to a third party.
     */
    private static final String ACTION_HEALTH_RATIONALE = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
    private static final String ACTION_VIEW_PERMISSION_USAGE = "android.intent.action.VIEW_PERMISSION_USAGE";
    private static final String RATIONALE_PAGE = "health-rationale.html";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE super.onCreate: BridgeActivity.onCreate
        // consumes initialPlugins when it calls load() at the end, so a
        // registration placed after super.onCreate() never reaches the bridge.
        registerPlugin(HealthConnectPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Single place that handles the rationale intents, deliberately rather than
     * also checking in onCreate: BridgeActivity.load() finishes by calling
     * onNewIntent(getIntent()), and the Bridge constructor has already issued the
     * WebView's first load by then. So this runs for a cold start (via load()) and
     * for a warm one (Android routes the intent here because the activity is
     * singleTask), and in both cases the load below is the later of the two and
     * therefore wins. Handling it in onCreate as well would only race.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        if (intent == null || bridge == null || intent.getAction() == null) return;

        String action = intent.getAction();
        if (!ACTION_HEALTH_RATIONALE.equals(action) && !ACTION_VIEW_PERMISSION_USAGE.equals(action)) return;

        WebView webView = bridge.getWebView();
        if (webView == null) return;

        // getAppUrl() is the fully-formed origin the local server serves the
        // bundle from, with a trailing slash — building it by hand would break
        // the moment the scheme or host changes.
        webView.loadUrl(bridge.getAppUrl() + RATIONALE_PAGE);
    }
}
