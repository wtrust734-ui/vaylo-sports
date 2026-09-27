package com.vaylosports.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.vaylosports.app.health.HealthConnectPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE super.onCreate: BridgeActivity.onCreate
        // consumes initialPlugins when it calls load() at the end, so a
        // registration placed after super.onCreate() never reaches the bridge.
        registerPlugin(HealthConnectPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
