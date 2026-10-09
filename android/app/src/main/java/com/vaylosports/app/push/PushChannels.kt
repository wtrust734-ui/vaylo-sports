package com.vaylosports.app.push

/**
 * Channel ids, shared between the plugin (which creates them) and the
 * messaging service (which posts to them).
 *
 * These strings must stay identical to the constants in src/lib/push.ts. A
 * channel id cannot be renamed after creation — doing so silently abandons the
 * athlete's existing per-channel setting and starts a fresh one at the OS
 * default — so this is a wire format, not a label.
 */
object PushChannels {
    const val DEFAULT_ID = "vaylo_default"
    const val REMINDERS_ID = "vaylo_reminders"
}

/** Where the JS layer's own post arrives from, so the service can hand it back. */
object PushBridge {
    const val EVENT_TOKEN = "vayloPushToken"
    const val PREFS = "com.vaylosports.app.push.PREFS"
    const val KEY_TOKEN = "fcm_token"
}